import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveRepositoryPath, redactSensitiveText } from "../src/security/source-safety";

test("isSensitiveRepositoryPath rejects common secret-bearing files", () => {
  for (const filePath of [
    ".env",
    ".env.local",
    "config/service-account.json",
    "secrets/private-key.pem",
    ".ssh/id_ed25519",
    ".aws/credentials",
    "config/client-secret.yaml",
  ]) {
    assert.equal(isSensitiveRepositoryPath(filePath), true, `${filePath} should be sensitive`);
  }
});

test("isSensitiveRepositoryPath allows ordinary source and manifest files", () => {
  for (const filePath of ["src/index.ts", "package.json", "docs/architecture.md", "config/app.json"]) {
    assert.equal(isSensitiveRepositoryPath(filePath), false, `${filePath} should be allowed`);
  }
});

test("redactSensitiveText removes common inline secrets while preserving context", () => {
  const text = [
    "API_KEY=sk-test-secret-value",
    "NORMAL_SETTING=enabled",
    "client_secret: abcdefghijklmnopqrstuvwxyz123456",
    "-----BEGIN PRIVATE KEY-----",
    "private material",
    "-----END PRIVATE KEY-----",
  ].join("\n");

  const redacted = redactSensitiveText(".env", text);

  assert.match(redacted, /API_KEY=\[REDACTED\]/);
  assert.match(redacted, /NORMAL_SETTING=enabled/);
  assert.match(redacted, /client_secret: \[REDACTED\]/);
  assert.match(redacted, /\[REDACTED SECRET BLOCK\]/);
  assert.doesNotMatch(redacted, /private material/);
});
