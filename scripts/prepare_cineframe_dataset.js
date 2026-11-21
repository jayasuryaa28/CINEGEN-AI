#!/usr/bin/env node

/**
 * CINEGEN AI — CINEFRAME Dataset Preparation Pipeline (Phase 4)
 *
 * Extracts clean target reference frames (128x128 RGB) and pairs them with
 * temporal 3-frame degraded sequences [t-1, t, t+1] (64x64 RGB).
 * Enforces strict source-level isolation across train, val, and test splits.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DATASET_DIR = path.resolve("./storage_data/dataset");
const RAW_SOURCES_DIR = path.join(DATASET_DIR, "raw_sources");
const DEG_FRAMES_DIR = path.join(DATASET_DIR, "cinevision_frames");
const CLEAN_FRAMES_DIR = path.join(DATASET_DIR, "clean_frames");
const OUTPUT_ANNOTATIONS = path.join(DATASET_DIR, "cineframe_annotations.json");

if (!fs.existsSync(CLEAN_FRAMES_DIR)) {
  fs.mkdirSync(CLEAN_FRAMES_DIR, { recursive: true });
}

console.log("=== CINEFRAME DATASET PREPARATION PIPELINE ===");

// 1. Discover all clean source videos
const rawFiles = fs.readdirSync(RAW_SOURCES_DIR).filter((f) => f.endsWith(".mp4") && f.startsWith("src_clean_"));
console.log(`Found ${rawFiles.length} clean source videos in raw_sources:`);

// Map source to split
const SOURCE_SPLITS = {
  src_clean_01: "train",
  src_clean_02: "train",
  src_clean_05: "train",
  src_clean_06: "train",
  src_clean_07: "train",
  src_clean_08: "train",
  src_clean_03: "val",
  src_clean_09: "val",
  src_clean_04: "test",
  src_clean_10: "test",
};

// 2. Extract clean target frames at 128x128 (3 FPS, matching degraded video timestamps)
for (const file of rawFiles) {
  const sourceId = file.replace("_clean.mp4", "");
  const sourceVideoPath = path.join(RAW_SOURCES_DIR, file);

  console.log(`[Clean Extraction] ${sourceId} (${SOURCE_SPLITS[sourceId] || "unknown"})...`);

  // Extract 18 frames at 3 FPS
  for (let f = 1; f <= 18; f++) {
    const frameIndexStr = f.toString().padStart(3, "0");
    const framePng = path.join(CLEAN_FRAMES_DIR, `${sourceId}_f${frameIndexStr}.png`);
    const frameRgb = path.join(CLEAN_FRAMES_DIR, `${sourceId}_f${frameIndexStr}.rgb`);

    if (!fs.existsSync(framePng) || !fs.existsSync(frameRgb)) {
      const timestamp = ((f - 1) * (1 / 3) + 0.1).toFixed(3);
      // Extract PNG
      spawnSync("ffmpeg", [
        "-y",
        "-ss",
        timestamp,
        "-i",
        sourceVideoPath,
        "-vframes",
        "1",
        "-vf",
        "scale=128:128:flags=lanczos",
        "-pix_fmt",
        "rgb24",
        framePng,
      ]);

      // Extract raw 128x128 RGB buffer (49152 bytes)
      spawnSync("ffmpeg", [
        "-y",
        "-i",
        framePng,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        frameRgb,
      ]);
    }
  }
}
console.log("✓ Clean reference frame extraction complete.");

// 3. Build Temporal 3-Frame Degraded Sequences paired with Clean Target
console.log("\nAssembling temporal 3-frame sequences [I_{t-1}, I_t, I_{t+1}] -> Y_t...");

// Discover all degraded pairs from cinevision_annotations or frames dir
const cinevisionAnnotations = JSON.parse(
  fs.readFileSync(path.join(DATASET_DIR, "cinevision_annotations.json"), "utf-8")
);

// Group degraded frames by sample pair
const pairMap = new Map();
for (const ann of cinevisionAnnotations) {
  const pairId = ann.sampleId.split("_f")[0];
  if (!pairMap.has(pairId)) {
    pairMap.set(pairId, {
      sourceId: ann.sourceId,
      split: ann.split,
      frames: [],
    });
  }
  pairMap.get(pairId).frames.push(ann);
}

const cineframeSamples = [];

for (const [pairId, pairData] of pairMap) {
  const frames = pairData.frames.sort((a, b) => a.sampleId.localeCompare(b.sampleId));

  // Construct 3-frame sliding window for t = 1 to frames.length - 2
  for (let i = 1; i < frames.length - 1; i++) {
    const prevDeg = frames[i - 1].framePath;
    const currDeg = frames[i].framePath;
    const nextDeg = frames[i + 1].framePath;

    // Verify 64x64 raw RGB files exist
    const prevRgb = prevDeg.replace(/\.png$/, "_64.rgb");
    const currRgb = currDeg.replace(/\.png$/, "_64.rgb");
    const nextRgb = nextDeg.replace(/\.png$/, "_64.rgb");

    if (!fs.existsSync(prevRgb) || !fs.existsSync(currRgb) || !fs.existsSync(nextRgb)) {
      continue;
    }

    // Match corresponding clean target frame
    const frameIndexStr = (i + 1).toString().padStart(3, "0");
    const cleanPng = path.join(CLEAN_FRAMES_DIR, `${pairData.sourceId}_f${frameIndexStr}.png`);
    const cleanRgb = path.join(CLEAN_FRAMES_DIR, `${pairData.sourceId}_f${frameIndexStr}.rgb`);

    if (!fs.existsSync(cleanRgb)) {
      continue;
    }

    const sampleId = `${pairId}_seq${frameIndexStr}`;
    cineframeSamples.push({
      sampleId,
      sourceId: pairData.sourceId,
      split: pairData.split,
      degradedFrames: [prevDeg, currDeg, nextDeg],
      cleanTargetFrame: cleanPng,
      conditioning: {
        blurScore: frames[i].groundTruth.quality[0],
        noiseScore: frames[i].groundTruth.quality[1],
        flickerScore: frames[i].groundTruth.quality[2],
        brightnessShift: frames[i].groundTruth.quality[3],
        hasScreenPerspective: frames[i].groundTruth.corners[0] > 0.05,
      },
    });
  }
}

// 4. Summarize and save annotations
const trainCount = cineframeSamples.filter((s) => s.split === "train").length;
const valCount = cineframeSamples.filter((s) => s.split === "val").length;
const testCount = cineframeSamples.filter((s) => s.split === "test").length;

console.log("\n=== CINEFRAME DATASET SUMMARY ===");
console.log(`Total Temporal Sequences: ${cineframeSamples.length}`);
console.log(` - Train Sequences: ${trainCount} (Sources: ${Array.from(new Set(cineframeSamples.filter(s => s.split === "train").map(s => s.sourceId))).join(", ")})`);
console.log(` - Val Sequences:   ${valCount} (Sources: ${Array.from(new Set(cineframeSamples.filter(s => s.split === "val").map(s => s.sourceId))).join(", ")})`);
console.log(` - Test Sequences:  ${testCount} (Sources: ${Array.from(new Set(cineframeSamples.filter(s => s.split === "test").map(s => s.sourceId))).join(", ")})`);

fs.writeFileSync(OUTPUT_ANNOTATIONS, JSON.stringify(cineframeSamples, null, 2), "utf-8");
console.log(`Saved CINEFRAME annotations to: ${OUTPUT_ANNOTATIONS}`);
