const fs = require('fs');
const path = require('path');

console.log('=== PHASE 14.3 PRIVACY REDACTION OF ALL MARKDOWN REPORTS ===\n');

const rootFiles = fs.readdirSync('.').filter(f => f.endsWith('.md'));
let totalRedactions = 0;
let filesModified = 0;

for (const f of rootFiles) {
  let content = fs.readFileSync(f, 'utf8');

  // Check if file has machine paths
  if (content.includes('Users/acer') || content.includes('Users\\acer')) {
    const prefix1 = /C:\\Users\\acer\\\.gemini\\antigravity\\scratch\\cinegen-ai\\?/gi;
    const prefix2 = /C:\/Users\/acer\/\.gemini\/antigravity\/scratch\/cinegen-ai\/?/gi;
    const prefix3 = /C:\\Users\\acer\\[^\s"'`\)\]]*/gi;
    const prefix4 = /C:\/Users\/acer\/[^\s"'`\)\]]*/gi;

    const count1 = (content.match(prefix1) || []).length;
    const count2 = (content.match(prefix2) || []).length;
    const count3 = (content.match(prefix3) || []).length;
    const count4 = (content.match(prefix4) || []).length;

    content = content.replace(prefix1, '');
    content = content.replace(prefix2, '');
    content = content.replace(prefix3, '<workspace-root>');
    content = content.replace(prefix4, '<workspace-root>');

    const fileCount = count1 + count2 + count3 + count4;
    totalRedactions += fileCount;
    filesModified++;

    fs.writeFileSync(f, content, 'utf8');
    console.log(`[REDACTED] ${f}: ${fileCount} machine path references redacted.`);
  }
}

console.log(`\nRedaction complete: ${totalRedactions} references redacted across ${filesModified} markdown files.`);
