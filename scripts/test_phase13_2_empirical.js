/**
 * CINEGEN AI — Phase 13.2.1 Empirical Validation Script
 *
 * Runs real-world tests on RW-02 and RW-03:
 * 1. Runs CINEVISION on sample frames from both videos.
 * 2. Captures raw corner predictions and homography.
 * 3. Applies FFmpeg perspective correction with sense=source and cubic interpolation.
 * 4. Measures output edge angles and keystoning distortion before and after.
 * 5. Runs 1080p performance benchmark with and without perspective correction.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { TrainedCineVision } = require("../src/ai/cinevision/adapter.js");

async function main() {
  console.log("==================================================================");
  console.log("   CINEGEN AI — PHASE 13.2.1 EMPIRICAL VALIDATION & BENCHMARK      ");
  console.log("==================================================================\n");

  const testDir = path.resolve("./storage_data/test_phase13_2_empirical");
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const cinevision = new TrainedCineVision();
  await cinevision.warmup();

  const samples = [
    {
      id: "RW-02-side-angle",
      videoPath: path.resolve("./storage_data/realworld_dataset/RW-02-side-angle/input_capture.mp4"),
      expectedType: "severe_keystone",
    },
    {
      id: "RW-03-front-row",
      videoPath: path.resolve("./storage_data/realworld_dataset/RW-03-front-row/input_capture.mp4"),
      expectedType: "upward_keystone",
    },
  ];

  for (const sample of samples) {
    console.log(`\n------------------------------------------------------------------`);
    console.log(`  EVALUATING SAMPLE: ${sample.id}`);
    console.log(`------------------------------------------------------------------`);

    // 1. Extract raw 128x128 RGB frame for CINEVISION
    const rawRgbPath = path.join(testDir, `${sample.id}_sample.rgb`);
    const rawJpgPath = path.join(testDir, `${sample.id}_original.jpg`);

    // Extract JPEG for visual inspection
    spawnSync("ffmpeg", ["-y", "-ss", "1.5", "-i", sample.videoPath, "-vframes", "1", rawJpgPath]);

    // Extract raw RGB24 128x128 for model inference
    const extRes = spawnSync("ffmpeg", [
      "-y",
      "-ss", "1.5",
      "-i", sample.videoPath,
      "-vframes", "1",
      "-vf", "scale=128:128",
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      rawRgbPath,
    ]);

    if (extRes.status !== 0 || !fs.existsSync(rawRgbPath)) {
      console.error(`Failed to extract frame from ${sample.id}`);
      continue;
    }

    const rawBuffer = fs.readFileSync(rawRgbPath);
    const vision = await cinevision.analyzeFrame(rawBuffer);

    console.log(`Input Video Path: ${sample.videoPath}`);
    console.log(`Video Dimensions: 854x480`);
    console.log(`Raw CINEVISION Corners [TL, TR, BR, BL]:`);
    console.log(`  Top-Left (TL):     [${vision.corners[0][0].toFixed(4)}, ${vision.corners[0][1].toFixed(4)}]`);
    console.log(`  Top-Right (TR):    [${vision.corners[1][0].toFixed(4)}, ${vision.corners[1][1].toFixed(4)}]`);
    console.log(`  Bottom-Right (BR): [${vision.corners[2][0].toFixed(4)}, ${vision.corners[2][1].toFixed(4)}]`);
    console.log(`  Bottom-Left (BL):  [${vision.corners[3][0].toFixed(4)}, ${vision.corners[3][1].toFixed(4)}]`);
    console.log(`Quality Metrics: blur=${vision.blurScore.toFixed(3)}, noise=${vision.noiseScore.toFixed(3)}, flicker=${vision.flickerScore?.toFixed(3)}`);
    console.log(`Model displacement [dx, dy]: [${vision.displacement[0].toFixed(4)}, ${vision.displacement[1].toFixed(4)}]`);
    console.log(`Model occlusion: [${vision.occlusion[0].toFixed(4)}, ${vision.occlusion[1].toFixed(4)}]`);
    console.log(`hasScreenPerspective: ${vision.hasScreenPerspective}`);

    // Map coordinates to FFmpeg convention:
    // FFmpeg parameters: x0,y0 (TL); x1,y1 (TR); x2,y2 (BL); x3,y3 (BR)
    const W = 854;
    const H = 480;
    const tl = [vision.corners[0][0] * W, vision.corners[0][1] * H];
    const tr = [vision.corners[1][0] * W, vision.corners[1][1] * H];
    const br = [vision.corners[2][0] * W, vision.corners[2][1] * H];
    const bl = [vision.corners[3][0] * W, vision.corners[3][1] * H];

    // Measure angles before perspective correction
    // Top edge angle vs horizontal
    const angleTopBefore = Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * (180 / Math.PI);
    // Bottom edge angle vs horizontal
    const angleBottomBefore = Math.atan2(br[1] - bl[1], br[0] - bl[0]) * (180 / Math.PI);
    // Left edge angle vs vertical
    const angleLeftBefore = Math.atan2(bl[0] - tl[0], bl[1] - tl[1]) * (180 / Math.PI);
    // Right edge angle vs vertical
    const angleRightBefore = Math.atan2(br[0] - tr[0], br[1] - tr[1]) * (180 / Math.PI);

    console.log(`\nGeometric Slant Before Correction:`);
    console.log(`  Top Edge Slope:    ${angleTopBefore.toFixed(2)} deg`);
    console.log(`  Bottom Edge Slope: ${angleBottomBefore.toFixed(2)} deg`);
    console.log(`  Left Edge Slant:   ${angleLeftBefore.toFixed(2)} deg (keystone)`);
    console.log(`  Right Edge Slant:  ${angleRightBefore.toFixed(2)} deg (keystone)`);

    // Build FFmpeg perspective filter with correct mapping:
    // x0=TL, x1=TR, x2=BL (index 3), x3=BR (index 2)
    const perspectiveFilter = `perspective=x0=${tl[0].toFixed(2)}:y0=${tl[1].toFixed(2)}:x1=${tr[0].toFixed(2)}:y1=${tr[1].toFixed(2)}:x2=${bl[0].toFixed(2)}:y2=${bl[1].toFixed(2)}:x3=${br[0].toFixed(2)}:y3=${br[1].toFixed(2)}:interpolation=cubic:sense=source`;

    console.log(`\nConstructed FFmpeg Filter:`);
    console.log(`  -vf "${perspectiveFilter}"`);

    const correctedJpgPath = path.join(testDir, `${sample.id}_corrected.jpg`);
    const ffmpegRes = spawnSync("ffmpeg", [
      "-y",
      "-ss", "1.5",
      "-i", sample.videoPath,
      "-vframes", "1",
      "-vf", perspectiveFilter,
      correctedJpgPath,
    ]);

    console.log(`FFmpeg Exit Code: ${ffmpegRes.status}`);
    console.log(`Corrected Output Frame: ${correctedJpgPath} (${fs.statSync(correctedJpgPath).size} bytes)`);

    // Clean up intermediate raw RGB file
    if (fs.existsSync(rawRgbPath)) fs.unlinkSync(rawRgbPath);
  }

  // -------------------------------------------------------------------------
  // PERFORMANCE BENCHMARK (1080p With vs Without Perspective Filter)
  // -------------------------------------------------------------------------
  console.log(`\n==================================================================`);
  console.log(`   1080p ENCODING BENCHMARK: NATIVE VS WITH PERSPECTIVE FILTER    `);
  console.log(`==================================================================`);

  const benchInput = path.resolve("./clean_source_1.mp4");
  const benchOutNative = path.join(testDir, "bench_native_1080p.mp4");
  const benchOutPerspective = path.join(testDir, "bench_perspective_1080p.mp4");

  const filterNative = "scale=1920:1080:flags=lanczos,unsharp=5:5:0.5:5:5:0.0";
  const filterPerspective = "perspective=x0=0.03*W:y0=0.02*H:x1=0.97*W:y1=0.01*H:x2=0.01*W:y2=0.99*H:x3=0.99*W:y3=0.99*H:interpolation=cubic:sense=source,scale=1920:1080:flags=lanczos,unsharp=5:5:0.5:5:5:0.0";

  console.log(`Benchmarking Native Upscale to 1080p...`);
  const t0Native = process.hrtime.bigint();
  const resNative = spawnSync("ffmpeg", [
    "-y",
    "-i", benchInput,
    "-vf", filterNative,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-an",
    benchOutNative,
  ]);
  const t1Native = process.hrtime.bigint();
  const msNative = Number(t1Native - t0Native) / 1e6;

  console.log(`Benchmarking Upscale to 1080p WITH Perspective Rectification...`);
  const t0Persp = process.hrtime.bigint();
  const resPersp = spawnSync("ffmpeg", [
    "-y",
    "-i", benchInput,
    "-vf", filterPerspective,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-an",
    benchOutPerspective,
  ]);
  const t1Persp = process.hrtime.bigint();
  const msPersp = Number(t1Persp - t0Persp) / 1e6;

  const overheadMs = msPersp - msNative;
  const overheadPct = ((overheadMs / msNative) * 100).toFixed(2);

  console.log(`\nBenchmark Results:`);
  console.log(`  Native 1080p Encoding:           ${msNative.toFixed(2)} ms (Exit: ${resNative.status})`);
  console.log(`  With Perspective Filter (Cubic): ${msPersp.toFixed(2)} ms (Exit: ${resPersp.status})`);
  console.log(`  Delta Overhead:                  ${overheadMs > 0 ? "+" : ""}${overheadMs.toFixed(2)} ms (${overheadPct}%)`);

  // Clean up benchmark video files
  if (fs.existsSync(benchOutNative)) fs.unlinkSync(benchOutNative);
  if (fs.existsSync(benchOutPerspective)) fs.unlinkSync(benchOutPerspective);
}

main().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
