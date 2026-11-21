const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DATASET_DIR = path.resolve("./storage_data/realworld_dataset");
const EVAL_DIR = path.resolve("./storage_data/realworld_eval");
const VISUAL_DIR = path.join(EVAL_DIR, "visual_comparisons");

// Math helpers for reference-free metrics on RGB buffer
function computeReferenceFreeMetrics(rgbBuffer, width, height) {
  const numPixels = width * height;
  const grayscale = new Float32Array(numPixels);

  // 1. Convert RGB to grayscale (standard BT.709 luminance)
  for (let i = 0; i < numPixels; i++) {
    const r = rgbBuffer[i * 3];
    const g = rgbBuffer[i * 3 + 1];
    const b = rgbBuffer[i * 3 + 2];
    grayscale[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // 2. Laplacian Variance (Sharpness & high-frequency detail)
  let lapSum = 0;
  let lapSumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = grayscale[idx];
      const lap =
        grayscale[idx - 1] +
        grayscale[idx + 1] +
        grayscale[idx - width] +
        grayscale[idx + width] -
        4 * center;
      lapSum += lap;
      lapSumSq += lap * lap;
      count++;
    }
  }
  const meanLap = lapSum / count;
  const lapVariance = (lapSumSq / count) - (meanLap * meanLap);

  // 3. Sobel Edge Gradient Magnitude
  let sobelSum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -grayscale[idx - width - 1] + grayscale[idx - width + 1]
        - 2 * grayscale[idx - 1] + 2 * grayscale[idx + 1]
        - grayscale[idx + width - 1] + grayscale[idx + width + 1];
      const gy =
        -grayscale[idx - width - 1] - 2 * grayscale[idx - width] - grayscale[idx - width + 1]
        + grayscale[idx + width - 1] + 2 * grayscale[idx + width] + grayscale[idx + width + 1];
      sobelSum += Math.sqrt(gx * gx + gy * gy);
    }
  }
  const meanSobel = sobelSum / count;

  // 4. Immerkaer Fast Noise Variance Estimation
  let noiseSum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const noise =
        grayscale[idx - width - 1] - 2 * grayscale[idx - width] + grayscale[idx - width + 1]
        - 2 * grayscale[idx - 1] + 4 * grayscale[idx] - 2 * grayscale[idx + 1]
        + grayscale[idx + width - 1] - 2 * grayscale[idx + width] + grayscale[idx + width + 1];
      noiseSum += Math.abs(noise);
    }
  }
  const noiseSigma = (Math.sqrt(Math.PI / 2) / (6 * count)) * noiseSum;

  return {
    laplacianVariance: Math.max(0, lapVariance),
    sobelEdgeEnergy: meanSobel,
    noiseEstimate: noiseSigma
  };
}

// Compute Temporal Inter-frame Difference Variance
function computeTemporalVariance(frame1Rgb, frame2Rgb, width, height) {
  const numPixels = width * height;
  let diffSum = 0;
  let diffSumSq = 0;
  for (let i = 0; i < numPixels; i++) {
    const lum1 = 0.2126 * frame1Rgb[i * 3] + 0.7152 * frame1Rgb[i * 3 + 1] + 0.0722 * frame1Rgb[i * 3 + 2];
    const lum2 = 0.2126 * frame2Rgb[i * 3] + 0.7152 * frame2Rgb[i * 3 + 1] + 0.0722 * frame2Rgb[i * 3 + 2];
    const diff = lum2 - lum1;
    diffSum += diff;
    diffSumSq += diff * diff;
  }
  const meanDiff = diffSum / numPixels;
  return (diffSumSq / numPixels) - (meanDiff * meanDiff);
}

// Extract RGB raw frames using FFmpeg
function extractRawFrames(videoPath, frameCount = 2, width = 640, height = 360) {
  const tempFile = path.join(EVAL_DIR, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.rgb`);
  const res = spawnSync("ffmpeg", [
    "-y",
    "-ss", "1.0",
    "-i", videoPath,
    "-vframes", String(frameCount),
    "-vf", `scale=${width}:${height}`,
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    tempFile
  ]);

  if (res.status === 0 && fs.existsSync(tempFile)) {
    const buffer = fs.readFileSync(tempFile);
    fs.unlinkSync(tempFile);
    const frameSize = width * height * 3;
    const frames = [];
    for (let f = 0; f < frameCount; f++) {
      frames.push(buffer.subarray(f * frameSize, (f + 1) * frameSize));
    }
    return frames;
  }
  return null;
}

async function main() {
  console.log("================================================================================");
  console.log(" CINEGEN AI — PHASE 10: VIDEO RESTORATION & 5-WAY COMPARISON EVALUATOR");
  console.log("================================================================================");

  if (!fs.existsSync(VISUAL_DIR)) {
    fs.mkdirSync(VISUAL_DIR, { recursive: true });
  }

  const manifestPath = path.join(DATASET_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("Manifest not found. Run scripts/build_realworld_dataset.js first.");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const results = [];

  // Load CINEVISION and CINEFRAME adapters
  const { CineVisionAdapter } = require("../src/ai/cinevision/adapter");
  const { CineFrameAdapter } = require("../src/ai/cineframe/adapter");
  const visionAdapter = new CineVisionAdapter();
  const frameAdapter = new CineFrameAdapter();

  console.log("\nInitializing CINEVISION and CINEFRAME neural models...");
  await visionAdapter.initialize();
  await frameAdapter.initialize();
  console.log("Models initialized successfully from checkpoints.\n");

  for (const profile of manifest.profiles) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Evaluating Profile: [${profile.id}] - ${profile.name}`);
    console.log(`Video Source: ${profile.videoPath}`);

    const profileVisualDir = path.join(VISUAL_DIR, profile.id);
    if (!fs.existsSync(profileVisualDir)) {
      fs.mkdirSync(profileVisualDir, { recursive: true });
    }

    // Branch 1: Input Original Frames
    const inputFrames = extractRawFrames(profile.videoPath, 2, 640, 360);
    if (!inputFrames || inputFrames.length < 2) {
      console.error(`Could not extract raw frames for ${profile.id}`);
      continue;
    }

    const inputMetrics = computeReferenceFreeMetrics(inputFrames[0], 640, 360);
    const inputTemporalVar = computeTemporalVariance(inputFrames[0], inputFrames[1], 640, 360);

    // Save sample frame PNG
    const inputFramePng = path.join(profileVisualDir, "1_original_input.png");
    spawnSync("ffmpeg", ["-y", "-ss", "1.0", "-i", profile.videoPath, "-vframes", "1", inputFramePng]);

    // Branch 2: FFmpeg-only standard processing (Bicubic + Unsharp)
    const ffmpegOutVideo = path.join(profileVisualDir, "2_ffmpeg_baseline.mp4");
    spawnSync("ffmpeg", [
      "-y",
      "-i", profile.videoPath,
      "-t", "2.0",
      "-vf", "scale=1280:720:flags=bicubic,unsharp=5:5:0.8:5:5:0.0",
      "-c:v", "libx264",
      "-preset", "veryfast",
      ffmpegOutVideo
    ]);
    const ffmpegFrames = extractRawFrames(ffmpegOutVideo, 2, 640, 360);
    const ffmpegMetrics = ffmpegFrames ? computeReferenceFreeMetrics(ffmpegFrames[0], 640, 360) : inputMetrics;
    const ffmpegTemporalVar = ffmpegFrames ? computeTemporalVariance(ffmpegFrames[0], ffmpegFrames[1], 640, 360) : inputTemporalVar;

    // Branch 3: CINEVISION Analysis & Screen Geometry
    const cvSample128 = path.join(profileVisualDir, "cv_sample128.rgb");
    spawnSync("ffmpeg", [
      "-y",
      "-ss", "1.0",
      "-i", profile.videoPath,
      "-vframes", "1",
      "-vf", "scale=128:128",
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      cvSample128
    ]);
    let visionAnalysis = { hasScreenPerspective: false, blurScore: 0.5, noiseScore: 0.5 };
    if (fs.existsSync(cvSample128)) {
      const raw128 = fs.readFileSync(cvSample128);
      visionAnalysis = await visionAdapter.analyzeFrame(raw128);
      fs.unlinkSync(cvSample128);
    }

    // Branch 4: CINEFRAME Neural 2x Super-Resolution
    // We upscale the 640x360 frame to 1280x720 using CINEFRAME
    const cineframeOutPng = path.join(profileVisualDir, "4_cineframe_restored.png");
    // Run CINEFRAME frame-by-frame on the extracted frame
    const restoredRgbBuffer = await frameAdapter.enhanceFrame(inputFrames[0], 640, 360);
    const cfMetrics = computeReferenceFreeMetrics(restoredRgbBuffer, 1280, 720);

    // Save restored frame to PNG via ffmpeg pipe
    const rawRestoredFile = path.join(profileVisualDir, "temp_restored.rgb");
    fs.writeFileSync(rawRestoredFile, restoredRgbBuffer);
    spawnSync("ffmpeg", [
      "-y",
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "-s", "1280x720",
      "-i", rawRestoredFile,
      cineframeOutPng
    ]);
    if (fs.existsSync(rawRestoredFile)) fs.unlinkSync(rawRestoredFile);

    // Branch 5: Side-by-Side Comparison Generator
    const sideBySidePng = path.join(profileVisualDir, "5_side_by_side_comparison.png");
    spawnSync("ffmpeg", [
      "-y",
      "-i", inputFramePng,
      "-i", cineframeOutPng,
      "-filter_complex", "[0:v]scale=640:360[left];[1:v]scale=640:360[right];[left][right]hstack=inputs=2[out]",
      "-map", "[out]",
      sideBySidePng
    ]);

    console.log(`  Metrics Summary:`);
    console.log(`  - Original Input Sharpness (Laplacian Var): ${inputMetrics.laplacianVariance.toFixed(1)} | Noise: ${inputMetrics.noiseEstimate.toFixed(2)} | Flicker: ${inputTemporalVar.toFixed(2)}`);
    console.log(`  - FFmpeg Baseline Sharpness               : ${ffmpegMetrics.laplacianVariance.toFixed(1)} | Noise: ${ffmpegMetrics.noiseEstimate.toFixed(2)} | Flicker: ${ffmpegTemporalVar.toFixed(2)}`);
    console.log(`  - CINEVISION Detection                    : Perspective=${visionAnalysis.hasScreenPerspective} | BlurScore=${visionAnalysis.blurScore.toFixed(3)} | NoiseScore=${visionAnalysis.noiseScore.toFixed(3)}`);
    console.log(`  - CINEFRAME Restored Sharpness            : ${cfMetrics.laplacianVariance.toFixed(1)} | Edge Energy: ${cfMetrics.sobelEdgeEnergy.toFixed(2)}`);
    console.log(`  - Visual Comparison Saved                 : ${sideBySidePng}`);

    results.push({
      profileId: profile.id,
      name: profile.name,
      inputMetrics: {
        sharpness: inputMetrics.laplacianVariance,
        noise: inputMetrics.noiseEstimate,
        flicker: inputTemporalVar
      },
      ffmpegMetrics: {
        sharpness: ffmpegMetrics.laplacianVariance,
        noise: ffmpegMetrics.noiseEstimate,
        flicker: ffmpegTemporalVar
      },
      cinevision: visionAnalysis,
      cineframe: {
        sharpness: cfMetrics.laplacianVariance,
        edgeEnergy: cfMetrics.sobelEdgeEnergy
      },
      comparisonImage: sideBySidePng
    });
  }

  // Save report JSON
  const reportPath = path.join(EVAL_DIR, "video_evaluation_results.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n================================================================================`);
  console.log(`Video Evaluation Complete! Results saved to: ${reportPath}`);
  console.log(`================================================================================`);
}

main().catch(err => {
  console.error("Video evaluator error:", err);
  process.exit(1);
});
