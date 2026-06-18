use std::{collections::HashMap, env, fs, io::Write, net::TcpStream, path::PathBuf};

use crate::{models::DesktopModelConfig, paths::sonar_home};
use serde::Deserialize;

pub(crate) const DEFAULT_CHAT_BASE_URL: &str = "http://127.0.0.1:8080/v1";
const DEFAULT_CHAT_MODEL: &str = "local-model";
const DEFAULT_MODEL_MODE: &str = "local";
const LEGACY_CHAT_MODEL: &str = "Qwen/Qwen3.5-9B";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDesktopModelConfig {
    model_setup_complete: Option<bool>,
    model_mode: Option<String>,
    chat_base_url: Option<String>,
    chat_model: Option<String>,
    chat_api_key: Option<String>,
    api_token: Option<String>,
}

pub fn chat_base_url() -> String {
    env::var("SONAR_CHAT_BASE_URL").unwrap_or_else(|_| desktop_model_config().chat_base_url)
}

pub fn default_desktop_model_config() -> DesktopModelConfig {
    DesktopModelConfig {
        model_setup_complete: false,
        model_mode: env::var("SONAR_MODEL_MODE")
            .ok()
            .filter(|value| is_valid_model_mode(value))
            .unwrap_or_else(|| DEFAULT_MODEL_MODE.to_string()),
        chat_base_url: detect_chat_base_url(),
        chat_model: env::var("SONAR_CHAT_MODEL").unwrap_or_else(|_| DEFAULT_CHAT_MODEL.to_string()),
        chat_api_key: env::var("SONAR_CHAT_API_KEY").unwrap_or_else(|_| "not-needed".to_string()),
        api_token: runtime_api_token().unwrap_or_else(|_| generate_api_token()),
    }
}

pub fn desktop_model_config() -> DesktopModelConfig {
    let fallback = default_desktop_model_config();
    let Ok(path) = desktop_config_path() else {
        return fallback;
    };
    let Ok(contents) = fs::read_to_string(&path) else {
        return fallback;
    };
    let Ok(stored) = serde_json::from_str::<StoredDesktopModelConfig>(&contents) else {
        return fallback;
    };
    let inferred_model_mode = stored
        .model_mode
        .as_deref()
        .filter(|value| is_valid_model_mode(value))
        .map(str::to_string)
        .unwrap_or_else(|| infer_model_mode(&stored, &fallback));
    let mut stored = DesktopModelConfig {
        model_setup_complete: stored.model_setup_complete.unwrap_or(true),
        model_mode: inferred_model_mode,
        chat_base_url: stored
            .chat_base_url
            .unwrap_or_else(|| fallback.chat_base_url.clone()),
        chat_model: stored
            .chat_model
            .unwrap_or_else(|| fallback.chat_model.clone()),
        chat_api_key: stored
            .chat_api_key
            .unwrap_or_else(|| fallback.chat_api_key.clone()),
        api_token: stored
            .api_token
            .unwrap_or_else(|| fallback.api_token.clone()),
    };
    if stored.chat_model == LEGACY_CHAT_MODEL {
        stored.chat_base_url = fallback.chat_base_url;
        stored.chat_model = fallback.chat_model;
        stored.chat_api_key = fallback.chat_api_key;
        stored.model_setup_complete = fallback.model_setup_complete;
        stored.model_mode = fallback.model_mode;
    }
    if stored.api_token.trim().is_empty()
        || runtime_api_token()
            .map(|token| token != stored.api_token)
            .unwrap_or(false)
    {
        stored.api_token = fallback.api_token;
    }
    let _ = write_desktop_model_config(&path, &stored);
    stored
}

pub fn save_desktop_model_config(config: &DesktopModelConfig) -> Result<(), String> {
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
    if !is_valid_model_mode(&config.model_mode) {
        return Err("Model source must be local or api.".to_string());
    }
    validate_http_url(config.chat_base_url.trim(), "Generation API URL")?;

    let normalized = DesktopModelConfig {
        model_setup_complete: true,
        model_mode: config.model_mode.trim().to_string(),
        chat_base_url: normalize_url(&config.chat_base_url),
        chat_model: config.chat_model.trim().to_string(),
        chat_api_key: normalize_api_key(&config.chat_api_key),
        api_token: runtime_api_token()?,
    };
    write_desktop_model_config(&path, &normalized)
}

pub fn desktop_model_setup_complete() -> bool {
    let Ok(path) = desktop_config_path() else {
        return false;
    };
    let Ok(contents) = fs::read_to_string(&path) else {
        return false;
    };
    serde_json::from_str::<StoredDesktopModelConfig>(&contents)
        .map(|stored| stored.model_setup_complete.unwrap_or(true))
        .unwrap_or(false)
}

fn is_valid_model_mode(value: &str) -> bool {
    matches!(value.trim(), "local" | "api")
}

fn infer_model_mode(stored: &StoredDesktopModelConfig, fallback: &DesktopModelConfig) -> String {
    let chat_base_url = stored
        .chat_base_url
        .as_deref()
        .unwrap_or(&fallback.chat_base_url);
    if normalize_url(chat_base_url) == normalize_url(DEFAULT_CHAT_BASE_URL) {
        "local".to_string()
    } else {
        "api".to_string()
    }
}

fn write_desktop_model_config(path: &PathBuf, config: &DesktopModelConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create Sonar config directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|err| format!("Unable to serialize desktop config: {err}"))?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
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

pub fn runtime_api_token() -> Result<String, String> {
    Ok(ensure_runtime_env()?.api_token)
}

pub fn ensure_runtime_env() -> Result<RuntimeEnv, String> {
    let path = runtime_env_path()?;
    let mut values = read_env_file(&path)?;

    let api_token = env::var("SONAR_API_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| values.get("SONAR_API_TOKEN").cloned())
        .unwrap_or_else(generate_api_token);
    values.insert("SONAR_API_TOKEN".to_string(), api_token.clone());

    write_runtime_env(&path, &values)?;
    Ok(RuntimeEnv { api_token })
}

pub struct RuntimeEnv {
    pub api_token: String,
}

fn runtime_env_path() -> Result<PathBuf, String> {
    Ok(sonar_home()?.join("runtime.env"))
}

fn read_env_file(path: &PathBuf) -> Result<HashMap<String, String>, String> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(err) => return Err(format!("Unable to read Sonar runtime env: {err}")),
    };
    let mut values = HashMap::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            values.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    Ok(values)
}

fn write_runtime_env(path: &PathBuf, values: &HashMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create Sonar runtime directory: {err}"))?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|err| format!("Unable to write Sonar runtime env: {err}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|err| format!("Unable to secure Sonar runtime env permissions: {err}"))?;
    }
    let mut lines = vec![
        "# Generated by Sonar. Do not commit.".to_string(),
        format!("SONAR_API_TOKEN={}", values["SONAR_API_TOKEN"]),
    ];
    lines.push(String::new());
    file.write_all(lines.join("\n").as_bytes())
        .map_err(|err| format!("Unable to write Sonar runtime env: {err}"))
}

fn generate_api_token() -> String {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .expect("secure OS random source is required to create the Sonar runtime token");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_http_url(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{label} is required."));
    }
    let url = reqwest::Url::parse(value).map_err(|_| format!("{label} must be a valid URL."))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(format!("{label} must start with http:// or https://."));
    }
    Ok(())
}

fn normalize_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn normalize_api_key(value: &str) -> String {
    if value.trim().is_empty() {
        "not-needed".to_string()
    } else {
        value.trim().to_string()
    }
}

fn desktop_config_path() -> Result<PathBuf, String> {
    Ok(sonar_home()?.join("desktop-config.json"))
}

fn detect_chat_base_url() -> String {
    for (port, url) in [(8080, DEFAULT_CHAT_BASE_URL)] {
        if TcpStream::connect(("127.0.0.1", port))
            .map(|stream| stream.set_nonblocking(true).is_ok())
            .unwrap_or(false)
        {
            return url.to_string();
        }
    }

    DEFAULT_CHAT_BASE_URL.to_string()
}
