import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const appPath = process.env.SONAR_MAC_APP_PATH ?? "src-tauri/target/release/bundle/macos/Sonar.app";
const identity = process.env.SONAR_MAC_SIGN_IDENTITY ?? "-";

if (process.platform !== "darwin") {
  console.log("macOS signing skipped: this command only runs on macOS.");
  process.exit(0);
}

if (!existsSync(appPath)) {
  console.error(`macOS app bundle not found: ${appPath}`);
  process.exit(1);
}

const args = ["--force", "--deep"];
if (identity !== "-") args.push("--options", "runtime", "--timestamp");
args.push("--sign", identity, appPath);

const result = spawnSync("codesign", args, { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

if (identity === "-") {
  console.warn("Signed with an ad-hoc identity. This verifies locally but is not suitable for public Gatekeeper distribution.");
}
