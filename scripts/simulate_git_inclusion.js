const fs = require('fs');
const path = require('path');

const gitignoreContent = fs.readFileSync('.gitignore', 'utf8');
const rawPatterns = gitignoreContent.split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

console.log('Active gitignore rules:', rawPatterns.length);

function shouldIgnore(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  for (const pat of rawPatterns) {
    const cleanPat = pat.replace(/^\//, '');
    if (cleanPat.endsWith('/')) {
      const dirPat = cleanPat.slice(0, -1);
      if (norm === dirPat || norm.startsWith(dirPat + '/')) return true;
    } else if (cleanPat.startsWith('*.')) {
      const ext = cleanPat.slice(1); // e.g. .mp4, .tsbuildinfo
      if (norm.endsWith(ext)) return true;
    } else if (cleanPat.includes('*')) {
      const prefix = cleanPat.split('*')[0];
      if (norm.startsWith(prefix) || path.basename(norm).startsWith(prefix)) return true;
    } else {
      if (norm === cleanPat || norm.endsWith('/' + cleanPat)) return true;
    }
  }
  return false;
}

function walk(dir, rootDir, results = []) {
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (shouldIgnore(relPath)) continue;
    if (item.isDirectory()) {
      walk(fullPath, rootDir, results);
    } else {
      results.push(relPath);
    }
  }
  return results;
}

const included = walk('.', '.');
console.log('Total files that would be included in public repository:', included.length);

const suspicious = included.filter(f => 
  f.endsWith('.env') || 
  f.includes('credentials') || 
  (f.endsWith('.json') && f.startsWith('storage_data')) ||
  f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.mov') ||
  f.includes('dataset') || f.endsWith('.pem') || f.endsWith('.key')
);

console.log('Suspicious files included count:', suspicious.length);
if (suspicious.length > 0) {
  console.log('Suspicious items:', suspicious);
} else {
  console.log('Verified: ZERO credentials, zero datasets, zero media videos, and zero private env files included!');
}

// Summary of included categories:
const byExt = {};
included.forEach(f => {
  const ext = path.extname(f) || path.basename(f);
  byExt[ext] = (byExt[ext] || 0) + 1;
});
console.log('Included files by extension:', byExt);
