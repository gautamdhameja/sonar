# Security Policy

Sonar is a local-first desktop application. It indexes repositories selected by the user and stores project data on the user's machine.

## Reporting

Please report security issues privately by opening a GitHub security advisory for this repository. Do not file public issues for vulnerabilities that expose repository contents, local files, credentials, or model API keys.

## Local Boundaries

- The Docker stack binds public service ports to `127.0.0.1`.
- Docker does not mount the user's home directory.
- Selected local repositories are copied into an internal Docker volume before indexing.
- Desktop model settings may include API keys and are stored under `~/.sonar/desktop-config.json`.

## Supported Versions

Security fixes target the current `main` branch until formal releases are published.
