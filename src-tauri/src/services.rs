use std::{process::Command, time::Duration};

use crate::{
    config::{
        chat_base_url, desktop_model_config, desktop_model_setup_complete, ensure_runtime_env,
        runtime_api_token, save_desktop_model_config,
    },
    models::{DesktopModelConfig, ServiceSnapshot, ServiceStatus},
    paths::repo_root,
    process::command_exists,
};

const API_BASE_URL: &str = "http://127.0.0.1:3001";
const API_HEALTH_URL: &str = "http://127.0.0.1:3001/health";
const API_DEPENDENCIES_URL: &str = "http://127.0.0.1:3001/health/dependencies";
const MEILI_HEALTH_URL: &str = "http://127.0.0.1:7700/health";
const QDRANT_READY_URL: &str = "http://127.0.0.1:6333/readyz";

#[derive(Clone, Copy)]
enum ModelRuntimeMode {
    DockerModels,
    ApiEndpoints,
}

#[tauri::command]
pub async fn service_snapshot() -> ServiceSnapshot {
    let model_config = desktop_model_config();
    let model_setup_complete = desktop_model_setup_complete();
    let chat = chat_base_url();
    let mut services = vec![
        service(
            "sonar",
            "Sonar API",
            API_HEALTH_URL,
            true,
            Some(&model_config.api_token),
        )
        .await,
        service("meilisearch", "Meilisearch", MEILI_HEALTH_URL, true, None).await,
        service("qdrant", "Qdrant", QDRANT_READY_URL, true, None).await,
    ];

    if model_setup_complete {
        let model_label = if uses_managed_models(&model_config) {
            "Docker model services"
        } else {
            "Configured model APIs"
        };
        services.push(
            service(
                "models",
                model_label,
                API_DEPENDENCIES_URL,
                true,
                Some(&model_config.api_token),
            )
            .await,
        );
        services.push(
            service(
                "chat",
                "Chat model server",
                API_DEPENDENCIES_URL,
                true,
                Some(&model_config.api_token),
            )
            .await,
        );
    }

    ServiceSnapshot {
        api_base_url: API_BASE_URL.to_string(),
        chat_base_url: chat.clone(),
        services,
    }
}

#[tauri::command]
pub async fn bootstrap_services() -> Result<ServiceSnapshot, String> {
    let model_setup_complete = desktop_model_setup_complete();
    if !model_setup_complete {
        return Ok(service_snapshot().await);
    }

    let model_config = desktop_model_config();
    let before = service_snapshot().await;
    let sonar_needs_reconcile = before
        .services
        .iter()
        .any(|service| service.id == "sonar" && service.state != "ready");
    let local_models_need_reconcile = uses_managed_models(&model_config)
        && before
            .services
            .iter()
            .any(|service| matches!(service.id, "models" | "chat") && service.state != "ready");

    if before
        .services
        .iter()
        .any(|service| service.id == "meilisearch" && service.state != "ready")
        || before
            .services
            .iter()
            .any(|service| service.id == "qdrant" && service.state != "ready")
        || before
            .services
            .iter()
            .any(|service| service.id == "sonar" && service.state != "ready")
        || local_models_need_reconcile
    {
        start_docker_services(sonar_needs_reconcile, selected_runtime_mode())?;
        let api_token = runtime_api_token()?;
        wait_for_url(API_HEALTH_URL, Some(&api_token), Duration::from_secs(45)).await?;
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
    save_desktop_model_config(&config)?;
    start_docker_services(true, selected_runtime_mode())?;
    let api_token = runtime_api_token()?;
    wait_for_url(API_HEALTH_URL, Some(&api_token), Duration::from_secs(45)).await?;
    wait_for_url(
        API_DEPENDENCIES_URL,
        Some(&api_token),
        Duration::from_secs(180),
    )
    .await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(service_snapshot().await)
}

fn start_docker_services(
    force_recreate: bool,
    runtime_mode: ModelRuntimeMode,
) -> Result<(), String> {
    if !command_exists("docker") {
        return Err("Docker is not installed or not available on PATH".to_string());
    }

    let root = repo_root()?;
    let compose_file = root.join("compose.yml");
    let runtime_env = ensure_runtime_env()?;
    let model_config = desktop_model_config();
    let api_token = runtime_env.api_token;
    let meili_master_key = runtime_env.meili_master_key;
    if force_recreate {
        run_compose(
            compose_command(
                &root,
                &compose_file,
                &model_config,
                &api_token,
                &meili_master_key,
                runtime_mode,
            )
            .args(["down", "--remove-orphans"]),
            "docker compose down",
        )?;
    }

    run_compose(
        compose_command(
            &root,
            &compose_file,
            &model_config,
            &api_token,
            &meili_master_key,
            runtime_mode,
        )
        .args(["up", "-d"]),
        "docker compose up",
    )
}

fn compose_command(
    root: &std::path::Path,
    compose_file: &std::path::Path,
    model_config: &DesktopModelConfig,
    api_token: &str,
    meili_master_key: &str,
    runtime_mode: ModelRuntimeMode,
) -> Command {
    let mut command = Command::new("docker");
    command.arg("compose").arg("-f").arg(compose_file);
    match runtime_mode {
        ModelRuntimeMode::DockerModels => {
            command.arg("-f").arg(root.join("compose.models.yml"));
        }
        ModelRuntimeMode::ApiEndpoints => {
            command.arg("-f").arg(root.join("compose.endpoints.yml"));
        }
    }
    command
        .current_dir(root)
        .env("SONAR_CHAT_MODEL", &model_config.chat_model)
        .env("SONAR_CHAT_API_KEY", &model_config.chat_api_key)
        .env("SONAR_EMBEDDING_PROVIDER", "openai")
        .env("SONAR_EMBEDDING_MODEL", &model_config.embedding_model)
        .env("SONAR_EMBEDDING_API_KEY", &model_config.embedding_api_key)
        .env(
            "SONAR_QDRANT_VECTOR_SIZE",
            model_config.embedding_vector_size.to_string(),
        )
        .env("SONAR_API_TOKEN", api_token)
        .env("SONAR_MEILI_MASTER_KEY", meili_master_key)
        .env("SONAR_MEILI_API_KEY", meili_master_key)
        .env("MEILI_MASTER_KEY", meili_master_key);
    if matches!(runtime_mode, ModelRuntimeMode::ApiEndpoints) {
        command
            .env(
                "SONAR_CHAT_BASE_URL",
                docker_reachable_url(&model_config.chat_base_url),
            )
            .env(
                "SONAR_EMBEDDING_BASE_URL",
                docker_reachable_url(&model_config.embedding_base_url),
            );
    }
    command
}

fn run_compose(command: &mut Command, label: &str) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|err| format!("{label} could not start: {err}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let details = [stderr.trim(), stdout.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if details.is_empty() {
        Err(format!("{label} exited with {}", output.status))
    } else {
        Err(format!("{label} exited with {}:\n{details}", output.status))
    }
}

fn uses_managed_models(model_config: &DesktopModelConfig) -> bool {
    model_config.model_mode == "local"
}

fn selected_runtime_mode() -> ModelRuntimeMode {
    if uses_managed_models(&desktop_model_config()) {
        ModelRuntimeMode::DockerModels
    } else {
        ModelRuntimeMode::ApiEndpoints
    }
}

fn docker_reachable_url(value: &str) -> String {
    value
        .replace("http://localhost:", "http://host.docker.internal:")
        .replace("http://127.0.0.1:", "http://host.docker.internal:")
}

async fn service(
    id: &'static str,
    label: &'static str,
    url: &str,
    managed: bool,
    api_token: Option<&str>,
) -> ServiceStatus {
    match check_url(url, api_token).await {
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

async fn wait_for_url(url: &str, api_token: Option<&str>, timeout: Duration) -> Result<(), String> {
    let started = std::time::Instant::now();
    let mut last_error = "not checked yet".to_string();
    while started.elapsed() < timeout {
        match check_url(url, api_token).await {
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

async fn check_url(url: &str, api_token: Option<&str>) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client.get(url);
    if let Some(token) = api_token.filter(|token| !token.trim().is_empty()) {
        request = request.header("X-Sonar-Token", token);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", response.status()))
    }
}
