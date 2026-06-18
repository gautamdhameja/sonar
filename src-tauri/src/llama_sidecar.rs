use std::{
    env, fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

use crate::{models::DesktopModelConfig, paths::sonar_home};

const LLAMA_HOST: &str = "127.0.0.1";
const LLAMA_PORT: &str = "8080";
const LLAMA_PORT_NUMBER: u16 = 8080;

pub fn start_llama_sidecar_if_available(config: &DesktopModelConfig) -> Result<bool, String> {
    if std::net::TcpStream::connect((LLAMA_HOST, LLAMA_PORT_NUMBER)).is_ok() {
        return Ok(true);
    }

    let binary = llama_server_path()?;
    let model = llama_model_path()?;
    if !binary.is_file() || !model.is_file() {
        return Ok(false);
    }

    let data_dir = sonar_home()?;
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Unable to create Sonar data directory: {err}"))?;
    let log_path = data_dir.join("llama-server.log");
    let stdout = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|err| format!("Unable to open llama.cpp server log: {err}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|err| format!("Unable to prepare llama.cpp server log: {err}"))?;

    let child = Command::new(&binary)
        .args([
            "--host",
            LLAMA_HOST,
            "--port",
            LLAMA_PORT,
            "--model",
            model.to_string_lossy().as_ref(),
        ])
        .arg("--alias")
        .arg(config.chat_model.trim())
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|err| format!("Unable to start llama.cpp server: {err}"))?;
    write_llama_pid(child.id())
}

pub fn missing_llama_sidecar_message() -> String {
    let binary = llama_server_path()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "~/.sonar/bin/llama-server".to_string());
    let model = llama_model_path()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "~/.sonar/models/default.gguf".to_string());
    format!(
        "Local llama.cpp is not running. Start an OpenAI-compatible server at http://127.0.0.1:8080/v1, or install the sidecar binary at {binary} and a GGUF model at {model}."
    )
}

fn llama_server_path() -> Result<PathBuf, String> {
    env::var("SONAR_LLAMA_SERVER_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| Ok(sonar_home()?.join("bin").join("llama-server")))
}

fn llama_model_path() -> Result<PathBuf, String> {
    env::var("SONAR_LLAMA_MODEL_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| Ok(sonar_home()?.join("models").join("default.gguf")))
}

fn write_llama_pid(pid: u32) -> Result<bool, String> {
    let path = sonar_home()?.join("llama-server.pid");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create Sonar data directory: {err}"))?;
    }
    let mut file = fs::File::create(path)
        .map_err(|err| format!("Unable to write llama.cpp process id: {err}"))?;
    file.write_all(pid.to_string().as_bytes())
        .map_err(|err| format!("Unable to write llama.cpp process id: {err}"))?;
    Ok(true)
}
