import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  process.exit(0);
}

const appleId = process.env.APPLE_ID;
const teamId = process.env.APPLE_TEAM_ID;
const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;

if (!appleId || !teamId || !password) {
  console.error("Developer ID signing requires APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD for notarization.");
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "sonar-notary-"));
const archivePath = join(tempDir, "Sonar.zip");
const notaryProfile = `sonar-notary-${process.pid}-${Date.now()}`;
let exitCode = 0;

try {
  const storeCredentials = spawnSync(
    "xcrun",
    [
      "notarytool",
      "store-credentials",
      notaryProfile,
      "--apple-id",
      appleId,
      "--team-id",
      teamId,
      "--password",
      password,
    ],
    { stdio: "inherit" },
  );
  exitCode = storeCredentials.status ?? 1;

  if (exitCode === 0) {
    const archive = spawnSync("ditto", ["-c", "-k", "--keepParent", appPath, archivePath], { stdio: "inherit" });
    exitCode = archive.status ?? 1;
  }

  if (exitCode === 0) {
    const notarize = spawnSync(
      "xcrun",
      [
        "notarytool",
        "submit",
        archivePath,
        "--keychain-profile",
        notaryProfile,
        "--wait",
      ],
      { stdio: "inherit" },
    );
    exitCode = notarize.status ?? 1;
  }

  if (exitCode === 0) {
    const staple = spawnSync("xcrun", ["stapler", "staple", appPath], { stdio: "inherit" });
    exitCode = staple.status ?? 1;
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (exitCode !== 0) process.exit(exitCode);
