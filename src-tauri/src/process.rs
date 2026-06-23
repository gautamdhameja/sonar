use std::{
    path::Path,
    process::{Command, Stdio},
};

pub fn command_exists(name: &str) -> bool {
    Command::new(name)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn run_git(args: &[&str], current_dir: Option<&Path>) -> Result<(), String> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(dir) = current_dir {
        command.current_dir(dir);
    }

    run_and_format_error(command, "git")
}

pub fn git_output(args: &[&str], current_dir: Option<&Path>) -> Result<String, String> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(dir) = current_dir {
        command.current_dir(dir);
    }

    let output = command
        .stdin(Stdio::null())
        .output()
        .map_err(|err| format!("Unable to run git: {err}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("git exited with {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

fn run_and_format_error(mut command: Command, name: &str) -> Result<(), String> {
    let output = command
        .stdin(Stdio::null())
        .output()
        .map_err(|err| format!("Unable to run {name}: {err}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("{name} exited with {}", output.status))
        } else {
            Err(stderr)
        }
    }
}
