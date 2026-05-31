use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::Path,
};

use crate::{
    models::{ClonedRepository, PreparedRepository},
    paths::repository_cache_dir,
    process::{command_exists, docker_api_container_running, run_docker, run_git},
};

#[tauri::command]
pub fn clone_github_repository(repository: String) -> Result<ClonedRepository, String> {
    if !command_exists("git") {
        return Err("Git is not installed or not available on PATH.".to_string());
    }

    let (owner, repo, clone_url) = parse_github_repository(&repository)?;
    let cache_dir = repository_cache_dir()?;
    fs::create_dir_all(&cache_dir)
        .map_err(|err| format!("Unable to create repository cache directory: {err}"))?;

    let local_path = cache_dir.join(format!("{owner}-{repo}"));
    let updated_existing = if local_path.join(".git").is_dir() {
        run_git(&["pull", "--ff-only"], Some(&local_path))?;
        true
    } else {
        if local_path.exists() {
            return Err(format!(
                "{} already exists but is not a Git repository.",
                local_path.display()
            ));
        }
        run_git(
            &[
                "clone",
                "--depth",
                "1",
                clone_url.as_str(),
                local_path
                    .to_str()
                    .ok_or_else(|| "Repository path is not valid UTF-8.".to_string())?,
            ],
            None,
        )?;
        false
    };

    Ok(ClonedRepository {
        owner,
        repo,
        clone_url,
        local_path: local_path.display().to_string(),
        updated_existing,
    })
}

#[tauri::command]
pub fn prepare_repository_for_indexing(
    repo_path: String,
    project_name: String,
) -> Result<PreparedRepository, String> {
    let source = fs::canonicalize(&repo_path)
        .map_err(|err| format!("Unable to access selected repository: {err}"))?;
    if !source.is_dir() {
        return Err("Selected repository path is not a directory.".to_string());
    }

    if !docker_api_container_running() {
        return Ok(PreparedRepository {
            local_path: source.display().to_string(),
            indexed_path: source.display().to_string(),
            copied_to_docker: false,
        });
    }

    let repo_name = safe_repository_volume_name(&source, &project_name);
    let target = format!("/workspace/repos/{repo_name}");
    run_docker(&[
        "exec".to_string(),
        "sonar-api-1".to_string(),
        "rm".to_string(),
        "-rf".to_string(),
        target.clone(),
    ])?;
    run_docker(&[
        "exec".to_string(),
        "sonar-api-1".to_string(),
        "mkdir".to_string(),
        "-p".to_string(),
        target.clone(),
    ])?;

    let source_contents = source.join(".");
    run_docker(&[
        "cp".to_string(),
        source_contents.display().to_string(),
        format!("sonar-api-1:{target}"),
    ])?;

    Ok(PreparedRepository {
        local_path: source.display().to_string(),
        indexed_path: target,
        copied_to_docker: true,
    })
}

fn parse_github_repository(input: &str) -> Result<(String, String, String), String> {
    let mut value = input.trim().trim_end_matches('/').to_string();
    if value.is_empty() {
        return Err("Enter a GitHub repository URL or owner/repo path.".to_string());
    }

    if let Some(stripped) = value.strip_prefix("git@github.com:") {
        value = stripped.to_string();
    } else if let Some(stripped) = value.strip_prefix("https://github.com/") {
        value = stripped.to_string();
    } else if let Some(stripped) = value.strip_prefix("http://github.com/") {
        value = stripped.to_string();
    } else if let Some(stripped) = value.strip_prefix("github.com/") {
        value = stripped.to_string();
    }

    value = value
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_string();

    let parts: Vec<&str> = value.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Err("Use a GitHub repository such as https://github.com/owner/repo.".to_string());
    }

    let owner = parts[0].to_string();
    let repo = parts[1].to_string();
    if !is_safe_repo_part(&owner) || !is_safe_repo_part(&repo) {
        return Err(
            "Repository owner and name can only contain letters, numbers, '.', '_', and '-'."
                .to_string(),
        );
    }

    let clone_url = format!("https://github.com/{owner}/{repo}.git");
    Ok((owner, repo, clone_url))
}

fn is_safe_repo_part(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
}

fn safe_repository_volume_name(repo_path: &Path, project_name: &str) -> String {
    let raw = if project_name.trim().is_empty() {
        repo_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("repository")
            .to_string()
    } else {
        project_name.trim().to_string()
    };

    let sanitized: String = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    let base = if trimmed.is_empty() {
        "repository".to_string()
    } else {
        trimmed.chars().take(64).collect()
    };
    let mut hasher = DefaultHasher::new();
    repo_path.display().to_string().hash(&mut hasher);
    format!("{base}-{:08x}", hasher.finish() as u32)
}
