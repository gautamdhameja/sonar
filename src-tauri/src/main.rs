mod api_proxy;
mod config;
mod diagnostics;
mod export;
mod llama_sidecar;
mod models;
mod paths;
mod process;
mod repositories;
mod services;

use api_proxy::sonar_api_request;
use diagnostics::create_diagnostics_bundle;
use export::export_markdown;
use repositories::{clone_github_repository, prepare_repository_for_indexing};
use services::{bootstrap_services, get_model_config, save_model_config, service_snapshot};

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
            create_diagnostics_bundle,
            export_markdown,
            sonar_api_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sonar desktop app");
}
