use std::{env, fs, io::Write, net::TcpStream, path::PathBuf};

use crate::{models::DesktopModelConfig, paths::sonar_home};
use serde::Deserialize;

pub(crate) const DEFAULT_CHAT_BASE_URL: &str = "http://localhost:12434/engines/llama.cpp/v1";
pub(crate) const DEFAULT_EMBEDDING_BASE_URL: &str = "http://localhost:12434/engines/v1";
const DEFAULT_CHAT_MODEL: &str = "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL";
const DEFAULT_EMBEDDING_MODEL: &str = "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M";
const LEGACY_CHAT_MODEL: &str = "Qwen/Qwen3.5-9B";

#[derive(Deserialize)]
struct StoredDesktopModelConfig {
    chat_base_url: Option<String>,
    chat_model: Option<String>,
    chat_api_key: Option<String>,
    embedding_base_url: Option<String>,
    embedding_model: Option<String>,
    embedding_api_key: Option<String>,
    api_token: Option<String>,
}

pub fn chat_base_url() -> String {
    env::var("SONAR_CHAT_BASE_URL").unwrap_or_else(|_| desktop_model_config().chat_base_url)
}

pub fn default_desktop_model_config() -> DesktopModelConfig {
    DesktopModelConfig {
        chat_base_url: detect_chat_base_url(),
        chat_model: env::var("SONAR_CHAT_MODEL").unwrap_or_else(|_| DEFAULT_CHAT_MODEL.to_string()),
        chat_api_key: env::var("SONAR_CHAT_API_KEY").unwrap_or_else(|_| "not-needed".to_string()),
        embedding_base_url: env::var("SONAR_EMBEDDING_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_EMBEDDING_BASE_URL.to_string()),
        embedding_model: env::var("SONAR_EMBEDDING_MODEL")
            .or_else(|_| env::var("SONAR_OLLAMA_EMBEDDING_MODEL"))
            .unwrap_or_else(|_| DEFAULT_EMBEDDING_MODEL.to_string()),
        embedding_api_key: env::var("SONAR_EMBEDDING_API_KEY")
            .unwrap_or_else(|_| "not-needed".to_string()),
        api_token: env::var("SONAR_API_TOKEN").unwrap_or_else(|_| generate_api_token()),
    }
}

pub fn desktop_model_config() -> DesktopModelConfig {
    let fallback = default_desktop_model_config();
    let Ok(path) = desktop_config_path() else {
        return fallback;
    };
    let Ok(contents) = fs::read_to_string(&path) else {
        let _ = write_desktop_model_config(&path, &fallback);
        return fallback;
    };
    let Ok(stored) = serde_json::from_str::<StoredDesktopModelConfig>(&contents) else {
        return fallback;
    };
    let mut stored = DesktopModelConfig {
        chat_base_url: stored
            .chat_base_url
            .unwrap_or_else(|| fallback.chat_base_url.clone()),
        chat_model: stored
            .chat_model
            .unwrap_or_else(|| fallback.chat_model.clone()),
        chat_api_key: stored
            .chat_api_key
            .unwrap_or_else(|| fallback.chat_api_key.clone()),
        embedding_base_url: stored
            .embedding_base_url
            .unwrap_or_else(|| fallback.embedding_base_url.clone()),
        embedding_model: stored
            .embedding_model
            .unwrap_or_else(|| fallback.embedding_model.clone()),
        embedding_api_key: stored
            .embedding_api_key
            .unwrap_or_else(|| fallback.embedding_api_key.clone()),
        api_token: stored
            .api_token
            .unwrap_or_else(|| fallback.api_token.clone()),
    };
    if stored.chat_model == LEGACY_CHAT_MODEL {
        stored.chat_base_url = fallback.chat_base_url;
        stored.chat_model = fallback.chat_model;
        stored.chat_api_key = fallback.chat_api_key;
        stored.embedding_base_url = fallback.embedding_base_url;
        stored.embedding_api_key = fallback.embedding_api_key;
        if stored.embedding_model == "nomic-embed-text" {
            stored.embedding_model = fallback.embedding_model;
        }
    }
    if stored.api_token.trim().is_empty() {
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
    if config.embedding_model.trim().is_empty() {
        return Err("Embedding model is required.".to_string());
    }
    validate_http_url(config.chat_base_url.trim(), "Generation API URL")?;
    validate_http_url(config.embedding_base_url.trim(), "Embedding API URL")?;

    let normalized = DesktopModelConfig {
        chat_base_url: normalize_url(&config.chat_base_url),
        chat_model: config.chat_model.trim().to_string(),
        chat_api_key: normalize_api_key(&config.chat_api_key),
        embedding_base_url: normalize_url(&config.embedding_base_url),
        embedding_model: config.embedding_model.trim().to_string(),
        embedding_api_key: normalize_api_key(&config.embedding_api_key),
        api_token: if config.api_token.trim().is_empty() {
            generate_api_token()
        } else {
            config.api_token.trim().to_string()
        },
    };
    write_desktop_model_config(&path, &normalized)
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

fn generate_api_token() -> String {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .expect("secure OS random source is required to create the Sonar API token");
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
