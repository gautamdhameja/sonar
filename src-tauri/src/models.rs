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
    pub model_mode: String,
    pub chat_base_url: String,
    pub chat_model: String,
    pub chat_api_key: String,
    pub embedding_base_url: String,
    pub embedding_model: String,
    pub embedding_api_key: String,
    pub embedding_vector_size: u32,
    pub api_token: String,
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
    pub copied_to_docker: bool,
}
