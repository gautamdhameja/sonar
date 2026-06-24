use std::{
    fs,
    path::Path,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use serde::Serialize;

use crate::{config::desktop_model_config, paths::sonar_home, services::service_snapshot};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsBundle {
    pub directory_path: String,
    pub manifest_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsManifest {
    created_at_unix_seconds: u64,
    app_version: &'static str,
    platform: &'static str,
    arch: &'static str,
    sonar_home: String,
    model_config: RedactedModelConfig,
    service_snapshot: crate::models::ServiceSnapshot,
    files: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedModelConfig {
    model_setup_complete: bool,
    model_mode: String,
    chat_base_url: String,
    chat_model: String,
    chat_api_key: &'static str,
}

#[tauri::command]
pub async fn create_diagnostics_bundle() -> Result<DiagnosticsBundle, String> {
    let home = sonar_home()?;
    let diagnostics_root = home.join("diagnostics");
    fs::create_dir_all(&diagnostics_root)
        .map_err(|err| format!("Unable to create diagnostics directory: {err}"))?;

    let created_at_unix_seconds = unix_seconds()?;
    let bundle_dir = diagnostics_root.join(format!("sonar-diagnostics-{created_at_unix_seconds}"));
    fs::create_dir_all(&bundle_dir)
        .map_err(|err| format!("Unable to create diagnostics bundle: {err}"))?;

    let mut files = Vec::new();
    copy_redacted_if_exists(
        &home.join("api.log"),
        &bundle_dir.join("api.log"),
        &mut files,
    )?;
    copy_redacted_if_exists(
        &home.join("llama-server.log"),
        &bundle_dir.join("llama-server.log"),
        &mut files,
    )?;
    copy_redacted_if_exists(
        &home.join("runtime.env"),
        &bundle_dir.join("runtime.env.redacted"),
        &mut files,
    )?;
    copy_redacted_if_exists(
        &home.join("desktop-config.json"),
        &bundle_dir.join("desktop-config.redacted.json"),
        &mut files,
    )?;

    let model_config = desktop_model_config();
    let manifest = DiagnosticsManifest {
        created_at_unix_seconds,
        app_version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        sonar_home: home.to_string_lossy().into_owned(),
        model_config: RedactedModelConfig {
            model_setup_complete: model_config.model_setup_complete,
            model_mode: model_config.model_mode,
            chat_base_url: model_config.chat_base_url,
            chat_model: model_config.chat_model,
            chat_api_key: "[redacted]",
        },
        service_snapshot: service_snapshot().await,
        files,
    };
    let manifest_path = bundle_dir.join("manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|err| format!("Unable to serialize diagnostics manifest: {err}"))?;
    fs::write(&manifest_path, manifest_json)
        .map_err(|err| format!("Unable to write diagnostics manifest: {err}"))?;

    Ok(DiagnosticsBundle {
        directory_path: bundle_dir.to_string_lossy().into_owned(),
        manifest_path: manifest_path.to_string_lossy().into_owned(),
    })
}

fn unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|err| format!("System clock is before Unix epoch: {err}"))
}

fn copy_redacted_if_exists(
    source: &Path,
    destination: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    let contents = match fs::read_to_string(source) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(format!(
                "Unable to read diagnostics source {}: {err}",
                source.display()
            ))
        }
    };
    let redacted = redact_sensitive_text(&contents);
    fs::write(destination, redacted).map_err(|err| {
        format!(
            "Unable to write diagnostics file {}: {err}",
            destination.display()
        )
    })?;
    if let Some(file_name) = destination.file_name().and_then(|name| name.to_str()) {
        files.push(file_name.to_string());
    }
    Ok(())
}

// Keep this diagnostics redactor aligned with src/security/source-safety.ts.
fn redact_sensitive_text(contents: &str) -> String {
    let redacted_blocks = pem_block_pattern().replace_all(contents, "[redacted secret block]");

    redacted_blocks
        .lines()
        .map(redact_sensitive_line)
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_sensitive_line(line: &str) -> String {
    if let Some(redacted) = redact_secret_assignment(line) {
        return redacted;
    }
    if let Some(redacted) = redact_secret_json_value(line) {
        return redacted;
    }

    let lower = line.to_ascii_lowercase();
    if lower.contains("authorization:")
        || lower.contains("bearer ")
        || lower.contains("sk-")
        || secret_url_value_pattern().is_match(line)
    {
        return "[redacted]".to_string();
    }

    line.to_string()
}

fn redact_secret_assignment(line: &str) -> Option<String> {
    if let Some(captures) = secret_assignment_pattern().captures(line) {
        return Some(format!("{}[redacted]", &captures[1]));
    }
    if let Some(captures) = assignment_pattern().captures(line) {
        let value = &captures[2];
        if secret_url_value_pattern().is_match(value) {
            return Some(format!("{}[redacted]", &captures[1]));
        }
    }
    None
}

fn redact_secret_json_value(line: &str) -> Option<String> {
    if let Some(captures) = secret_json_pattern().captures(line) {
        return Some(format!(
            "{}{}[redacted]{}",
            &captures[1], &captures[2], &captures[3]
        ));
    }
    if let Some(captures) = json_value_pattern().captures(line) {
        let value = &captures[3];
        if secret_url_value_pattern().is_match(value) {
            return Some(format!(
                "{}{}[redacted]{}",
                &captures[1], &captures[2], &captures[4]
            ));
        }
    }
    None
}

fn pem_block_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?s)-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----.*?-----END [^-]*(?:PRIVATE KEY|CERTIFICATE)-----")
            .expect("valid PEM redaction regex")
    })
}

fn secret_assignment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)^(\s*(?:export\s+)?[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|ACCESS[_-]?KEY|REFRESH[_-]?TOKEN|CONNECTION[_-]?STRING|CREDENTIAL|AUTH)[A-Z0-9_]*\s*[:=]\s*)(.+)$")
            .expect("valid secret assignment redaction regex")
    })
}

fn assignment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^(\s*(?:export\s+)?[A-Z0-9_]+\s*[:=]\s*)(.+)$")
            .expect("valid assignment redaction regex")
    })
}

fn secret_json_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r#"(?i)^(\s*["'][^"']*(?:api[_-]?key|token|secret|password|passwd|pwd|private[_-]?key|client[_-]?secret|access[_-]?key|refresh[_-]?token|connection[_-]?string|credential|auth)[^"']*["']\s*:\s*)(["']).*?(["']\s*,?\s*)$"#)
            .expect("valid secret JSON redaction regex")
    })
}

fn json_value_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r#"^(\s*["'][^"']+["']\s*:\s*)(["'])(.*?)(["']\s*,?\s*)$"#)
            .expect("valid JSON value redaction regex")
    })
}

fn secret_url_value_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"://[^:/\s]+:[^@\s]+@").expect("valid credential URL redaction regex")
    })
}

#[cfg(test)]
mod tests {
    use super::redact_sensitive_text;

    #[test]
    fn diagnostics_redaction_removes_common_runtime_secrets() {
        let redacted = redact_sensitive_text(
            [
                "SONAR_API_TOKEN=abc123",
                "ANTHROPIC_API_KEY=anthropic-secret",
                "HF_TOKEN=hf-secret",
                "DATABASE_URL=postgres://user:pass@host/db",
                r#""chatApiKey": "sk-secret""#,
                r#""databaseUrl": "postgres://json_user:json_pass@host/db","#,
                r#""clientSecret": "json-secret","#,
                "Authorization: Bearer token",
                "-----BEGIN PRIVATE KEY-----",
                "private-key-body",
                "-----END PRIVATE KEY-----",
                "ordinary log line",
            ]
            .join("\n")
            .as_str(),
        );

        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("anthropic-secret"));
        assert!(!redacted.contains("hf-secret"));
        assert!(!redacted.contains("user:pass"));
        assert!(!redacted.contains("json_user:json_pass"));
        assert!(!redacted.contains("json-secret"));
        assert!(!redacted.contains("sk-secret"));
        assert!(!redacted.contains("Bearer token"));
        assert!(!redacted.contains("private-key-body"));
        assert!(redacted.contains("ordinary log line"));
    }
}
