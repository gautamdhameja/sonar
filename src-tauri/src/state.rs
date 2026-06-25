use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;

use crate::{paths::sonar_home, services::shutdown_managed_services};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearLocalAppStateResult {
    data_dir: String,
}

#[tauri::command]
pub fn clear_local_app_state() -> Result<ClearLocalAppStateResult, String> {
    shutdown_managed_services()?;

    let data_dir = safe_sonar_data_dir()?;
    if data_dir.exists() {
        remove_state_entries(&data_dir)?;
    }

    Ok(ClearLocalAppStateResult {
        data_dir: data_dir.to_string_lossy().to_string(),
    })
}

fn remove_state_entries(data_dir: &Path) -> Result<(), String> {
    let preserved = ["bin", "models"];
    let entries = fs::read_dir(data_dir).map_err(|err| {
        format!(
            "Unable to inspect Sonar local state at {}: {err}",
            data_dir.display()
        )
    })?;

    for entry in entries {
        let entry =
            entry.map_err(|err| format!("Unable to inspect Sonar local state entry: {err}"))?;
        let name = entry.file_name();
        if preserved
            .iter()
            .any(|preserved_name| name == *preserved_name)
        {
            continue;
        }

        let path = entry.path();
        let file_type = entry.file_type().map_err(|err| {
            format!(
                "Unable to inspect Sonar local state entry {}: {err}",
                path.display()
            )
        })?;
        if file_type.is_dir() {
            fs::remove_dir_all(&path).map_err(|err| {
                format!(
                    "Unable to remove Sonar local state directory {}: {err}",
                    path.display()
                )
            })?;
        } else {
            fs::remove_file(&path).map_err(|err| {
                format!(
                    "Unable to remove Sonar local state file {}: {err}",
                    path.display()
                )
            })?;
        }
    }

    let mut remaining = fs::read_dir(data_dir).map_err(|err| {
        format!(
            "Unable to verify Sonar local state at {}: {err}",
            data_dir.display()
        )
    })?;
    if remaining.next().is_none() {
        fs::remove_dir(data_dir).map_err(|err| {
            format!(
                "Unable to remove empty Sonar local state directory {}: {err}",
                data_dir.display()
            )
        })?;
    }
    Ok(())
}

fn safe_sonar_data_dir() -> Result<PathBuf, String> {
    let path = absolutize(&sonar_home()?)?;
    validate_deletable_sonar_data_dir(&path)?;
    Ok(path)
}

fn absolutize(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|err| format!("Unable to resolve Sonar data directory: {err}"));
    }
    if path.is_absolute() {
        Ok(normalize_missing_path(path))
    } else {
        let current_dir = std::env::current_dir()
            .map_err(|err| format!("Unable to resolve current directory: {err}"))?;
        Ok(normalize_missing_path(&current_dir.join(path)))
    }
}

fn normalize_missing_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn validate_deletable_sonar_data_dir(path: &Path) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if name != ".sonar" && !name.to_ascii_lowercase().contains("sonar") {
        return Err(format!(
            "Refusing to delete {} because it does not look like a Sonar data directory.",
            path.display()
        ));
    }

    let parent = path.parent().ok_or_else(|| {
        format!(
            "Refusing to delete {} because it has no parent directory.",
            path.display()
        )
    })?;
    if parent == path {
        return Err("Refusing to delete a filesystem root.".to_string());
    }

    if let Ok(home) = std::env::var("HOME") {
        if path == Path::new(&home) {
            return Err("Refusing to delete the user's home directory.".to_string());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_missing_path, remove_state_entries, validate_deletable_sonar_data_dir};
    use std::{fs, path::Path};

    #[test]
    fn rejects_non_sonar_named_data_dirs() {
        let result = validate_deletable_sonar_data_dir(Path::new("/tmp/projects"));
        assert!(result.is_err());
    }

    #[test]
    fn accepts_default_sonar_home() {
        validate_deletable_sonar_data_dir(Path::new("/Users/example/.sonar")).unwrap();
    }

    #[test]
    fn normalizes_missing_paths_without_touching_disk() {
        let normalized = normalize_missing_path(Path::new("/tmp/sonar/../.sonar"));
        assert_eq!(normalized, Path::new("/tmp/.sonar"));
    }

    #[test]
    fn clears_state_entries_but_preserves_sidecar_assets() {
        let root =
            std::env::temp_dir().join(format!("sonar-clear-state-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::create_dir_all(root.join("models")).unwrap();
        fs::create_dir_all(root.join("repositories")).unwrap();
        fs::write(root.join("projects.db"), "db").unwrap();
        fs::write(root.join("desktop-config.json"), "{}").unwrap();
        fs::write(root.join("bin").join("sonar-api"), "binary").unwrap();
        fs::write(root.join("models").join("default.gguf"), "model").unwrap();

        remove_state_entries(&root).unwrap();

        assert!(root.join("bin").join("sonar-api").exists());
        assert!(root.join("models").join("default.gguf").exists());
        assert!(!root.join("repositories").exists());
        assert!(!root.join("projects.db").exists());
        assert!(!root.join("desktop-config.json").exists());

        fs::remove_dir_all(&root).unwrap();
    }
}
