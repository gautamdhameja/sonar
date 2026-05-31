use std::{fs, path::PathBuf};

#[tauri::command]
pub fn export_markdown(path: String, contents: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Choose a file path before exporting.".to_string());
    }

    let target = PathBuf::from(path);
    if target.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err("Briefings can only be exported as Markdown (.md) files.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Choose a file inside an existing folder.".to_string())?;
    if !parent.is_dir() {
        return Err("Choose a file inside an existing folder.".to_string());
    }
    fs::write(&target, contents).map_err(|err| format!("Unable to export briefing: {err}"))
}
