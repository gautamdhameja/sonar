use std::{process::Command, time::Duration};

use crate::{
    config::{
        chat_base_url, desktop_model_config, ensure_runtime_env, runtime_api_token,
        save_desktop_model_config,
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

#[tauri::command]
pub async fn service_snapshot() -> ServiceSnapshot {
    let model_config = desktop_model_config();
    let chat = chat_base_url();
    let model_label = if uses_managed_models(&model_config) {
        "Docker model services"
    } else {
        "Configured model APIs"
    };
    ServiceSnapshot {
        api_base_url: API_BASE_URL.to_string(),
        chat_base_url: chat.clone(),
        services: vec![
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
            service(
                "models",
                model_label,
                API_DEPENDENCIES_URL,
                true,
                Some(&model_config.api_token),
            )
            .await,
            service(
                "chat",
                "Chat model server",
                API_DEPENDENCIES_URL,
                true,
                Some(&model_config.api_token),
            )
            .await,
        ],
    }
}

#[tauri::command]
pub async fn bootstrap_services() -> Result<ServiceSnapshot, String> {
    let before = service_snapshot().await;
    let sonar_needs_reconcile = before
        .services
        .iter()
        .any(|service| service.id == "sonar" && service.state != "ready");

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
    {
        start_docker_services(sonar_needs_reconcile)?;
        let api_token = runtime_api_token()?;
        wait_for_url(API_HEALTH_URL, Some(&api_token), Duration::from_secs(45)).await?;
    }

    let _ = ensure_embedding_model();
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
    start_docker_services(true)?;
    let api_token = runtime_api_token()?;
    wait_for_url(API_HEALTH_URL, Some(&api_token), Duration::from_secs(45)).await?;
    let _ = ensure_embedding_model();
    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(service_snapshot().await)
}

fn start_docker_services(force_recreate: bool) -> Result<(), String> {
    if !command_exists("docker") {
        return Err("Docker is not installed or not available on PATH".to_string());
    }

    let root = repo_root()?;
    let compose_file = root.join("compose.yml");
    let runtime_env = ensure_runtime_env()?;
    let model_config = desktop_model_config();
    let api_token = runtime_env.api_token;
    let meili_master_key = runtime_env.meili_master_key;
    let managed_models = uses_managed_models(&model_config);

    if force_recreate {
        let status = compose_command(
            &root,
            &compose_file,
            &model_config,
            &api_token,
            &meili_master_key,
            managed_models,
        )
        .args(["down", "--remove-orphans"])
        .status()
        .map_err(|err| err.to_string())?;
        if !status.success() {
            return Err(format!("docker compose down exited with {status}"));
        }
    }

    let status = compose_command(
        &root,
        &compose_file,
        &model_config,
        &api_token,
        &meili_master_key,
        managed_models,
    )
    .args(["up", "-d"])
    .status()
    .map_err(|err| err.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("docker compose exited with {status}"))
    }
}

fn compose_command(
    root: &std::path::Path,
    compose_file: &std::path::Path,
    model_config: &DesktopModelConfig,
    api_token: &str,
    meili_master_key: &str,
    managed_models: bool,
) -> Command {
    let mut command = Command::new("docker");
    command.arg("compose").arg("-f").arg(compose_file);
    if managed_models {
        command.arg("-f").arg(root.join("compose.models.yml"));
    } else {
        command.arg("-f").arg(root.join("compose.endpoints.yml"));
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
    if !managed_models {
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

fn uses_managed_models(model_config: &DesktopModelConfig) -> bool {
    model_config.model_mode == "local"
}

fn docker_reachable_url(value: &str) -> String {
    value
        .replace("http://localhost:", "http://host.docker.internal:")
        .replace("http://127.0.0.1:", "http://host.docker.internal:")
}

fn ensure_embedding_model() -> Result<(), String> {
    Ok(())
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
