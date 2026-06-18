import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const appPath = process.env.SONAR_MAC_APP_PATH ?? "src-tauri/target/release/bundle/macos/Sonar.app";

if (process.platform !== "darwin") {
  console.log("macOS verification skipped: this command only runs on macOS.");
  process.exit(0);
}

if (!existsSync(appPath)) {
  console.error(`macOS app bundle not found: ${appPath}`);
  process.exit(1);
}

const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
  stdio: "inherit",
});
if (verify.status !== 0) process.exit(verify.status ?? 1);

const details = spawnSync("codesign", ["-dv", "--verbose=2", appPath], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const output = `${details.stdout ?? ""}${details.stderr ?? ""}`;
if (output.includes("Signature=adhoc")) {
  console.warn("Verification passed with an ad-hoc signature. Use a Developer ID Application identity before public release.");
}
