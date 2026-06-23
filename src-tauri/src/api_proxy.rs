use std::time::Duration;

use crate::config::runtime_api_token;
use reqwest::{Method, Url};
use serde_json::Value;

const API_BASE_URL: &str = "http://127.0.0.1:3001";

#[tauri::command]
pub async fn sonar_api_request(
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let method = parse_method(&method)?;
    let url = local_api_url(&path)?;
    let token = runtime_api_token()?;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .request(method.clone(), url)
        .header("X-Sonar-Token", token)
        .header("Content-Type", "application/json");

    if method != Method::GET {
        if let Some(body) = body {
            request = request.json(&body);
        }
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = response.text().await.map_err(|err| err.to_string())?;

    if !status.is_success() {
        return Err(error_message(status.as_u16(), &content_type, &text));
    }

    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    if content_type.contains("application/json") {
        serde_json::from_str(&text).map_err(|err| format!("Invalid Sonar API response: {err}"))
    } else {
        Ok(Value::String(text))
    }
}

fn parse_method(method: &str) -> Result<Method, String> {
    match method.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "DELETE" => Ok(Method::DELETE),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        _ => Err("Unsupported Sonar API method.".to_string()),
    }
}

fn local_api_url(path: &str) -> Result<Url, String> {
    let path = path.trim();
    if !path.starts_with('/') || path.starts_with("//") || path.contains("://") {
        return Err("Invalid Sonar API path.".to_string());
    }
    if path.chars().any(char::is_control) {
        return Err("Invalid Sonar API path.".to_string());
    }

    let url = Url::parse(&format!("{API_BASE_URL}{path}"))
        .map_err(|_| "Invalid Sonar API path.".to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port_or_known_default() != Some(3001)
    {
        return Err("Invalid Sonar API path.".to_string());
    }
    Ok(url)
}

fn error_message(status: u16, content_type: &str, text: &str) -> String {
    if content_type.contains("application/json") {
        if let Ok(Value::Object(body)) = serde_json::from_str::<Value>(text) {
            if let Some(error) = body.get("error").and_then(Value::as_str) {
                return error.to_string();
            }
        }
    }
    let text = text.trim();
    if text.is_empty() {
        format!("Request failed with {status}")
    } else {
        format!(
            "Request failed with {status}: {}",
            text.chars().take(300).collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{local_api_url, parse_method};

    #[test]
    fn accepts_relative_local_api_paths() {
        let url = local_api_url("/projects/abc/onboarding/sessions/latest").expect("valid path");
        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:3001/projects/abc/onboarding/sessions/latest"
        );
    }

    #[test]
    fn rejects_absolute_or_scheme_relative_paths() {
        assert!(local_api_url("http://127.0.0.1:3001/projects").is_err());
        assert!(local_api_url("//example.com/projects").is_err());
        assert!(local_api_url("projects").is_err());
    }

    #[test]
    fn rejects_unsupported_methods() {
        assert!(parse_method("TRACE").is_err());
    }
}
