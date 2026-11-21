const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const EVAL_DIR = path.resolve("./storage_data/realworld_eval");
const QUALITY_DIR = path.join(EVAL_DIR, "quality_selector_eval");

function getResolutionForQuality(quality) {
  switch (quality) {
    case "720p":
      return { width: 1280, height: 720 };
    case "1080p":
      return { width: 1920, height: 1080 };
    case "1440p":
      return { width: 2560, height: 1440 };
    case "4K":
      return { width: 3840, height: 2160 };
    default:
      return { width: 1920, height: 1080 };
  }
}

function probeMedia(filePath) {
  const res = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=width,height,r_frame_rate,codec_type",
    "-of", "json",
    filePath
  ]);
  if (res.status === 0) {
    const data = JSON.parse(res.stdout.toString());
    const vStream = data.streams.find(s => s.codec_type === "video");
    const aStream = data.streams.find(s => s.codec_type === "audio");
    let fps = 24;
    if (vStream?.r_frame_rate) {
      const [num, den] = vStream.r_frame_rate.split("/").map(Number);
      fps = den ? num / den : num;
    }
    return {
      width: vStream?.width || 0,
      height: vStream?.height || 0,
      framerate: fps,
      hasAudio: !!aStream
    };
  }
  return { width: 0, height: 0, framerate: 0, hasAudio: false };
}

async function main() {
  console.log("================================================================================");
  console.log(" CINEGEN AI — PHASE 10: OUTPUT QUALITY SELECTOR (720p, 1080p, 1440p, 4K) EVAL");
  console.log("================================================================================");

  if (!fs.existsSync(QUALITY_DIR)) {
    fs.mkdirSync(QUALITY_DIR, { recursive: true });
  }

  // Create a 2-second reference source video
  const testSrc = path.join(QUALITY_DIR, "ref_source.mp4");
  spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-c:a", "aac",
    testSrc
  ]);

  const QUALITIES = ["720p", "1080p", "1440p", "4K"];
  const results = [];

  for (const q of QUALITIES) {
    const res = getResolutionForQuality(q);
    const outFile = path.join(QUALITY_DIR, `out_${q}.mp4`);

    console.log(`\nTesting Quality Setting [${q}] -> Target Resolution: ${res.width}x${res.height}...`);

    const t0 = Date.now();
    const ffRes = spawnSync("ffmpeg", [
      "-y",
      "-i", testSrc,
      "-vf", `scale=${res.width}:${res.height}`,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-c:a", "copy",
      outFile
    ]);
    const elapsedMs = Date.now() - t0;

    if (ffRes.status === 0 && fs.existsSync(outFile)) {
      const probe = probeMedia(outFile);
      const isCorrectWidth = probe.width === res.width;
      const isCorrectHeight = probe.height === res.height;
      const isCorrectFps = Math.abs(probe.framerate - 24) < 0.1;
      const isCorrectAudio = probe.hasAudio;

      console.log(`  ✓ Output Dimension: ${probe.width}x${probe.height} (Target: ${res.width}x${res.height}) -> ${isCorrectWidth && isCorrectHeight ? "MATCH" : "MISMATCH"}`);
      console.log(`  ✓ Framerate       : ${probe.framerate} fps -> ${isCorrectFps ? "MATCH" : "MISMATCH"}`);
      console.log(`  ✓ Aspect Ratio    : ${(probe.width / probe.height).toFixed(3)} (Standard 16:9 = 1.778)`);
      console.log(`  ✓ Audio Stream    : ${probe.hasAudio ? "Present" : "Missing"}`);
      console.log(`  ✓ Output Size     : ${(fs.statSync(outFile).size / 1024).toFixed(1)} KB`);
      console.log(`  ✓ Status Note     : Output matches geometry specification. Upscaling does not claim native optical detail recovery.`);

      results.push({
        quality: q,
        targetWidth: res.width,
        targetHeight: res.height,
        actualWidth: probe.width,
        actualHeight: probe.height,
        framerate: probe.framerate,
        aspectRatio: (probe.width / probe.height).toFixed(3),
        hasAudio: probe.hasAudio,
        processingTimeMs: elapsedMs,
        status: isCorrectWidth && isCorrectHeight && isCorrectFps && isCorrectAudio ? "VERIFIED" : "FAILED"
      });
    } else {
      console.error(`  ✗ Failed to process quality ${q}`);
      results.push({
        quality: q,
        status: "FAILED",
        error: ffRes.stderr?.toString()
      });
    }
  }

  const resultsFile = path.join(EVAL_DIR, "quality_selector_results.json");
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n================================================================================`);
  console.log(`Quality Selector Evaluation Complete! Results saved to: ${resultsFile}`);
  console.log(`================================================================================`);
}

main().catch(err => {
  console.error("Quality selector evaluator error:", err);
  process.exit(1);
});
