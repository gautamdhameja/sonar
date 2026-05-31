use std::{
    env,
    net::TcpStream,
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};

use crate::{
    config::{chat_base_url, desktop_model_config, save_desktop_model_config},
    models::{DesktopModelConfig, ServiceSnapshot, ServiceStatus},
    paths::{repo_root, repository_cache_dir},
    process::command_exists,
};

static API_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

const API_HOST: &str = "127.0.0.1";
const API_PORT: u16 = 3001;
const API_BASE_URL: &str = "http://127.0.0.1:3001";
const API_HEALTH_URL: &str = "http://127.0.0.1:3001/health";
const API_DEPENDENCIES_URL: &str = "http://127.0.0.1:3001/health/dependencies";
const MEILI_BASE_URL: &str = "http://127.0.0.1:7700";
const MEILI_HEALTH_URL: &str = "http://127.0.0.1:7700/health";
const QDRANT_HOST: &str = "localhost";
const QDRANT_PORT: &str = "6333";
const QDRANT_READY_URL: &str = "http://127.0.0.1:6333/readyz";
const TAURI_ALLOWED_ORIGINS: &str =
    "http://tauri.localhost,http://127.0.0.1:5173,http://localhost:5173";

#[tauri::command]
pub async fn service_snapshot() -> ServiceSnapshot {
    let model_config = desktop_model_config();
    let chat = chat_base_url();
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
                "Docker model services",
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
        start_docker_services()?;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    let _ = ensure_embedding_model();

    if before
        .services
        .iter()
        .any(|service| service.id == "sonar" && service.state != "ready")
    {
        start_sonar_api()?;
    }

    tokio::time::sleep(Duration::from_secs(2)).await;
    Ok(service_snapshot().await)
}

#[tauri::command]
pub fn get_model_config() -> DesktopModelConfig {
    desktop_model_config()
}

#[tauri::command]
pub async fn save_model_config(config: DesktopModelConfig) -> Result<ServiceSnapshot, String> {
    save_desktop_model_config(&config)?;
    start_docker_services()?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let _ = ensure_embedding_model();
    stop_sonar_api()?;
    start_sonar_api()?;
    tokio::time::sleep(Duration::from_secs(1)).await;
    Ok(service_snapshot().await)
}

fn api_child() -> &'static Mutex<Option<Child>> {
    API_CHILD.get_or_init(|| Mutex::new(None))
}

fn start_docker_services() -> Result<(), String> {
    if !command_exists("docker") {
        return Err("Docker is not installed or not available on PATH".to_string());
    }

    let root = repo_root()?;
    let compose_file = root.join("compose.yml");
    let model_config = desktop_model_config();
    let chat_model = model_config.chat_model;
    let embedding_model = model_config.embedding_model;
    let api_token = model_config.api_token;
    let status = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["up", "-d"])
        .current_dir(root)
        .env("SONAR_CHAT_MODEL", chat_model)
        .env("SONAR_EMBEDDING_MODEL", embedding_model)
        .env("SONAR_API_TOKEN", &api_token)
        .env("SONAR_MEILI_MASTER_KEY", &api_token)
        .status()
        .map_err(|err| err.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("docker compose exited with {status}"))
    }
}

fn ensure_embedding_model() -> Result<(), String> {
    Ok(())
}

fn start_sonar_api() -> Result<(), String> {
    if TcpStream::connect((API_HOST, API_PORT)).is_ok() {
        return Ok(());
    }

    let root = repo_root()?;
    let mut command = if root.join("dist/index.js").exists() {
        let mut command = Command::new("node");
        command.args(["dist/index.js", "--port", &API_PORT.to_string()]);
        command
    } else {
        let mut command = Command::new("npm");
        command.args(["run", "dev", "--", "--port", &API_PORT.to_string()]);
        command
    };

    let allowed_roots = env::var("SONAR_ALLOWED_REPO_ROOTS").unwrap_or_else(|_| {
        let mut roots = vec![root.display().to_string()];
        if let Ok(cache_dir) = repository_cache_dir() {
            roots.push(cache_dir.display().to_string());
        }
        roots.join(",")
    });
    let model_config = desktop_model_config();
    let api_token = model_config.api_token.clone();

    command
        .current_dir(&root)
        .env("SONAR_API_HOST", API_HOST)
        .env("SONAR_CORS_ALLOWED_ORIGINS", TAURI_ALLOWED_ORIGINS)
        .env("SONAR_ALLOWED_REPO_ROOTS", allowed_roots)
        .env("SONAR_CHAT_BASE_URL", model_config.chat_base_url)
        .env("SONAR_CHAT_MODEL", model_config.chat_model)
        .env("SONAR_CHAT_API_KEY", model_config.chat_api_key)
        .env("SONAR_API_TOKEN", &api_token)
        .env("SONAR_EMBEDDING_PROVIDER", "openai")
        .env("SONAR_EMBEDDING_BASE_URL", model_config.embedding_base_url)
        .env("SONAR_EMBEDDING_MODEL", model_config.embedding_model)
        .env("SONAR_EMBEDDING_API_KEY", model_config.embedding_api_key)
        .env("SONAR_MEILI_HOST", MEILI_BASE_URL)
        .env(
            "SONAR_MEILI_API_KEY",
            env::var("SONAR_MEILI_MASTER_KEY").unwrap_or(api_token),
        )
        .env("SONAR_QDRANT_HOST", QDRANT_HOST)
        .env("SONAR_QDRANT_PORT", QDRANT_PORT)
        .env("SONAR_QDRANT_VECTOR_SIZE", "768");

    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| err.to_string())?;
    *api_child()
        .lock()
        .map_err(|_| "API child lock is poisoned".to_string())? = Some(child);
    Ok(())
}

fn stop_sonar_api() -> Result<(), String> {
    let mut guard = api_child()
        .lock()
        .map_err(|_| "API child lock is poisoned".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
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
