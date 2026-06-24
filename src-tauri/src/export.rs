use std::{fs, path::PathBuf};

#[tauri::command]
pub fn export_markdown(path: String, contents: String) -> Result<(), String> {
    let target = validate_export_path(path)?;
    write_markdown_file(target, contents)?;
    Ok(())
}

fn validate_export_path(value: String) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Choose a local Markdown file path before exporting.".to_string())?;
    if !file_name.ends_with(".md") {
        return Err("Briefings can only be exported as Markdown (.md) files.".to_string());
    }
    Ok(path)
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

#[cfg(test)]
mod tests {
    use super::validate_export_path;

    #[test]
    fn export_path_requires_markdown_extension() {
        assert!(validate_export_path("/tmp/briefing.md".to_string()).is_ok());
        assert!(validate_export_path("/tmp/briefing.txt".to_string()).is_err());
    }

    #[test]
    fn export_path_requires_file_name() {
        assert!(validate_export_path("/tmp/".to_string()).is_err());
    }
}
