use std::{
    path::Path,
    process::{Command, Stdio},
    thread,
    time::Duration,
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

pub fn prepare_managed_child(command: &mut Command) {
    command.stdin(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

pub fn command_line_for_pid(pid: &str) -> Option<String> {
    if !pid.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }
    let output = Command::new("ps")
        .args(["-p", pid, "-o", "command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn terminate_managed_process(
    pid: &str,
    process_matches: impl Fn(&str) -> bool,
    label: &str,
) -> Result<(), String> {
    if !pid.chars().all(|char| char.is_ascii_digit()) {
        return Ok(());
    }
    if !command_line_for_pid(pid).is_some_and(|command_line| process_matches(&command_line)) {
        return Ok(());
    }

    send_signal(pid, "TERM", label)?;
    if wait_until_stopped(pid, &process_matches, Duration::from_secs(5)) {
        return Ok(());
    }

    send_signal(pid, "KILL", label)?;
    if wait_until_stopped(pid, &process_matches, Duration::from_secs(2)) {
        Ok(())
    } else {
        Err(format!("Unable to stop {label} process {pid}."))
    }
}

fn wait_until_stopped(
    pid: &str,
    process_matches: &impl Fn(&str) -> bool,
    timeout: Duration,
) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if !command_line_for_pid(pid).is_some_and(|command_line| process_matches(&command_line)) {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    !command_line_for_pid(pid).is_some_and(|command_line| process_matches(&command_line))
}

fn send_signal(pid: &str, signal: &str, label: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        let process_group = format!("-{pid}");
        let group_status = Command::new("kill")
            .args([format!("-{signal}"), process_group])
            .status();
        if group_status.is_ok_and(|status| status.success()) {
            return Ok(());
        }
    }

    let status = Command::new("kill")
        .args([format!("-{signal}"), pid.to_string()])
        .status()
        .map_err(|err| format!("Unable to stop {label} process: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Unable to stop {label} process {pid}."))
    }
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
