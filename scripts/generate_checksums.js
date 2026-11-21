/**
 * CINEGEN AI — Checkpoint Hash & Manifest Generator
 * Generates SHA-256 checksums and verification manifest for all model checkpoints.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CHECKPOINTS_DIR = path.resolve("./storage_data/checkpoints");
const OUTPUT_FILE = path.join(CHECKPOINTS_DIR, "checksums.sha256");
const MANIFEST_FILE = path.join(CHECKPOINTS_DIR, "CHECKPOINT_MANIFEST.json");

function computeSha256(filePath) {
  const fileBuf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuf).digest("hex");
}

function scanDir(dir, base = dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(scanDir(fullPath, base));
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".json") || entry.name.endsWith(".bin")) {
        const relPath = path.relative(base, fullPath).replace(/\\/g, "/");
        files.push({ fullPath, relPath, size: entry.size || fs.statSync(fullPath).size });
      }
    }
  }
  return files;
}

const files = scanDir(CHECKPOINTS_DIR);
const manifest = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  checkpoints: [],
};

const checksumLines = [];

for (const file of files) {
  const hash = computeSha256(file.fullPath);
  checksumLines.push(`${hash}  ${file.relPath}`);
  manifest.checkpoints.push({
    file: file.relPath,
    bytes: file.size,
    sha256: hash,
  });
}

fs.writeFileSync(OUTPUT_FILE, checksumLines.join("\n") + "\n", "utf-8");
fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf-8");

console.log(`[Manifest Generated]: ${MANIFEST_FILE} (${manifest.checkpoints.length} files)`);
console.log(`[Checksums Generated]: ${OUTPUT_FILE}`);
