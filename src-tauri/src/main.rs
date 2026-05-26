use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};

static API_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    id: &'static str,
    label: &'static str,
    state: &'static str,
    detail: String,
    url: Option<String>,
    managed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceSnapshot {
    services: Vec<ServiceStatus>,
    api_base_url: String,
    chat_base_url: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopModelConfig {
    chat_base_url: String,
    chat_model: String,
    chat_api_key: String,
    embedding_model: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClonedRepository {
    owner: String,
    repo: String,
    clone_url: String,
    local_path: String,
    updated_existing: bool,
}

fn api_child() -> &'static Mutex<Option<Child>> {
    API_CHILD.get_or_init(|| Mutex::new(None))
}

fn repo_root() -> Result<PathBuf, String> {
    if let Ok(root) = env::var("SONAR_APP_ROOT") {
        let path = PathBuf::from(root);
        if is_sonar_root(&path) {
            return Ok(path);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in candidates {
        for ancestor in candidate.ancestors() {
            if is_sonar_root(ancestor) {
                return Ok(ancestor.to_path_buf());
            }
        }
    }

    Err(
        "Unable to locate Sonar project root. Set SONAR_APP_ROOT to the checkout directory."
            .to_string(),
    )
}

fn is_sonar_root(path: &Path) -> bool {
    path.join("package.json").is_file() && path.join("docker-compose.sonar.yml").is_file()
}

fn chat_base_url() -> String {
    env::var("SONAR_CHAT_BASE_URL").unwrap_or_else(|_| desktop_model_config().chat_base_url)
}

fn detect_chat_base_url() -> String {
    for (port, url) in [
        (8080, "http://localhost:8080/v1"),
        (8000, "http://localhost:8000/v1"),
    ] {
        if TcpStream::connect(("127.0.0.1", port))
            .map(|stream| stream.set_nonblocking(true).is_ok())
            .unwrap_or(false)
        {
            return url.to_string();
        }
    }

    "http://localhost:8080/v1".to_string()
}

fn default_desktop_model_config() -> DesktopModelConfig {
    DesktopModelConfig {
        chat_base_url: detect_chat_base_url(),
        chat_model: env::var("SONAR_CHAT_MODEL").unwrap_or_else(|_| "Qwen/Qwen3.5-9B".to_string()),
        chat_api_key: env::var("SONAR_CHAT_API_KEY").unwrap_or_else(|_| "not-needed".to_string()),
        embedding_model: env::var("SONAR_OLLAMA_EMBEDDING_MODEL")
            .unwrap_or_else(|_| "nomic-embed-text".to_string()),
    }
}

fn sonar_home() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("SONAR_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    if let Ok(home) = env::var("HOME") {
        return Ok(PathBuf::from(home).join(".sonar"));
    }
    Ok(repo_root()?.join(".sonar"))
}

fn desktop_config_path() -> Result<PathBuf, String> {
    Ok(sonar_home()?.join("desktop-config.json"))
}

fn desktop_model_config() -> DesktopModelConfig {
    let fallback = default_desktop_model_config();
    let Ok(path) = desktop_config_path() else {
        return fallback;
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return fallback;
    };
    serde_json::from_str(&contents).unwrap_or(fallback)
}

fn save_desktop_model_config(config: &DesktopModelConfig) -> Result<(), String> {
    let path = desktop_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create Sonar config directory: {err}"))?;
    }

    if config.chat_base_url.trim().is_empty() {
        return Err("Generation API URL is required.".to_string());
    }
    if config.chat_model.trim().is_empty() {
        return Err("Generation model is required.".to_string());
    }
    if config.embedding_model.trim().is_empty() {
        return Err("Embedding model is required.".to_string());
    }
    let url = reqwest::Url::parse(config.chat_base_url.trim())
        .map_err(|_| "Generation API URL must be a valid URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Generation API URL must start with http:// or https://.".to_string());
    }

    let normalized = DesktopModelConfig {
        chat_base_url: config
            .chat_base_url
            .trim()
            .trim_end_matches('/')
            .to_string(),
        chat_model: config.chat_model.trim().to_string(),
        chat_api_key: if config.chat_api_key.trim().is_empty() {
            "not-needed".to_string()
        } else {
            config.chat_api_key.trim().to_string()
        },
        embedding_model: config.embedding_model.trim().to_string(),
    };
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|err| format!("Unable to serialize desktop config: {err}"))?;
    fs::write(path, json).map_err(|err| format!("Unable to write desktop config: {err}"))
}

async fn check_url(url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", response.status()))
    }
}

fn command_exists(name: &str) -> bool {
    Command::new(name)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn repository_cache_dir() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("SONAR_REPOSITORY_CACHE_DIR") {
        return Ok(PathBuf::from(path));
    }

    if let Ok(home) = env::var("HOME") {
        return Ok(PathBuf::from(home).join(".sonar").join("repositories"));
    }

    Ok(repo_root()?.join(".sonar").join("repositories"))
}

fn parse_github_repository(input: &str) -> Result<(String, String, String), String> {
    let mut value = input.trim().trim_end_matches('/').to_string();
    if value.is_empty() {
        return Err("Enter a GitHub repository URL or owner/repo path.".to_string());
    }

    if let Some(stripped) = value.strip_prefix("git@github.com:") {
        value = stripped.to_string();
    } else if let Some(stripped) = value.strip_prefix("https://github.com/") {
        value = stripped.to_string();
    } else if let Some(stripped) = value.strip_prefix("http://github.com/") {
        value = stripped.to_string();
    } else if let Some(stripped) = value.strip_prefix("github.com/") {
        value = stripped.to_string();
    }

    value = value
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_string();

    let parts: Vec<&str> = value.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Err("Use a GitHub repository such as https://github.com/owner/repo.".to_string());
    }

    let owner = parts[0].to_string();
    let repo = parts[1].to_string();
    if !is_safe_repo_part(&owner) || !is_safe_repo_part(&repo) {
        return Err(
            "Repository owner and name can only contain letters, numbers, '.', '_', and '-'."
                .to_string(),
        );
    }

    let clone_url = format!("https://github.com/{owner}/{repo}.git");
    Ok((owner, repo, clone_url))
}

fn is_safe_repo_part(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
}

fn run_git(args: &[&str], current_dir: Option<&Path>) -> Result<(), String> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(dir) = current_dir {
        command.current_dir(dir);
    }

    let output = command
        .stdin(Stdio::null())
        .output()
        .map_err(|err| format!("Unable to run git: {err}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("git exited with {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

fn start_docker_services() -> Result<(), String> {
    if !command_exists("docker") {
        return Err("Docker is not installed or not available on PATH".to_string());
    }

    let root = repo_root()?;
    let compose_file = root.join("docker-compose.sonar.yml");
    let status = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["up", "-d", "meilisearch", "qdrant", "ollama"])
        .current_dir(root)
        .status()
        .map_err(|err| err.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("docker compose exited with {status}"))
    }
}

fn ensure_embedding_model() -> Result<(), String> {
    if !command_exists("docker") {
        return Err("Docker is not installed or not available on PATH".to_string());
    }

    let root = repo_root()?;
    let compose_file = root.join("docker-compose.sonar.yml");
    let model = desktop_model_config().embedding_model;
    let status = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["exec", "-T", "ollama", "ollama", "pull"])
        .arg(model)
        .current_dir(root)
        .status()
        .map_err(|err| err.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("docker compose ollama pull exited with {status}"))
    }
}

fn start_sonar_api() -> Result<(), String> {
    let root = repo_root()?;
    let mut command = if root.join("dist/index.js").exists() {
        let mut command = Command::new("node");
        command.args(["dist/index.js", "--port", "3001"]);
        command
    } else {
        let mut command = Command::new("npm");
        command.args(["run", "dev", "--", "--port", "3001"]);
        command
    };

    let allowed_roots =
        env::var("SONAR_ALLOWED_REPO_ROOTS").unwrap_or_else(|_| root.display().to_string());
    let model_config = desktop_model_config();

    command
        .current_dir(&root)
        .env("SONAR_API_HOST", "127.0.0.1")
        .env(
            "SONAR_CORS_ALLOWED_ORIGINS",
            "http://tauri.localhost,http://127.0.0.1:5173,http://localhost:5173",
        )
        .env("SONAR_ALLOW_ANY_REPO_ROOT", "true")
        .env("SONAR_ALLOWED_REPO_ROOTS", allowed_roots)
        .env("SONAR_CHAT_BASE_URL", model_config.chat_base_url)
        .env("SONAR_CHAT_MODEL", model_config.chat_model)
        .env("SONAR_CHAT_API_KEY", model_config.chat_api_key)
        .env("SONAR_OLLAMA_BASE_URL", "http://localhost:11434")
        .env("SONAR_OLLAMA_EMBEDDING_MODEL", model_config.embedding_model)
        .env("SONAR_MEILI_HOST", "http://localhost:7700")
        .env("SONAR_MEILI_API_KEY", "masterKey")
        .env("SONAR_QDRANT_HOST", "localhost")
        .env("SONAR_QDRANT_PORT", "6333");

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

async fn service(id: &'static str, label: &'static str, url: &str, managed: bool) -> ServiceStatus {
    match check_url(url).await {
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

#[tauri::command]
fn clone_github_repository(repository: String) -> Result<ClonedRepository, String> {
    if !command_exists("git") {
        return Err("Git is not installed or not available on PATH.".to_string());
    }

    let (owner, repo, clone_url) = parse_github_repository(&repository)?;
    let cache_dir = repository_cache_dir()?;
    fs::create_dir_all(&cache_dir)
        .map_err(|err| format!("Unable to create repository cache directory: {err}"))?;

    let local_path = cache_dir.join(format!("{owner}-{repo}"));
    let updated_existing = if local_path.join(".git").is_dir() {
        run_git(&["pull", "--ff-only"], Some(&local_path))?;
        true
    } else {
        if local_path.exists() {
            return Err(format!(
                "{} already exists but is not a Git repository.",
                local_path.display()
            ));
        }
        run_git(
            &[
                "clone",
                "--depth",
                "1",
                clone_url.as_str(),
                local_path
                    .to_str()
                    .ok_or_else(|| "Repository path is not valid UTF-8.".to_string())?,
            ],
            None,
        )?;
        false
    };

    Ok(ClonedRepository {
        owner,
        repo,
        clone_url,
        local_path: local_path.display().to_string(),
        updated_existing,
    })
}

#[tauri::command]
async fn service_snapshot() -> ServiceSnapshot {
    let chat = chat_base_url();
    let chat_models = format!("{}/models", chat.trim_end_matches('/'));
    ServiceSnapshot {
        api_base_url: "http://127.0.0.1:3001".to_string(),
        chat_base_url: chat.clone(),
        services: vec![
            service("sonar", "Sonar API", "http://127.0.0.1:3001/health", true).await,
            service(
                "meilisearch",
                "Meilisearch",
                "http://127.0.0.1:7700/health",
                true,
            )
            .await,
            service("qdrant", "Qdrant", "http://127.0.0.1:6333/readyz", true).await,
            service(
                "ollama",
                "Ollama embeddings",
                "http://127.0.0.1:11434/api/tags",
                true,
            )
            .await,
            service("chat", "Chat model server", &chat_models, false).await,
        ],
    }
}

#[tauri::command]
async fn bootstrap_services() -> Result<ServiceSnapshot, String> {
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
            .any(|service| service.id == "ollama" && service.state != "ready")
    {
        let _ = start_docker_services();
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
fn get_model_config() -> DesktopModelConfig {
    desktop_model_config()
}

#[tauri::command]
async fn save_model_config(config: DesktopModelConfig) -> Result<ServiceSnapshot, String> {
    save_desktop_model_config(&config)?;
    let _ = start_docker_services();
    tokio::time::sleep(Duration::from_secs(2)).await;
    let _ = ensure_embedding_model();
    stop_sonar_api()?;
    start_sonar_api()?;
    tokio::time::sleep(Duration::from_secs(1)).await;
    Ok(service_snapshot().await)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            service_snapshot,
            bootstrap_services,
            clone_github_repository,
            get_model_config,
            save_model_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sonar desktop app");
}
