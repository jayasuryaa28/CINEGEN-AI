/**
 * CINEGEN AI — Phase 11 Optical Flow Video Stabilization Test
 * Tests:
 * 1. Frame extraction from RW-04-handheld-shake video
 * 2. Bypass mode verification (zero modification)
 * 3. Outlier rejection (trimmed median filter on 8x8 block grid)
 * 4. Temporal Gaussian trajectory smoothing & jitter reduction
 * 5. Adaptive boundary clamping
 * 6. Video re-assembly and metric evaluation
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { OpticalFlowStabilizer } = require("../src/ai/stabilization/opticalFlowStabilizer");

const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const VIDEO_PATH = path.resolve("./storage_data/realworld_dataset/RW-04-handheld-shake/input_capture.mp4");
const OUTPUT_DIR = path.resolve("./storage_data/realworld_eval/stabilization");

async function runOpticalFlowTest() {
  console.log("===============================================================");
  console.log("   CINEGEN AI — PHASE 11 OPTICAL FLOW STABILIZATION TEST       ");
  console.log("===============================================================\n");

  if (!fs.existsSync(VIDEO_PATH)) {
    console.error(`[ERROR] Test video not found at: ${VIDEO_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const framesDir = path.join(OUTPUT_DIR, "raw_frames");
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  // 1. Extract first 30 frames at 640x360 RGB24
  console.log("--- 1. Extracting Frames from Real-World Handheld Video ---");
  const width = 640;
  const height = 360;
  const frameCount = 30;

  const extractCmd = spawnSync(FFMPEG_PATH, [
    "-y",
    "-i", VIDEO_PATH,
    "-vf", `scale=${width}:${height}`,
    "-vframes", String(frameCount),
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    path.join(framesDir, "frames.raw"),
  ]);

  if (extractCmd.status !== 0) {
    const errMsg = extractCmd.stderr ? extractCmd.stderr.toString() : (extractCmd.error ? extractCmd.error.message : "Unknown error");
    console.error("[ERROR] FFmpeg frame extraction failed:", errMsg);
    process.exit(1);
  }

  const rawBytes = fs.readFileSync(path.join(framesDir, "frames.raw"));
  const frameSize = width * height * 3;
  const frames = [];
  for (let offset = 0; offset < rawBytes.length; offset += frameSize) {
    if (offset + frameSize <= rawBytes.length) {
      frames.push(rawBytes.subarray(offset, offset + frameSize));
    }
  }

  console.log(`[Extracted Frames]: ${frames.length} frames (${width}x${height} RGB24)`);

  // 2. Test Bypass Mode (smoothingStrength = 0.0)
  console.log("\n--- 2. Bypass Mode Test (smoothingStrength = 0.0) ---");
  const bypassStabilizer = new OpticalFlowStabilizer({ smoothingStrength: 0.0 });
  const bypassResult = bypassStabilizer.processSequence(frames, width, height);

  console.log(`[Bypass Jitter Reduction]: ${bypassResult.metrics.jitterReductionPercent}%`);
  console.log(`[Bypass Average Correction]: ${bypassResult.metrics.averageCorrectionPx} px`);
  const isBypassWorking = bypassResult.metrics.averageCorrectionPx === 0;
  console.log(`[Bypass Status]: ${isBypassWorking ? "PASSED (Clean bypass)" : "FAILED"}`);

  // 3. Test Active Mode (smoothingStrength = 0.7)
  console.log("\n--- 3. Active Stabilization Mode Test (Handheld Shake Correction) ---");
  const activeStabilizer = new OpticalFlowStabilizer({
    gridSize: 8,
    searchRadius: 6,
    smoothingStrength: 0.7,
    gaussianWindowRadius: 5,
    maxShiftRatio: 0.08,
  });

  const t0 = Date.now();
  const activeResult = activeStabilizer.processSequence(frames, width, height);
  const processDuration = Date.now() - t0;
  const msPerFrame = (processDuration / frames.length).toFixed(1);

  console.log(`[Processing Time]: Total ${processDuration} ms | ${msPerFrame} ms/frame`);
  console.log(`[Raw Trajectory Variance]:      ${activeResult.metrics.rawTrajectoryVariance}`);
  console.log(`[Smoothed Trajectory Variance]: ${activeResult.metrics.smoothedTrajectoryVariance}`);
  console.log(`[Jitter Reduction]:             ${activeResult.metrics.jitterReductionPercent}%`);
  console.log(`[Average Correction Vector]:     ${activeResult.metrics.averageCorrectionPx} px`);
  console.log(`[Max Correction Vector]:         ${activeResult.metrics.maxCorrectionPx} px`);

  // 4. Verify Boundary Clamping
  console.log("\n--- 4. Adaptive Boundary Clamping Verification ---");
  const maxAllowedShift = Math.round(Math.max(width, height) * 0.08);
  console.log(`[Max Allowed Shift (8% boundary)]: ${maxAllowedShift} px`);
  const isClamped = activeResult.metrics.maxCorrectionPx <= maxAllowedShift + 0.5;
  console.log(`[Clamping Enforced]: ${isClamped ? "PASSED (No out-of-bounds displacement)" : "FAILED"}`);

  // 5. Outlier Rejection Verification (Trimmed Median on Synthesized Outliers)
  console.log("\n--- 5. Outlier Rejection Verification ---");
  const vectorsWithOutliers = [
    { dx: 2, dy: 3 }, { dx: 2, dy: 4 }, { dx: 3, dy: 3 }, { dx: 2, dy: 3 },
    { dx: 20, dy: -30 }, // Extreme actor/occlusion motion vector
    { dx: -15, dy: 40 }, // Extreme actor/occlusion motion vector
    { dx: 3, dy: 4 }, { dx: 2, dy: 3 }
  ];
  const trimmed = activeStabilizer.calculateTrimmedMedianVector(vectorsWithOutliers);
  console.log(`[Calculated Global Motion with 25% Outliers]: dx=${trimmed.dx}, dy=${trimmed.dy}`);
  const isOutlierRejected = Math.abs(trimmed.dx) <= 4 && Math.abs(trimmed.dy) <= 5;
  console.log(`[Outlier Rejection Status]: ${isOutlierRejected ? "PASSED (Actor motion rejected)" : "FAILED"}`);

  // 6. Encode Stabilized Frames to MP4
  console.log("\n--- 6. Muxing Stabilized Video ---");
  const stabilizedRawPath = path.join(OUTPUT_DIR, "stabilized.raw");
  const stabilizedMp4Path = path.join(OUTPUT_DIR, "RW-04_stabilized.mp4");

  const combinedStabilizedBuf = Buffer.concat(activeResult.stabilizedFrames);
  fs.writeFileSync(stabilizedRawPath, combinedStabilizedBuf);

  const encodeCmd = spawnSync(FFMPEG_PATH, [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-s", `${width}x${height}`,
    "-r", "25",
    "-i", stabilizedRawPath,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    stabilizedMp4Path,
  ]);

  const outputGenerated = fs.existsSync(stabilizedMp4Path) && fs.statSync(stabilizedMp4Path).size > 1000;
  console.log(`[Stabilized Video Output]: ${stabilizedMp4Path}`);
  console.log(`[Output Verified]: ${outputGenerated ? "PASSED" : "FAILED"}`);

  const testReport = {
    test: "Optical Flow Video Stabilization",
    video: "RW-04-handheld-shake",
    framesCount: frames.length,
    resolution: `${width}x${height}`,
    latencyMsPerFrame: parseFloat(msPerFrame),
    rawVariance: activeResult.metrics.rawTrajectoryVariance,
    smoothedVariance: activeResult.metrics.smoothedTrajectoryVariance,
    jitterReductionPercent: activeResult.metrics.jitterReductionPercent,
    averageCorrectionPx: activeResult.metrics.averageCorrectionPx,
    maxCorrectionPx: activeResult.metrics.maxCorrectionPx,
    boundaryClamped: isClamped,
    outlierRejectionPassed: isOutlierRejected,
    bypassWorking: isBypassWorking,
    outputGenerated: outputGenerated,
  };

  console.log("\n===============================================================");
  console.log("            OPTICAL FLOW TEST SUMMARY                          ");
  console.log("===============================================================");
  console.log(JSON.stringify(testReport, null, 2));

  const allPassed =
    isBypassWorking &&
    isClamped &&
    isOutlierRejected &&
    outputGenerated &&
    activeResult.metrics.jitterReductionPercent > 30;

  if (!allPassed) {
    console.error("\n[FAILURE] Optical flow stabilization test failed.");
    process.exit(1);
  }

  console.log("\n[SUCCESS] Optical Flow Video Stabilization Verified Successfully.");
}

runOpticalFlowTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
