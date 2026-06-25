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
mod state;

use api_proxy::sonar_api_request;
use diagnostics::create_diagnostics_bundle;
use export::export_markdown;
use repositories::{clone_github_repository, prepare_repository_for_indexing};
use services::{
    bootstrap_services, discover_local_model, get_model_config, save_model_config,
    service_snapshot, shutdown_managed_services,
};
use state::clear_local_app_state;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            service_snapshot,
            bootstrap_services,
            discover_local_model,
            clone_github_repository,
            prepare_repository_for_indexing,
            get_model_config,
            save_model_config,
            create_diagnostics_bundle,
            export_markdown,
            sonar_api_request,
            clear_local_app_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Sonar desktop app");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Err(err) = shutdown_managed_services() {
                eprintln!("Unable to stop Sonar managed services during app shutdown: {err}");
            }
        }
    });
}
