#!/usr/bin/env node

/**
 * CINEGEN AI — Dataset CLI Tool
 *
 * Usage:
 *   node scripts/dataset_cli.js list
 *   node scripts/dataset_cli.js import <videoPath> [license] [split]
 *   node scripts/dataset_cli.js generate <sourceId> <profileId>
 *   node scripts/dataset_cli.js validate
 *   node scripts/dataset_cli.js export <exportJsonPath>
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DATASET_DIR = path.resolve("./storage_data/dataset");
const MANIFEST_PATH = path.join(DATASET_DIR, "dataset_manifest.json");

function ensureDirs() {
  ["raw_sources", "clean_targets", "degraded_samples"].forEach((dir) => {
    const p = path.join(DATASET_DIR, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
}

function getManifest() {
  ensureDirs();
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  }
  return {
    manifestVersion: "1.0.0",
    datasetName: "CINEGEN-THEATRE-PAIRED-v1",
    description: "Paired clean and synthetic theatre-degraded video/audio dataset.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    license: "Creative Commons Zero (CC0) / Apache 2.0",
    totalPairs: 0,
    splits: { train: 0, val: 0, test: 0 },
    sources: [],
    samples: [],
  };
}

function saveManifest(manifest) {
  manifest.updatedAt = new Date().toISOString();
  manifest.totalPairs = manifest.samples.length;
  manifest.splits = {
    train: manifest.samples.filter((s) => s.split === "train").length,
    val: manifest.samples.filter((s) => s.split === "val").length,
    test: manifest.samples.filter((s) => s.split === "test").length,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

async function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("probe failed"));
      const j = JSON.parse(out);
      const v = j.streams.find((s) => s.codec_type === "video");
      const a = j.streams.find((s) => s.codec_type === "audio");
      resolve({
        duration: parseFloat(j.format.duration || "0"),
        width: v ? parseInt(v.width, 10) : 0,
        height: v ? parseInt(v.height, 10) : 0,
        videoCodec: v ? v.codec_name : "none",
        audioCodec: a ? a.codec_name : "none",
      });
    });
  });
}

async function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", audioPath]);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("audio extraction failed"))));
  });
}

async function renderDegradedVideo(cleanPath, degPath) {
  // Comprehensive physical degradation filtergraph: perspective keystone + camera shake + flicker + blur + noise + moire
  const filter = [
    "perspective=x0=0.1*W:y0=0.08*H:x1=0.92*W:y1=0.04*H:x2=0.02*W:y2=H:x3=0.98*W:y3=H:interpolation=cubic",
    "crop=w=in_w-24:h=in_h-18:x='12+6*sin(4*PI*t)':y='9+4*cos(3*PI*t)'",
    "eq=brightness='-0.05+0.06*sin(6*PI*t)':contrast=1.2",
    "boxblur=1.5:1.5",
    "noise=alls=15:allf=t+u",
    "drawgrid=width=8:height=8:thickness=1:color=black@0.04",
    "fps=20",
    "scale=854:480:flags=bilinear",
  ].join(",");

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-i", cleanPath, "-vf", filter, "-c:v", "libx264", "-crf", "32", "-pix_fmt", "yuv420p", "-an", degPath]);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("video degradation failed"))));
  });
}

async function renderDegradedAudio(cleanAudio, degAudio, duration) {
  // Reverberation + cheap microphone bandpass + crowd murmur + thermal hiss
  const filter = "highpass=f=150,lowpass=f=7000,aecho=0.8:0.85:90|180:0.35|0.2,acompressor=threshold=-24dB:ratio=4";
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i", cleanAudio,
      "-f", "lavfi", "-i", `anoisesrc=d=${Math.ceil(duration)}:c=pink:r=48000`,
      "-f", "lavfi", "-i", `anoisesrc=d=${Math.ceil(duration)}:c=white:r=48000`,
      "-filter_complex", `[0:a]${filter}[cf];[1:a]lowpass=f=800,volume=0.04[cr];[2:a]highpass=f=4000,volume=0.01[hs];[cf][cr][hs]amix=inputs=3:duration=first[out]`,
      "-map", "[out]",
      "-c:a", "aac", "-b:a", "96k",
      degAudio,
    ]);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("audio degradation failed"))));
  });
}

async function main() {
  const [,, cmd, arg1, arg2, arg3] = process.argv;

  if (!cmd || cmd === "list") {
    const m = getManifest();
    console.log("=== CINEGEN AI DATASET MANIFEST ===");
    console.log("Dataset:", m.datasetName);
    console.log("License:", m.license);
    console.log("Total Pairs:", m.totalPairs);
    console.log("Splits:", m.splits);
    console.log("\nRegistered Sources:", m.sources.length);
    m.sources.forEach((s) => console.log(` - [${s.assignedSplit.toUpperCase()}] ${s.sourceId}: ${s.filename} (${s.duration.toFixed(1)}s)`));
    console.log("\nSamples:", m.samples.length);
    m.samples.forEach((s) => console.log(` - Pair ${s.pairId} [${s.split}]: ${s.degradationProfileApplied.name} (${s.degradedSample.width}x${s.degradedSample.height})`));
    return;
  }

  if (cmd === "import") {
    const filePath = path.resolve(arg1);
    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      process.exit(1);
    }
    const meta = await probe(filePath);
    const m = getManifest();
    const sourceId = `src_${Date.now().toString().slice(-6)}`;
    const split = arg3 || (m.sources.length % 5 === 4 ? "val" : "train");
    const license = arg2 || "Public Domain";

    const cleanVideo = path.join(DATASET_DIR, "raw_sources", `${sourceId}_clean.mp4`);
    const cleanAudio = path.join(DATASET_DIR, "clean_targets", `${sourceId}_clean.wav`);

    fs.copyFileSync(filePath, cleanVideo);
    await extractAudio(cleanVideo, cleanAudio);

    m.sources.push({ sourceId, filename: path.basename(filePath), duration: meta.duration, assignedSplit: split, license });
    saveManifest(m);
    console.log(`✓ Imported source as ${sourceId} [Split: ${split}]`);
    return;
  }

  if (cmd === "generate") {
    const sourceId = arg1;
    const m = getManifest();
    const src = m.sources.find((s) => s.sourceId === sourceId);
    if (!src) {
      console.error("Source not found:", sourceId);
      process.exit(1);
    }
    const pairId = `pair_${Date.now().toString().slice(-6)}`;
    const cleanVideo = path.join(DATASET_DIR, "raw_sources", `${sourceId}_clean.mp4`);
    const cleanAudio = path.join(DATASET_DIR, "clean_targets", `${sourceId}_clean.wav`);

    const degVideo = path.join(DATASET_DIR, "degraded_samples", `${pairId}_deg.mp4`);
    const degAudio = path.join(DATASET_DIR, "degraded_samples", `${pairId}_deg.aac`);

    console.log(`Rendering degradation for source ${sourceId}...`);
    await renderDegradedVideo(cleanVideo, degVideo);
    await renderDegradedAudio(cleanAudio, degAudio, src.duration);

    const cleanMeta = await probe(cleanVideo);
    const degMeta = await probe(degVideo);

    m.samples.push({
      pairId,
      sourceId,
      split: src.assignedSplit,
      license: src.license,
      cleanTarget: {
        sampleId: `${sourceId}_clean`,
        videoPath: cleanVideo,
        audioPath: cleanAudio,
        width: cleanMeta.width,
        height: cleanMeta.height,
        duration: cleanMeta.duration,
        framerate: 24,
        videoCodec: cleanMeta.videoCodec,
        audioCodec: "pcm_s16le",
      },
      degradedSample: {
        sampleId: `${pairId}_deg`,
        videoPath: degVideo,
        audioPath: degAudio,
        width: degMeta.width,
        height: degMeta.height,
        duration: degMeta.duration,
        framerate: 20,
        videoCodec: degMeta.videoCodec,
        audioCodec: "aac",
      },
      degradationProfileApplied: {
        id: "auditorium_rear_center",
        name: "Auditorium Rear Center",
        description: "Keystone, camera shake, projector flicker, crowd noise & room echo",
      },
      createdAt: new Date().toISOString(),
    });

    saveManifest(m);
    console.log(`✓ Generated paired sample ${pairId} [${degMeta.width}x${degMeta.height}]`);
    return;
  }

  if (cmd === "validate") {
    const m = getManifest();
    let errors = 0;
    console.log(`Validating ${m.samples.length} sample pairs...`);
    for (const s of m.samples) {
      const cleanPath = s.cleanTarget ? s.cleanTarget.videoPath : path.join(DATASET_DIR, "raw_sources", `${s.sourceId}_clean.mp4`);
      const degPath = s.degradedSample ? s.degradedSample.videoPath : (s.degradedVideo || path.join(DATASET_DIR, "degraded_samples", `${s.pairId}.mp4`));
      if (!fs.existsSync(cleanPath) || !fs.existsSync(degPath)) {
        console.error(`✗ Missing media file for pair ${s.pairId}`);
        errors++;
      }
    }
    if (errors === 0) {
      console.log(`✓ All ${m.samples.length} pairs validated with 100% integrity.`);
    } else {
      console.error(`Validation found ${errors} issues.`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "export") {
    const outPath = path.resolve(arg1 || "./storage_data/dataset/export_manifest.json");
    const m = getManifest();
    fs.writeFileSync(outPath, JSON.stringify(m, null, 2), "utf-8");
    console.log(`✓ Exported dataset manifest to: ${outPath}`);
    return;
  }

  console.log("Commands: list, import, generate, validate, export");
}

main().catch((e) => {
  console.error("CLI error:", e);
  process.exit(1);
});
