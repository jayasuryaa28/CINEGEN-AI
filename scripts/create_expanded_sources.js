#!/usr/bin/env node

/**
 * CINEGEN AI — Generates Expanded Diverse Clean Source Media (Sources 6-10)
 */

const { spawn } = require("child_process");
const path = require("path");

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`FFmpeg failed (${code}): ${err}`));
      else resolve();
    });
  });
}

async function main() {
  console.log("=== GENERATING EXPANDED CLEAN SOURCES 6 TO 10 ===");

  // Source 6: High-Motion Vector Pattern (mptestsrc)
  console.log("Generating clean_source_6.mp4 (High-Motion Pattern)...");
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "mptestsrc=d=6:r=24",
    "-f", "lavfi", "-i", "sine=f=660:d=6",
    "-vf", "scale=1280:720",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "clean_source_6.mp4",
  ]);

  // Source 7: Monochrome 35mm Noir High-Contrast Film
  console.log("Generating clean_source_7.mp4 (Monochrome Noir Film)...");
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "testsrc=d=6:s=1280x720:r=24",
    "-f", "lavfi", "-i", "anoisesrc=d=6:c=pink:r=48000",
    "-vf", "format=gray,eq=contrast=1.4:brightness=-0.05",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "clean_source_7.mp4",
  ]);

  // Source 8: Deep Starfield Nebula (life cellular automaton)
  console.log("Generating clean_source_8.mp4 (Deep Starfield Nebula)...");
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "life=s=1280x720:rate=24:mold=10",
    "-f", "lavfi", "-i", "sine=f=120:d=6",
    "-t", "6",
    "-vf", "scale=1280:720",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "clean_source_8.mp4",
  ]);

  // Source 9: RGB Spectrum Gradient & Geometry (rgbtestsrc)
  console.log("Generating clean_source_9.mp4 (RGB Spectrum Calibration)...");
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "rgbtestsrc=s=1280x720:d=6:r=24",
    "-f", "lavfi", "-i", "sine=f=520:d=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "clean_source_9.mp4",
  ]);

  // Source 10: Authentic Cinema Screen Simulation (Letterboxed 2.39:1 Feature Film with Warm Stage Lighting)
  console.log("Generating clean_source_10.mp4 (Authentic Cinema Screen Feature)...");
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "testsrc2=s=1280x720:d=6:r=24",
    "-f", "lavfi", "-i", "anoisesrc=d=6:c=brown:r=48000",
    "-vf", "drawbox=y=0:h=90:color=black:t=fill,drawbox=y=630:h=90:color=black:t=fill,eq=contrast=1.2:saturation=1.3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k",
    "clean_source_10.mp4",
  ]);

  console.log("✓ All 5 expanded sources generated successfully!");
}

main().catch((err) => {
  console.error("Source generation error:", err);
  process.exit(1);
});
