use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use crate::{
    config::{
        chat_base_url, desktop_model_config, desktop_model_setup_complete,
        normalize_desktop_model_config, runtime_api_token, save_desktop_model_config,
        DEFAULT_CHAT_BASE_URL,
    },
    llama_sidecar::{missing_llama_sidecar_message, start_llama_sidecar_if_available},
    models::{DesktopModelConfig, LocalModelDiscovery, ServiceSnapshot, ServiceStatus},
    paths::{repo_root, sonar_home},
    process::{command_exists, prepare_managed_child, terminate_managed_process},
};

const API_BASE_URL: &str = "http://127.0.0.1:3001";
const API_HEALTH_URL: &str = "http://127.0.0.1:3001/health";
const API_AUTH_CHECK_URL: &str = "http://127.0.0.1:3001/projects";
const BUILD_NODE_EXEC_PATH: Option<&str> = option_env!("SONAR_BUILD_NODE_EXEC_PATH");
const BUILD_NPM_EXEC_PATH: Option<&str> = option_env!("SONAR_BUILD_NPM_EXEC_PATH");
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
    let api_token = runtime_api_token().ok();
    let mut services = vec![
        service(
            "sonar",
            "Workspace engine",
            API_AUTH_CHECK_URL,
            true,
            api_token.as_deref(),
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
        wait_for_url(
            API_AUTH_CHECK_URL,
            Some(&api_token),
            Duration::from_secs(45),
        )
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
pub async fn discover_local_model(base_url: Option<String>) -> Result<LocalModelDiscovery, String> {
    let chat_base_url = normalize_local_model_base_url(base_url.as_deref())?;
    let models_url = format!("{}/models", chat_base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|err| err.to_string())?;

    let response = match client.get(&models_url).send().await {
        Ok(response) => response,
        Err(err) => {
            return Ok(LocalModelDiscovery {
                found: false,
                chat_base_url,
                chat_model: None,
                message: Some(format!("No local model responded at {models_url}: {err}")),
            });
        }
    };
    if !response.status().is_success() {
        return Ok(LocalModelDiscovery {
            found: false,
            chat_base_url,
            chat_model: None,
            message: Some(format!(
                "Local model endpoint returned HTTP {}",
                response.status()
            )),
        });
    }
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| format!("Local model endpoint returned invalid JSON: {err}"))?;
    let chat_model = first_model_name(&body);

    Ok(LocalModelDiscovery {
        found: chat_model.is_some(),
        chat_base_url,
        chat_model,
        message: None,
    })
}

#[tauri::command]
pub async fn save_model_config(config: DesktopModelConfig) -> Result<ServiceSnapshot, String> {
    let _guard = RuntimeOperationGuard::acquire()?;
    let model_config = normalize_desktop_model_config(&config)?;
    validate_model_runtime(&model_config).await?;
    save_desktop_model_config(&model_config)?;
    start_api_service(true)?;
    let api_token = runtime_api_token()?;
    wait_for_url(
        API_AUTH_CHECK_URL,
        Some(&api_token),
        Duration::from_secs(45),
    )
    .await
    .map_err(with_api_startup_context)?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(service_snapshot().await)
}

pub fn shutdown_managed_services() -> Result<(), String> {
    stop_managed_api_service()
}

fn start_api_service(force_restart: bool) -> Result<(), String> {
    if force_restart {
        stop_managed_api_service()?;
    }
    let api_token = runtime_api_token()?;
    if !force_restart {
        if is_api_authenticated(&api_token) {
            return Ok(());
        }
        if is_api_ready() {
            stop_managed_api_service()?;
            if is_api_ready() {
                return Err(
                    "A Sonar API is already running on 127.0.0.1:3001 with a different runtime token. Stop the existing API process, then start Sonar again."
                        .to_string(),
                );
            }
        }
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
    let mut command = api_command()?;
    prepare_managed_child(&mut command);
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
        if let Some((node, npm_cli)) = validated_node_npm_pair(node.trim(), npm_cli.trim()) {
            let root = repo_root()?;
            let mut command = Command::new(node);
            command
                .current_dir(root)
                .arg(npm_cli)
                .args(["run", "dev", "--", "--port", "3001"]);
            configure_node_runtime_env(&mut command);
            return Ok(command);
        }
    }

    if let Some((node, npm_cli)) = build_time_node_npm_pair() {
        let root = repo_root()?;
        let mut command = Command::new(node);
        command
            .current_dir(root)
            .arg(npm_cli)
            .args(["run", "dev", "--", "--port", "3001"]);
        configure_node_runtime_env(&mut command);
        return Ok(command);
    }

    if let Some((node, npm_cli)) = discover_supported_node_npm()? {
        let root = repo_root()?;
        let mut command = Command::new(node);
        command
            .current_dir(root)
            .arg(npm_cli)
            .args(["run", "dev", "--", "--port", "3001"]);
        configure_node_runtime_env(&mut command);
        return Ok(command);
    }

    if !command_exists("npm") || !node_command_is_supported("node") {
        return Err(
            "Sonar API could not start because no bundled API sidecar was found and no supported Node.js runtime was available. Install Node.js 22, 23, 24, or 25, run npm install in the Sonar checkout, then open the app again."
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

fn configure_node_runtime_env(command: &mut Command) {
    let Some(node_path) = command.get_program().to_str().map(PathBuf::from) else {
        return;
    };
    command.env("NODE", &node_path);
    let Some(node_bin) = node_path.parent() else {
        return;
    };
    let existing_path = std::env::var_os("PATH").unwrap_or_default();
    let paths =
        std::iter::once(node_bin.to_path_buf()).chain(std::env::split_paths(&existing_path));
    if let Ok(joined) = std::env::join_paths(paths) {
        command.env("PATH", joined);
    }
}

fn validated_node_npm_pair(node: &str, npm_cli: &str) -> Option<(PathBuf, PathBuf)> {
    if node.is_empty() || npm_cli.is_empty() {
        return None;
    }
    let node = PathBuf::from(node);
    let npm_cli = PathBuf::from(npm_cli);
    if !node.is_file() || !npm_cli.is_file() {
        return None;
    }
    node_version(&node)
        .filter(is_supported_node_version)
        .map(|_| (node, npm_cli))
}

fn build_time_node_npm_pair() -> Option<(PathBuf, PathBuf)> {
    validated_node_npm_pair(BUILD_NODE_EXEC_PATH?, BUILD_NPM_EXEC_PATH?)
}

fn discover_supported_node_npm() -> Result<Option<(PathBuf, PathBuf)>, String> {
    let Ok(home) = std::env::var("HOME") else {
        return Ok(None);
    };
    let versions_dir = Path::new(&home).join(".nvm").join("versions").join("node");
    let Ok(entries) = fs::read_dir(versions_dir) else {
        return Ok(None);
    };

    let mut candidates = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|err| format!("Unable to inspect local Node.js installs: {err}"))?;
        let version_dir = entry.path();
        let node = version_dir.join("bin").join("node");
        let npm_cli = version_dir
            .join("lib")
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js");
        if !node.is_file() || !npm_cli.is_file() {
            continue;
        }
        if let Some(version) = node_version(&node).filter(is_supported_node_version) {
            candidates.push((version, node, npm_cli));
        }
    }
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(candidates
        .into_iter()
        .next()
        .map(|(_version, node, npm_cli)| (node, npm_cli)))
}

fn node_command_is_supported(command: &str) -> bool {
    Command::new(command)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            output
                .status
                .success()
                .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        })
        .and_then(|version| parse_node_version(&version))
        .is_some_and(|version| is_supported_node_version(&version))
}

fn node_version(path: &Path) -> Option<(u32, u32, u32)> {
    let output = Command::new(path).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_node_version(String::from_utf8_lossy(&output.stdout).trim())
}

fn parse_node_version(value: &str) -> Option<(u32, u32, u32)> {
    let version = value.trim().strip_prefix('v').unwrap_or(value.trim());
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn is_supported_node_version(version: &(u32, u32, u32)) -> bool {
    (22..26).contains(&version.0)
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

fn normalize_local_model_base_url(input: Option<&str>) -> Result<String, String> {
    let raw = input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_CHAT_BASE_URL);
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    let mut url = reqwest::Url::parse(&with_scheme)
        .map_err(|_| "Local model endpoint must be a valid localhost URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Local model endpoint must start with http:// or https://.".to_string());
    }
    let host = url.host_str().unwrap_or("");
    if !matches!(host, "localhost" | "127.0.0.1" | "::1") {
        return Err("Local model discovery only supports localhost endpoints.".to_string());
    }
    let path = url.path().trim_end_matches('/');
    if path.is_empty() || path == "/" {
        url.set_path("/v1");
    } else {
        let normalized = path.to_string();
        url.set_path(&normalized);
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn first_model_name(value: &serde_json::Value) -> Option<String> {
    if let Some(data) = value.get("data").and_then(serde_json::Value::as_array) {
        return data.iter().find_map(model_name_from_value);
    }
    if let Some(models) = value.get("models").and_then(serde_json::Value::as_array) {
        return models.iter().find_map(model_name_from_value);
    }
    if let Some(array) = value.as_array() {
        return array.iter().find_map(model_name_from_value);
    }
    model_name_from_value(value)
}

fn model_name_from_value(value: &serde_json::Value) -> Option<String> {
    if let Some(name) = value
        .as_str()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return Some(name.to_string());
    }
    ["id", "name", "model"]
        .iter()
        .filter_map(|key| value.get(key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map(str::to_string)
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

fn is_api_authenticated(api_token: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", 3001)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "GET /projects HTTP/1.1\r\nHost: 127.0.0.1:3001\r\nX-Sonar-Token: {api_token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response_has_success_status(&response)
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
    terminate_managed_process(pid, command_line_looks_like_managed_api, "Sonar API")?;
    let _ = fs::remove_file(path);
    Ok(())
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

async fn validate_model_runtime(model_config: &DesktopModelConfig) -> Result<(), String> {
    if uses_local_model(model_config) && uses_default_local_endpoint(model_config) {
        ensure_local_model_runtime(model_config).await
    } else {
        wait_for_model(model_config, Duration::from_secs(180)).await
    }
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
        if status.as_u16() == 401 && bearer_token.is_some() {
            return Err(
                "Model endpoint rejected the configured API key with HTTP 401.".to_string(),
            );
        }
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

fn response_has_success_status(response: &str) -> bool {
    let Some(status_line) = response.lines().next() else {
        return false;
    };
    status_line
        .split_whitespace()
        .nth(1)
        .and_then(|status| status.parse::<u16>().ok())
        .is_some_and(|status| (200..300).contains(&status))
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
    use super::{
        command_line_looks_like_managed_api, first_model_name, health_response_is_sonar,
        is_supported_node_version, normalize_local_model_base_url, parse_node_version,
        response_has_success_status,
    };

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
    fn authenticated_response_requires_success_status() {
        assert!(response_has_success_status("HTTP/1.1 200 OK\r\n\r\n[]"));
        assert!(!response_has_success_status(
            "HTTP/1.1 401 Unauthorized\r\n\r\n{\"error\":\"Missing or invalid X-Sonar-Token\"}",
        ));
        assert!(!response_has_success_status(""));
    }

    #[test]
    fn source_runtime_accepts_supported_node_versions_only() {
        assert!(parse_node_version("v24.17.0")
            .is_some_and(|version| is_supported_node_version(&version)));
        assert!(
            parse_node_version("22.0.0").is_some_and(|version| is_supported_node_version(&version))
        );
        assert!(!parse_node_version("v26.3.1")
            .is_some_and(|version| is_supported_node_version(&version)));
        assert_eq!(parse_node_version("not-a-version"), None);
    }

    #[test]
    fn local_model_base_url_normalizes_host_and_port_inputs() {
        assert_eq!(
            normalize_local_model_base_url(None).unwrap(),
            "http://127.0.0.1:8080/v1",
        );
        assert_eq!(
            normalize_local_model_base_url(Some("localhost:8080")).unwrap(),
            "http://localhost:8080/v1",
        );
        assert_eq!(
            normalize_local_model_base_url(Some("http://127.0.0.1:9000/api/v1")).unwrap(),
            "http://127.0.0.1:9000/api/v1",
        );
        assert!(normalize_local_model_base_url(Some("https://example.com/v1")).is_err());
    }

    #[test]
    fn first_model_name_reads_openai_compatible_shapes() {
        assert_eq!(
            first_model_name(&serde_json::json!({
                "data": [{ "id": "qwen-local" }]
            })),
            Some("qwen-local".to_string()),
        );
        assert_eq!(
            first_model_name(&serde_json::json!({
                "models": [{ "name": "llama-local" }]
            })),
            Some("llama-local".to_string()),
        );
        assert_eq!(
            first_model_name(&serde_json::json!(["model-a", "model-b"])),
            Some("model-a".to_string()),
        );
        assert_eq!(first_model_name(&serde_json::json!({ "data": [] })), None);
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
