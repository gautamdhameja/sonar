import path from "path";

const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "credentials.json",
  "service-account.json",
  "service_account.json",
  "firebase-adminsdk.json",
  "google-services.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

const SENSITIVE_DIR_NAMES = new Set([".ssh", ".aws", ".azure", ".gcloud", ".gnupg"]);

const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".jks", ".keystore"]);

const SECRET_KEY_PATTERN =
  /\b(?:api[_-]?key|token|secret|password|passwd|pwd|private[_-]?key|client[_-]?secret|access[_-]?key|refresh[_-]?token|connection[_-]?string)\b/i;

const SECRET_ASSIGNMENT_PATTERN =
  /^(\s*(?:export\s+)?[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|ACCESS[_-]?KEY|REFRESH[_-]?TOKEN|CONNECTION[_-]?STRING)[A-Z0-9_]*\s*[:=]\s*)(.+)$/i;

export function isSensitiveRepositoryPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => SENSITIVE_DIR_NAMES.has(part))) return true;

  const baseName = path.posix.basename(normalized);
  if (SENSITIVE_FILE_NAMES.has(baseName)) return true;
  if (/^\.env[.-]/.test(baseName)) return true;
  if (
    /^(?:credentials|secrets?|client[-_]?secret|service[-_]?account|private[-_]?key).*\.(?:json|ya?ml|toml|ini|conf|cfg)$/i.test(
      baseName,
    )
  ) {
    return true;
  }
  if (SENSITIVE_EXTENSIONS.has(path.posix.extname(baseName))) return true;

  return false;
}

export function redactSensitiveText(filePath: string, text: string): string {
  if (!text) return text;
  let redacted = text.replace(
    /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)[\s\S]*?-----END [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/g,
    "[REDACTED SECRET BLOCK]",
  );

  redacted = redacted
    .split(/\r?\n/)
    .map((line) => {
      const assignment = line.match(SECRET_ASSIGNMENT_PATTERN);
      if (assignment) return `${assignment[1]}[REDACTED]`;
      return line;
    })
    .join("\n");

  if (isSensitiveRepositoryPath(filePath) || SECRET_KEY_PATTERN.test(path.posix.basename(filePath))) {
    return redacted.replace(/(["'`])(?:sk-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_./+=-]{32,})\1/g, "$1[REDACTED]$1");
  }

  return redacted;
}
