use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use crate::{
    config::{
        chat_base_url, desktop_model_config, desktop_model_setup_complete, runtime_api_token,
        save_desktop_model_config, DEFAULT_CHAT_BASE_URL,
    },
    llama_sidecar::{missing_llama_sidecar_message, start_llama_sidecar_if_available},
    models::{DesktopModelConfig, ServiceSnapshot, ServiceStatus},
    paths::{repo_root, sonar_home},
    process::command_exists,
};

const API_BASE_URL: &str = "http://127.0.0.1:3001";
const API_HEALTH_URL: &str = "http://127.0.0.1:3001/health";
static RUNTIME_OPERATION_ACTIVE: AtomicBool = AtomicBool::new(false);

struct RuntimeOperationGuard;

impl RuntimeOperationGuard {
    fn acquire() -> Result<Self, String> {
        RUNTIME_OPERATION_ACTIVE
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map(|_| Self)
            .map_err(|_| "Another Sonar runtime operation is already running.".to_string())
    }
}

impl Drop for RuntimeOperationGuard {
    fn drop(&mut self) {
        RUNTIME_OPERATION_ACTIVE.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn service_snapshot() -> ServiceSnapshot {
    let model_config = desktop_model_config();
    let model_setup_complete = desktop_model_setup_complete();
    let chat = chat_base_url();
    let mut services = vec![
        service(
            "sonar",
            "Workspace engine",
            API_HEALTH_URL,
            true,
            None,
            None,
        )
        .await,
    ];

    if model_setup_complete {
        let model_label = if uses_local_model(&model_config) {
            "Local model API"
        } else {
            "Configured model API"
        };
        services.push(model_service("chat", model_label, &model_config).await);
    }

    ServiceSnapshot {
        api_base_url: API_BASE_URL.to_string(),
        chat_base_url: chat.clone(),
        services,
    }
}

#[tauri::command]
pub async fn bootstrap_services() -> Result<ServiceSnapshot, String> {
    let _guard = RuntimeOperationGuard::acquire()?;

    let before = service_snapshot().await;
    let sonar_needs_reconcile = before
        .services
        .iter()
        .any(|service| service.id == "sonar" && service.state != "ready");

    if sonar_needs_reconcile {
        start_api_service(false)?;
        let api_token = runtime_api_token()?;
        wait_for_url(API_HEALTH_URL, Some(&api_token), Duration::from_secs(45))
            .await
            .map_err(with_api_startup_context)?;
    }
    let model_config = desktop_model_config();
    if desktop_model_setup_complete()
        && uses_local_model(&model_config)
        && uses_default_local_endpoint(&model_config)
    {
        ensure_local_model_runtime(&model_config).await?;
    }

    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(service_snapshot().await)
}

#[tauri::command]
pub fn get_model_config() -> DesktopModelConfig {
    desktop_model_config()
}

#[tauri::command]
pub async fn save_model_config(config: DesktopModelConfig) -> Result<ServiceSnapshot, String> {
    let _guard = RuntimeOperationGuard::acquire()?;
    save_desktop_model_config(&config)?;
    start_api_service(true)?;
    let api_token = runtime_api_token()?;
    wait_for_url(API_HEALTH_URL, Some(&api_token), Duration::from_secs(45))
        .await
        .map_err(with_api_startup_context)?;
    let model_config = desktop_model_config();
    if uses_local_model(&model_config) && uses_default_local_endpoint(&model_config) {
        ensure_local_model_runtime(&model_config).await?;
    } else {
        wait_for_model(&model_config, Duration::from_secs(180)).await?;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(service_snapshot().await)
}

fn start_api_service(force_restart: bool) -> Result<(), String> {
    if force_restart {
        stop_managed_api_service()?;
    }
    if !force_restart && is_api_ready() {
        return Ok(());
    }
    let data_dir = sonar_home()?;
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Unable to create Sonar data directory: {err}"))?;
    let log_path = api_log_path()?;
    let stdout = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|err| format!("Unable to open Sonar API log: {err}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|err| format!("Unable to prepare Sonar API log: {err}"))?;
    let model_config = desktop_model_config();
    let api_token = runtime_api_token()?;
    let mut command = api_command()?;
    let child = command
        .env("SONAR_API_TOKEN", &api_token)
        // Desktop users choose folders through the native picker, so the local engine accepts any
        // selected repo root. The remaining boundary is localhost bind + runtime token + CORS.
        .env("SONAR_ALLOW_ANY_REPO_ROOT", "true")
        .env("SONAR_DATA_DIR", data_dir.to_string_lossy().as_ref())
        .env("SONAR_CHAT_MODEL", &model_config.chat_model)
        .env("SONAR_CHAT_BASE_URL", &model_config.chat_base_url)
        .env("SONAR_CHAT_API_KEY", &model_config.chat_api_key)
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|err| format!("Unable to start Sonar API: {err}"))?;
    write_managed_api_pid(child.id())
}

fn api_command() -> Result<Command, String> {
    if let Some(path) = configured_api_server_path()? {
        let mut command = Command::new(path);
        command.args(["--port", "3001"]);
        return Ok(command);
    }

    if let (Ok(node), Ok(npm_cli)) = (
        std::env::var("npm_node_execpath"),
        std::env::var("npm_execpath"),
    ) {
        let node = node.trim();
        let npm_cli = npm_cli.trim();
        if !node.is_empty()
            && !npm_cli.is_empty()
            && std::path::Path::new(node).is_file()
            && std::path::Path::new(npm_cli).is_file()
        {
            let root = repo_root()?;
            let mut command = Command::new(node);
            command
                .current_dir(root)
                .args([npm_cli, "run", "dev", "--", "--port", "3001"]);
            return Ok(command);
        }
    }

    if !command_exists("npm") {
        return Err(
            "Sonar API could not start because no bundled API sidecar was found and npm is not available for source development."
                .to_string(),
        );
    }

    let root = repo_root()?;
    let mut command = Command::new("npm");
    command
        .current_dir(root)
        .args(["run", "dev", "--", "--port", "3001"]);
    Ok(command)
}

fn configured_api_server_path() -> Result<Option<std::path::PathBuf>, String> {
    if let Ok(path) = std::env::var("SONAR_API_SERVER_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let path = std::path::PathBuf::from(trimmed);
            if path.is_file() {
                return Ok(Some(path));
            }
            return Err(format!(
                "SONAR_API_SERVER_PATH does not point to a file: {}",
                path.display()
            ));
        }
    }

    let path = sonar_home()?.join("bin").join("sonar-api");
    Ok(path.is_file().then_some(path))
}

fn api_log_path() -> Result<PathBuf, String> {
    Ok(sonar_home()?.join("api.log"))
}

fn with_api_startup_context(err: String) -> String {
    let Some(log) = recent_api_log() else {
        return err;
    };
    format!("{err}\n\nRecent workspace engine log:\n{log}")
}

fn recent_api_log() -> Option<String> {
    let path = api_log_path().ok()?;
    let contents = fs::read_to_string(path).ok()?;
    let mut lines: Vec<&str> = contents.lines().rev().take(18).collect();
    lines.reverse();
    let log = lines.join("\n").trim().to_string();
    if log.is_empty() {
        None
    } else {
        Some(log)
    }
}

fn uses_local_model(model_config: &DesktopModelConfig) -> bool {
    model_config.model_mode == "local"
}

fn uses_default_local_endpoint(model_config: &DesktopModelConfig) -> bool {
    model_config.chat_base_url.trim().trim_end_matches('/') == DEFAULT_CHAT_BASE_URL
}

fn is_api_ready() -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", 3001)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = "GET /health HTTP/1.1\r\nHost: 127.0.0.1:3001\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    health_response_is_sonar(&response)
}

fn managed_api_pid_path() -> Result<std::path::PathBuf, String> {
    Ok(sonar_home()?.join("api.pid"))
}

fn write_managed_api_pid(pid: u32) -> Result<(), String> {
    let path = managed_api_pid_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create Sonar data directory: {err}"))?;
    }
    let mut file = fs::File::create(path)
        .map_err(|err| format!("Unable to write Sonar API process id: {err}"))?;
    file.write_all(pid.to_string().as_bytes())
        .map_err(|err| format!("Unable to write Sonar API process id: {err}"))
}

fn stop_managed_api_service() -> Result<(), String> {
    let path = managed_api_pid_path()?;
    let Ok(pid) = fs::read_to_string(&path) else {
        return Ok(());
    };
    let pid = pid.trim();
    if pid.is_empty() {
        let _ = fs::remove_file(path);
        return Ok(());
    }
    if !managed_api_process_matches(pid) {
        let _ = fs::remove_file(path);
        return Ok(());
    }
    let status = Command::new("kill")
        .arg(pid)
        .status()
        .map_err(|err| format!("Unable to stop previous Sonar API process: {err}"))?;
    if !status.success() && managed_api_process_matches(pid) {
        return Err(format!("Unable to stop previous Sonar API process {pid}."));
    }
    let _ = fs::remove_file(path);
    Ok(())
}

fn managed_api_process_matches(pid: &str) -> bool {
    let output = Command::new("ps")
        .args(["-p", pid, "-o", "command="])
        .output();
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let command_line = String::from_utf8_lossy(&output.stdout);
    command_line_looks_like_managed_api(&command_line)
}

fn command_line_looks_like_managed_api(command_line: &str) -> bool {
    let lower = command_line.to_ascii_lowercase();
    lower.contains("sonar-api")
        || (lower.contains("npm")
            && lower.contains("run")
            && lower.contains("dev")
            && lower.contains("--port")
            && lower.contains("3001"))
}

async fn service(
    id: &'static str,
    label: &'static str,
    url: &str,
    managed: bool,
    api_token: Option<&str>,
    bearer_token: Option<&str>,
) -> ServiceStatus {
    match check_url(url, api_token, bearer_token).await {
        Ok(()) => ServiceStatus {
            id,
            label,
            state: "ready",
            detail: "responding".to_string(),
            url: Some(url.to_string()),
            managed,
        },
        Err(err) => ServiceStatus {
            id,
            label,
            state: "missing",
            detail: err,
            url: Some(url.to_string()),
            managed,
        },
    }
}

async fn model_service(
    id: &'static str,
    label: &'static str,
    model_config: &DesktopModelConfig,
) -> ServiceStatus {
    let url = format!(
        "{}/models",
        model_config.chat_base_url.trim_end_matches('/')
    );
    let bearer = if model_config.chat_api_key.trim().is_empty()
        || model_config.chat_api_key.trim() == "not-needed"
    {
        None
    } else {
        Some(model_config.chat_api_key.as_str())
    };
    let mut status = service(
        id,
        label,
        &url,
        uses_local_model(model_config),
        None,
        bearer,
    )
    .await;
    if uses_local_model(model_config)
        && uses_default_local_endpoint(model_config)
        && status.state != "ready"
    {
        status.detail = missing_llama_sidecar_message();
    }
    status
}

async fn wait_for_url(url: &str, api_token: Option<&str>, timeout: Duration) -> Result<(), String> {
    let started = std::time::Instant::now();
    let mut last_error = "not checked yet".to_string();
    while started.elapsed() < timeout {
        match check_url(url, api_token, None).await {
            Ok(()) => return Ok(()),
            Err(err) => last_error = err,
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }
    Err(format!(
        "Timed out waiting for {url} after {}s: {last_error}",
        timeout.as_secs()
    ))
}

async fn wait_for_model(
    model_config: &DesktopModelConfig,
    timeout: Duration,
) -> Result<(), String> {
    let url = format!(
        "{}/models",
        model_config.chat_base_url.trim_end_matches('/')
    );
    let bearer = if model_config.chat_api_key.trim().is_empty()
        || model_config.chat_api_key.trim() == "not-needed"
    {
        None
    } else {
        Some(model_config.chat_api_key.as_str())
    };
    let started = std::time::Instant::now();
    let mut last_error = "not checked yet".to_string();
    while started.elapsed() < timeout {
        match check_url(&url, None, bearer).await {
            Ok(()) => return Ok(()),
            Err(err) => last_error = err,
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }
    Err(format!(
        "Timed out waiting for model endpoint {url} after {}s: {last_error}",
        timeout.as_secs()
    ))
}

async fn ensure_local_model_runtime(model_config: &DesktopModelConfig) -> Result<(), String> {
    let started_or_running = start_llama_sidecar_if_available(model_config)?;
    if started_or_running {
        return wait_for_model(model_config, Duration::from_secs(180)).await;
    }
    Err(missing_llama_sidecar_message())
}

async fn check_url(
    url: &str,
    api_token: Option<&str>,
    bearer_token: Option<&str>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client.get(url);
    if let Some(token) = api_token.filter(|token| !token.trim().is_empty()) {
        request = request.header("X-Sonar-Token", token);
    }
    if let Some(token) = bearer_token.filter(|token| !token.trim().is_empty()) {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    if url == API_HEALTH_URL {
        let signature = response
            .headers()
            .get("x-sonar-service")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        if signature != "workspace-engine" {
            return Err("Health endpoint did not identify Sonar.".to_string());
        }
        let body = response.text().await.map_err(|err| err.to_string())?;
        if !health_body_is_ok(&body) {
            return Err("Health endpoint returned an unexpected body.".to_string());
        }
    }
    Ok(())
}

fn health_response_is_sonar(response: &str) -> bool {
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let mut lines = headers.lines();
    let Some(status_line) = lines.next() else {
        return false;
    };
    if !status_line.contains(" 200 ") {
        return false;
    }
    let has_signature =
        lines.any(|line| line.eq_ignore_ascii_case("x-sonar-service: workspace-engine"));
    has_signature && health_body_is_ok(body)
}

fn health_body_is_ok(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("status")
                .and_then(|status| status.as_str())
                .map(str::to_string)
        })
        .as_deref()
        == Some("ok")
}

#[cfg(test)]
mod tests {
    use super::{command_line_looks_like_managed_api, health_response_is_sonar};

    #[test]
    fn health_response_requires_sonar_signature_and_ok_body() {
        assert!(health_response_is_sonar(
            "HTTP/1.1 200 OK\r\nX-Sonar-Service: workspace-engine\r\n\r\n{\"status\":\"ok\"}",
        ));
        assert!(!health_response_is_sonar(
            "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"ok\"}",
        ));
        assert!(!health_response_is_sonar(
            "HTTP/1.1 200 OK\r\nX-Sonar-Service: workspace-engine\r\n\r\n{\"status\":\"ready\"}",
        ));
    }

    #[test]
    fn managed_api_process_matcher_rejects_unrelated_commands() {
        assert!(command_line_looks_like_managed_api(
            "npm run dev -- --port 3001",
        ));
        assert!(command_line_looks_like_managed_api(
            "/Users/example/.sonar/bin/sonar-api --port 3001",
        ));
        assert!(!command_line_looks_like_managed_api(
            "python -m http.server 3001",
        ));
    }
}
