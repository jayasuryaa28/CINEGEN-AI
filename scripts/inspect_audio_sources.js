const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rawDir = path.resolve("./storage_data/dataset/raw_sources");
const files = fs.readdirSync(rawDir).filter(f => f.endsWith(".mp4"));
console.log(`Found ${files.length} MP4 files in ${rawDir}:`);
for (const f of files) {
  const p = path.join(rawDir, f);
  const res = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,sample_rate,channels,duration",
    "-of", "json",
    p
  ]);
  try {
    const data = JSON.parse(res.stdout.toString());
    const a = data.streams.find(s => s.codec_type === "audio");
    console.log(f.padEnd(25), a ? `Audio: ${a.codec_name}, ${a.sample_rate}Hz, channels: ${a.channels}, dur: ${a.duration}s` : "NO AUDIO");
  } catch (e) {
    console.log(f.padEnd(25), "Error reading stream");
  }
}
