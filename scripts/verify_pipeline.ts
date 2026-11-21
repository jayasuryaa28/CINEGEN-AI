import { ffmpegService } from "../src/services/ffmpeg";
import { videoPipeline, getResolutionForQuality } from "../src/services/pipeline";
import { jobRepository } from "../src/services/db";
import { storageService } from "../src/services/storage";
import { ProcessingJob } from "../src/types";
import path from "path";
import fs from "fs";

async function runEndToEndTest() {
  console.log("=== CINEGEN AI: PHASE 1 END-TO-END PIPELINE VERIFICATION ===");

  const testVideoPath = path.resolve("./test_input.mp4");
  if (!fs.existsSync(testVideoPath)) {
    throw new Error(`Test file not found: ${testVideoPath}`);
  }

  // 1. Test probe & metadata detection
  console.log("\n[1/5] Testing FFprobe Server-side Inspection...");
  const metadata = await ffmpegService.probeVideo(testVideoPath);
  console.log("Detected metadata:", {
    format: metadata.format,
    duration: metadata.durationFormatted,
    resolution: `${metadata.width}x${metadata.height}`,
    framerate: metadata.framerate,
    videoCodec: metadata.videoCodec,
    audioCodec: metadata.audioCodec,
    hasAudio: metadata.hasAudio,
  });

  if (!metadata.hasAudio || metadata.duration <= 0) {
    throw new Error("Metadata probe assertion failed.");
  }
  console.log("✓ Server-side metadata probe verified.");

  // 2. Test saving to storage
  console.log("\n[2/5] Testing Secure Local Storage...");
  const savedPath = await storageService.saveUploadedFile(testVideoPath, "test_input.mp4");
  console.log("✓ Stored video in:", savedPath);

  // 3. Test job creation
  console.log("\n[3/5] Testing Job Repository & Resolution Mapping...");
  const jobId = "test_job_1";
  const targetQuality = "1080p";
  const targetResolution = getResolutionForQuality(targetQuality);

  const job: ProcessingJob = {
    id: jobId,
    originalFilename: "test_input.mp4",
    inputFilePath: savedPath,
    outputQuality: targetQuality,
    targetResolution,
    metadata,
    status: "queued",
    progress: 0,
    currentStage: "Queued",
    chunksTotal: 0,
    chunksCompleted: 0,
    aiModulesStatus: {
      cinevision: "placeholder",
      cineframe: "placeholder",
      noisenet: "placeholder",
      stemnet: "placeholder",
      echonet: "placeholder",
      voicenet: "placeholder",
      cinesync: "placeholder",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await jobRepository.create(job);
  console.log("✓ Job initialized and saved in repository:", jobId);

  // 4. Test pipeline execution
  console.log("\n[4/5] Executing Video Processing Pipeline (Audio extract, segment, chunk upscale, merge, mux)...");
  const completedJob = await videoPipeline.processJob(jobId);
  console.log("Pipeline result:", {
    status: completedJob.status,
    progress: `${completedJob.progress}%`,
    outputVideoPath: completedJob.outputVideoPath,
    chunksTotal: completedJob.chunksTotal,
    chunksCompleted: completedJob.chunksCompleted,
  });

  if (completedJob.status !== "completed" || !completedJob.outputVideoPath) {
    throw new Error("Pipeline did not complete successfully.");
  }
  console.log("✓ Pipeline execution verified.");

  // 5. Test final output video validity with ffprobe
  console.log("\n[5/5] Inspecting Final Enhanced Output Video with FFprobe...");
  const outMeta = await ffmpegService.probeVideo(completedJob.outputVideoPath);
  console.log("Final Output Metadata:", {
    resolution: `${outMeta.width}x${outMeta.height}`,
    duration: outMeta.durationFormatted,
    videoCodec: outMeta.videoCodec,
    audioCodec: outMeta.audioCodec,
    hasAudio: outMeta.hasAudio,
  });

  if (outMeta.width !== 1920 || outMeta.height !== 1080) {
    throw new Error(`Output resolution mismatch: expected 1920x1080, got ${outMeta.width}x${outMeta.height}`);
  }
  if (!outMeta.hasAudio) {
    throw new Error("Final output video is missing synchronized audio stream.");
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL PHASE 1 CORE PLATFORM CRITERIA VERIFIED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runEndToEndTest().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
