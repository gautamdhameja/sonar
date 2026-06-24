import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

if (packageJson.version !== tauriConfig.version) {
  console.error(
    `Version mismatch: package.json has ${packageJson.version}, src-tauri/tauri.conf.json has ${tauriConfig.version}.`,
  );
  process.exit(1);
}

console.log(`Version sync OK: ${packageJson.version}`);
