fn main() {
    println!("cargo:rerun-if-env-changed=npm_node_execpath");
    println!("cargo:rerun-if-env-changed=npm_execpath");
    if let Ok(node) = std::env::var("npm_node_execpath") {
        println!("cargo:rustc-env=SONAR_BUILD_NODE_EXEC_PATH={node}");
    }
    if let Ok(npm) = std::env::var("npm_execpath") {
        println!("cargo:rustc-env=SONAR_BUILD_NPM_EXEC_PATH={npm}");
    }
    tauri_build::build();
}
