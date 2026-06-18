use std::{fs, path::PathBuf};

use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn export_markdown(
    app: tauri::AppHandle,
    default_file_name: String,
    contents: String,
) -> Result<bool, String> {
    let default_file_name = sanitize_markdown_file_name(&default_file_name)?;
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(default_file_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file()
    else {
        return Ok(false);
    };

    let target = target
        .into_path()
        .map_err(|_| "Choose a local Markdown file path before exporting.".to_string())?;
    write_markdown_file(target, contents)?;
    Ok(true)
}

fn sanitize_markdown_file_name(value: &str) -> Result<String, String> {
    let file_name = value.trim();
    if file_name.is_empty() {
        return Err("Choose a file name before exporting.".to_string());
    }
    let file_name = PathBuf::from(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Choose a valid Markdown file name.".to_string())?
        .to_string();
    if !file_name.ends_with(".md") {
        return Err("Briefings can only be exported as Markdown (.md) files.".to_string());
    }
    Ok(file_name)
}

fn write_markdown_file(target: PathBuf, contents: String) -> Result<(), String> {
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
