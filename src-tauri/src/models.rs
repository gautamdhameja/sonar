use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub state: &'static str,
    pub detail: String,
    pub url: Option<String>,
    pub managed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSnapshot {
    pub services: Vec<ServiceStatus>,
    pub api_base_url: String,
    pub chat_base_url: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopModelConfig {
    pub model_setup_complete: bool,
    pub model_mode: String,
    pub chat_base_url: String,
    pub chat_model: String,
    pub chat_api_key: String,
    #[serde(default, skip_serializing)]
    pub api_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelDiscovery {
    pub found: bool,
    pub chat_base_url: String,
    pub chat_model: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClonedRepository {
    pub owner: String,
    pub repo: String,
    pub clone_url: String,
    pub local_path: String,
    pub updated_existing: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRepository {
    pub local_path: String,
    pub indexed_path: String,
}

#[cfg(test)]
mod tests {
    use super::DesktopModelConfig;

    #[test]
    fn desktop_model_config_serialization_hides_runtime_api_token() {
        let config = DesktopModelConfig {
            model_setup_complete: true,
            model_mode: "local".to_string(),
            chat_base_url: "http://127.0.0.1:8080/v1".to_string(),
            chat_model: "local-model".to_string(),
            chat_api_key: "not-needed".to_string(),
            api_token: "secret-runtime-token".to_string(),
        };

        let value = serde_json::to_value(config).expect("config serializes");

        assert!(value.get("apiToken").is_none());
    }

    #[test]
    fn desktop_model_config_deserialization_allows_missing_runtime_api_token() {
        let config: DesktopModelConfig = serde_json::from_str(
            r#"{
                "modelSetupComplete": true,
                "modelMode": "local",
                "chatBaseUrl": "http://127.0.0.1:8080/v1",
                "chatModel": "local-model",
                "chatApiKey": "not-needed"
            }"#,
        )
        .expect("config deserializes without renderer token");

        assert_eq!(config.api_token, "");
    }
}
