use std::fs;

use crate::{
    models::{ClonedRepository, PreparedRepository},
    paths::repository_cache_dir,
    process::{command_exists, git_output, run_git},
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

    let local_path = cache_dir.join(&owner).join(&repo);
    let updated_existing = if local_path.join(".git").is_dir() {
        assert_cached_remote_matches(&local_path, &clone_url)?;
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

fn assert_cached_remote_matches(
    local_path: &std::path::Path,
    expected_url: &str,
) -> Result<(), String> {
    let actual = git_output(&["remote", "get-url", "origin"], Some(local_path))?;
    if normalize_git_remote(&actual) == normalize_git_remote(expected_url) {
        return Ok(());
    }
    Err(format!(
        "{} is already cached for a different Git remote. Remove it from the Sonar repository cache before cloning this repository.",
        local_path.display()
    ))
}

fn normalize_git_remote(value: &str) -> String {
    value
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_lowercase()
}

#[tauri::command]
pub fn prepare_repository_for_indexing(
    repo_path: String,
    _project_name: String,
) -> Result<PreparedRepository, String> {
    let source = fs::canonicalize(&repo_path)
        .map_err(|err| format!("Unable to access selected repository: {err}"))?;
    if !source.is_dir() {
        return Err("Selected repository path is not a directory.".to_string());
    }

    Ok(PreparedRepository {
        local_path: source.display().to_string(),
        indexed_path: source.display().to_string(),
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
    if parts.len() != 2 {
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
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
}

#[cfg(test)]
mod tests {
    use super::{normalize_git_remote, parse_github_repository};

    #[test]
    fn parses_supported_github_repository_inputs() {
        let cases = [
            "gautamdhameja/sonar",
            "https://github.com/gautamdhameja/sonar",
            "https://github.com/gautamdhameja/sonar.git",
            "git@github.com:gautamdhameja/sonar.git",
            "github.com/gautamdhameja/sonar?tab=readme",
        ];

        for input in cases {
            let (owner, repo, clone_url) = parse_github_repository(input).expect(input);
            assert_eq!(owner, "gautamdhameja");
            assert_eq!(repo, "sonar");
            assert_eq!(clone_url, "https://github.com/gautamdhameja/sonar.git");
        }
    }

    #[test]
    fn rejects_unsafe_github_repository_inputs() {
        for input in [
            "",
            "owner",
            "../owner/repo",
            "owner/../../repo",
            "owner/repo with spaces",
            "owner/repo;rm",
        ] {
            assert!(
                parse_github_repository(input).is_err(),
                "{input} should be rejected"
            );
        }
    }

    #[test]
    fn normalizes_remote_urls_for_cache_validation() {
        assert_eq!(
            normalize_git_remote("https://github.com/gautamdhameja/sonar.git/"),
            "https://github.com/gautamdhameja/sonar"
        );
    }
}
