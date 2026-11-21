const fs = require("fs");
const path = require("path");

const appDir = path.resolve("./src/app");
const nextDir = path.resolve("./.next");

function walkSync(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      fileList.push(filePath);
      walkSync(filePath, fileList);
    }
  }
  return fileList;
}

const subdirs = walkSync(appDir);
for (const d of subdirs) {
  const rel = path.relative(appDir, d);
  const targetServer = path.join(nextDir, "server", "app", rel);
  const targetTypes = path.join(nextDir, "types", "app", rel);
  const targetChunks = path.join(nextDir, "static", "chunks", "app", rel);

  [targetServer, targetTypes, targetChunks].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}
    }
  });
}
