use std::{
    env,
    path::{Path, PathBuf},
};

pub fn repo_root() -> Result<PathBuf, String> {
    if let Ok(root) = env::var("SONAR_APP_ROOT") {
        let path = PathBuf::from(root);
        if is_sonar_root(&path) {
            return Ok(path);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in candidates {
        for ancestor in candidate.ancestors() {
            if is_sonar_root(ancestor) {
                return Ok(ancestor.to_path_buf());
            }
        }
    }

    Err(
        "Unable to locate Sonar project root. Set SONAR_APP_ROOT to the checkout directory."
            .to_string(),
    )
}

pub fn sonar_home() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("SONAR_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    if let Ok(home) = env::var("HOME") {
        return Ok(PathBuf::from(home).join(".sonar"));
    }
    Ok(repo_root()?.join(".sonar"))
}

pub fn repository_cache_dir() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("SONAR_REPOSITORY_CACHE_DIR") {
        return Ok(PathBuf::from(path));
    }

    if let Ok(home) = env::var("HOME") {
        return Ok(PathBuf::from(home).join(".sonar").join("repositories"));
    }

    Ok(repo_root()?.join(".sonar").join("repositories"))
}

fn is_sonar_root(path: &Path) -> bool {
    path.join("package.json").is_file() && path.join("docker-compose.sonar.yml").is_file()
}
