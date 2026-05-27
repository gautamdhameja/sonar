use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    env, fs,
    hash::{Hash, Hasher},
    io::Write,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};

static API_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
const DEFAULT_CHAT_BASE_URL: &str = "http://localhost:12434/engines/llama.cpp/v1";
const DEFAULT_CHAT_MODEL: &str = "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL";
const DEFAULT_EMBEDDING_MODEL: &str = "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M";
const LEGACY_CHAT_MODEL: &str = "Qwen/Qwen3.5-9B";

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedRepository {
    local_path: String,
    indexed_path: String,
    copied_to_docker: bool,
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
    for (port, url) in [(12434, DEFAULT_CHAT_BASE_URL)] {
        if TcpStream::connect(("127.0.0.1", port))
            .map(|stream| stream.set_nonblocking(true).is_ok())
            .unwrap_or(false)
        {
            return url.to_string();
        }
    }

    DEFAULT_CHAT_BASE_URL.to_string()
}

fn default_desktop_model_config() -> DesktopModelConfig {
    DesktopModelConfig {
        chat_base_url: detect_chat_base_url(),
        chat_model: env::var("SONAR_CHAT_MODEL").unwrap_or_else(|_| DEFAULT_CHAT_MODEL.to_string()),
        chat_api_key: env::var("SONAR_CHAT_API_KEY").unwrap_or_else(|_| "not-needed".to_string()),
        embedding_model: env::var("SONAR_EMBEDDING_MODEL")
            .or_else(|_| env::var("SONAR_OLLAMA_EMBEDDING_MODEL"))
            .unwrap_or_else(|_| DEFAULT_EMBEDDING_MODEL.to_string()),
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
    let mut stored: DesktopModelConfig =
        serde_json::from_str(&contents).unwrap_or(fallback.clone());
    if stored.chat_model == LEGACY_CHAT_MODEL {
        stored.chat_base_url = fallback.chat_base_url;
        stored.chat_model = fallback.chat_model;
        stored.chat_api_key = fallback.chat_api_key;
        if stored.embedding_model == "nomic-embed-text" {
            stored.embedding_model = fallback.embedding_model;
        }
    }
    stored
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
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&path)
        .map_err(|err| format!("Unable to write desktop config: {err}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|err| format!("Unable to secure desktop config permissions: {err}"))?;
    }
    file.write_all(json.as_bytes())
        .map_err(|err| format!("Unable to write desktop config: {err}"))
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

fn run_docker(args: &[String]) -> Result<(), String> {
    let output = Command::new("docker")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|err| format!("Unable to run docker: {err}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("docker exited with {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

fn docker_api_container_running() -> bool {
    let output = Command::new("docker")
        .args(["inspect", "-f", "{{.State.Running}}", "sonar-api-1"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();

    match output {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim() == "true"
        }
        _ => false,
    }
}

fn safe_repository_volume_name(repo_path: &Path, project_name: &str) -> String {
    let raw = if project_name.trim().is_empty() {
        repo_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("repository")
            .to_string()
    } else {
        project_name.trim().to_string()
    };

    let sanitized: String = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    let base = if trimmed.is_empty() {
        "repository".to_string()
    } else {
        trimmed.chars().take(64).collect()
    };
    let mut hasher = DefaultHasher::new();
    repo_path.display().to_string().hash(&mut hasher);
    format!("{base}-{:08x}", hasher.finish() as u32)
}

fn start_docker_services() -> Result<(), String> {
    if !command_exists("docker") {
        return Err("Docker is not installed or not available on PATH".to_string());
    }

    let root = repo_root()?;
    let compose_file = root.join("compose.yml");
    let model_config = desktop_model_config();
    let status = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["up", "-d"])
        .current_dir(root)
        .env("SONAR_CHAT_MODEL", model_config.chat_model)
        .env("SONAR_EMBEDDING_MODEL", model_config.embedding_model)
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
    if TcpStream::connect(("127.0.0.1", 3001)).is_ok() {
        return Ok(());
    }

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

    let allowed_roots = env::var("SONAR_ALLOWED_REPO_ROOTS").unwrap_or_else(|_| {
        let mut roots = vec![root.display().to_string()];
        if let Ok(cache_dir) = repository_cache_dir() {
            roots.push(cache_dir.display().to_string());
        }
        roots.join(",")
    });
    let model_config = desktop_model_config();

    command
        .current_dir(&root)
        .env("SONAR_API_HOST", "127.0.0.1")
        .env(
            "SONAR_CORS_ALLOWED_ORIGINS",
            "http://tauri.localhost,http://127.0.0.1:5173,http://localhost:5173",
        )
        .env("SONAR_ALLOWED_REPO_ROOTS", allowed_roots)
        .env("SONAR_CHAT_BASE_URL", model_config.chat_base_url)
        .env("SONAR_CHAT_MODEL", model_config.chat_model)
        .env("SONAR_CHAT_API_KEY", model_config.chat_api_key)
        .env("SONAR_EMBEDDING_PROVIDER", "openai")
        .env("SONAR_EMBEDDING_BASE_URL", DEFAULT_CHAT_BASE_URL)
        .env("SONAR_EMBEDDING_MODEL", model_config.embedding_model)
        .env("SONAR_EMBEDDING_API_KEY", "not-needed")
        .env("SONAR_MEILI_HOST", "http://localhost:7700")
        .env(
            "SONAR_MEILI_API_KEY",
            env::var("SONAR_MEILI_MASTER_KEY")
                .unwrap_or_else(|_| "dev-only-master-key".to_string()),
        )
        .env("SONAR_QDRANT_HOST", "localhost")
        .env("SONAR_QDRANT_PORT", "6333")
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
fn prepare_repository_for_indexing(
    repo_path: String,
    project_name: String,
) -> Result<PreparedRepository, String> {
    let source = fs::canonicalize(&repo_path)
        .map_err(|err| format!("Unable to access selected repository: {err}"))?;
    if !source.is_dir() {
        return Err("Selected repository path is not a directory.".to_string());
    }

    if !docker_api_container_running() {
        return Ok(PreparedRepository {
            local_path: source.display().to_string(),
            indexed_path: source.display().to_string(),
            copied_to_docker: false,
        });
    }

    let repo_name = safe_repository_volume_name(&source, &project_name);
    let target = format!("/workspace/repos/{repo_name}");
    run_docker(&[
        "exec".to_string(),
        "sonar-api-1".to_string(),
        "rm".to_string(),
        "-rf".to_string(),
        target.clone(),
    ])?;
    run_docker(&[
        "exec".to_string(),
        "sonar-api-1".to_string(),
        "mkdir".to_string(),
        "-p".to_string(),
        target.clone(),
    ])?;

    let source_contents = source.join(".");
    run_docker(&[
        "cp".to_string(),
        source_contents.display().to_string(),
        format!("sonar-api-1:{target}"),
    ])?;

    Ok(PreparedRepository {
        local_path: source.display().to_string(),
        indexed_path: target,
        copied_to_docker: true,
    })
}

#[tauri::command]
async fn service_snapshot() -> ServiceSnapshot {
    let chat = chat_base_url();
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
                "models",
                "Docker model services",
                "http://127.0.0.1:3001/health/dependencies",
                true,
            )
            .await,
            service(
                "chat",
                "Chat model server",
                "http://127.0.0.1:3001/health/dependencies",
                true,
            )
            .await,
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
fn get_model_config() -> DesktopModelConfig {
    desktop_model_config()
}

#[tauri::command]
async fn save_model_config(config: DesktopModelConfig) -> Result<ServiceSnapshot, String> {
    save_desktop_model_config(&config)?;
    start_docker_services()?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let _ = ensure_embedding_model();
    stop_sonar_api()?;
    start_sonar_api()?;
    tokio::time::sleep(Duration::from_secs(1)).await;
    Ok(service_snapshot().await)
}

#[tauri::command]
fn export_markdown(path: String, contents: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Choose a file path before exporting.".to_string());
    }

    let target = PathBuf::from(path);
    if target.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err("Briefings can only be exported as Markdown (.md) files.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Choose a file inside an existing folder.".to_string())?;
    if !parent.is_dir() {
        return Err("Choose a file inside an existing folder.".to_string());
    }
    fs::write(&target, contents).map_err(|err| format!("Unable to export briefing: {err}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            service_snapshot,
            bootstrap_services,
            clone_github_repository,
            prepare_repository_for_indexing,
            get_model_config,
            save_model_config,
            export_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sonar desktop app");
}
