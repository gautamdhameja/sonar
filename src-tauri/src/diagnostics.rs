use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

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

fn redact_sensitive_text(contents: &str) -> String {
    contents
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if lower.contains("api_token")
                || lower.contains("sonar_api_token")
                || lower.contains("chat_api_key")
                || lower.contains("chatapikey")
                || lower.contains("authorization:")
                || lower.contains("bearer ")
                || lower.contains("sk-")
            {
                "[redacted]".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::redact_sensitive_text;

    #[test]
    fn diagnostics_redaction_removes_common_runtime_secrets() {
        let redacted = redact_sensitive_text(
            [
                "SONAR_API_TOKEN=abc123",
                r#""chatApiKey": "sk-secret""#,
                "Authorization: Bearer token",
                "ordinary log line",
            ]
            .join("\n")
            .as_str(),
        );

        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("sk-secret"));
        assert!(!redacted.contains("Bearer token"));
        assert!(redacted.contains("ordinary log line"));
    }
}
