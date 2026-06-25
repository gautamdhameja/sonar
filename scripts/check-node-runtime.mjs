const [major, minor, patch] = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));

if (!Number.isInteger(major) || major < 22 || major >= 26) {
  console.error(
    [
      `Unsupported Node.js runtime: ${process.version}.`,
      "Sonar source builds require Node.js >=22 and <26 because native dependencies are compiled for the active Node runtime.",
      "Switch to Node 24 LTS, then reinstall dependencies:",
      "  nvm install 24",
      "  nvm use 24",
      "  npm install",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Node.js runtime OK: v${major}.${minor}.${patch}`);
