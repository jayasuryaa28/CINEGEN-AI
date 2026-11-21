import fs from "fs";
import path from "path";
import { ffmpegService } from "./ffmpeg";
import { storageService } from "./storage";
import { jobRepository } from "./db";
import { perspectiveService } from "./perspectiveService";
import { aiRegistry } from "@/ai/models";
import { AudioDSP } from "@/ai/audio/dsp";
import { timelineAnalyzer, TimelineReport } from "@/ai/cinesync/timeline";
import { cineSyncEngine, SyncPlan } from "@/ai/cinesync/engine";
import { cineSyncValidator, ValidationResult } from "@/ai/cinesync/validator";
import { computeRegistry } from "@/compute/providerRegistry";
import { jobScheduler } from "@/compute/scheduler/scheduler";
import { ProcessingJob, OutputQuality } from "@/types";

export function getResolutionForQuality(quality: OutputQuality): { width: number; height: number } {
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

export class VideoProcessingPipeline {
  /**
   * Pause an active processing job gracefully
   */
  public async pauseJob(jobId: string): Promise<ProcessingJob | null> {
    const job = await jobRepository.findById(jobId);
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed") return job;

    return jobRepository.update(jobId, {
      status: "paused",
      currentStage: "Processing paused by user. Ready to resume.",
    });
  }

  /**
   * Resume a paused or interrupted processing job
   */
  public async resumeJob(jobId: string): Promise<ProcessingJob> {
    const job = await jobRepository.findById(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status === "completed") return job;

    await jobRepository.update(jobId, {
      status: "processing_video",
      currentStage: "Resuming chunk-based processing from checkpoint...",
    });

    return this.processJob(jobId);
  }

  /**
   * Retry a failed processing job
   */
  public async retryJob(jobId: string): Promise<ProcessingJob> {
    const job = await jobRepository.findById(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    await jobRepository.update(jobId, {
      status: "queued",
      progress: 0,
      error: undefined,
      currentStage: "Retrying processing pipeline from clean checkpoint...",
    });

    return this.processJob(jobId);
  }

  /**
   * Executes the full-length video and audio processing pipeline with CINESYNC
   */
  public async processJob(jobId: string): Promise<ProcessingJob> {
    let job = await jobRepository.findById(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    try {
      // 1. Stage: Validating & CINESYNC Timeline Analysis
      await jobRepository.update(jobId, {
        status: "validating",
        progress: 5,
        currentStage: "Validating input video integrity and CINESYNC timeline analysis",
      });

      const jobDir = await storageService.createJobDirectory(jobId);
      const chunksDir = path.join(jobDir, "chunks");
      const audioDir = path.join(jobDir, "audio");

      // CINESYNC Timeline & Differential Analysis
      let timeline: TimelineReport | null = null;
      let syncPlan: SyncPlan | null = null;
      try {
        timeline = await timelineAnalyzer.analyzeTimeline(job.inputFilePath);
        syncPlan = cineSyncEngine.buildSyncPlan(timeline);
        console.log(`[CINESYNC] Timeline Analysis for Job ${jobId}:`, {
          initialOffsetMs: timeline.initialOffsetMs.toFixed(2),
          durationDeltaMs: timeline.durationDiscrepancyMs.toFixed(2),
          isVfr: timeline.video?.isVfr,
          syncAction: syncPlan.action,
        });

        await jobRepository.update(jobId, {
          syncReport: {
            initialOffsetMs: timeline.initialOffsetMs,
            durationDiscrepancyMs: timeline.durationDiscrepancyMs,
            isVfr: timeline.video?.isVfr,
            syncAction: syncPlan.action,
          },
        });
      } catch (syncErr) {
        console.warn("[CINESYNC] Timeline analysis warning:", syncErr);
      }

      // CINEVISION Visual Recording & Geometry Inspection (Active Neural Model)
      try {
        const { spawnSync } = require("child_process");
        const sampleFramePath = path.join(jobDir, "sample_frame.rgb");
        const res = spawnSync("ffmpeg", [
          "-ss",
          "1.0",
          "-i",
          job.inputFilePath,
          "-vframes",
          "1",
          "-vf",
          "scale=128:128",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          sampleFramePath,
        ]);
        if (res.status === 0 && fs.existsSync(sampleFramePath)) {
          const rawBuffer = await fs.promises.readFile(sampleFramePath);
          const visionAnalysis = await aiRegistry.cinevision.analyzeFrame(rawBuffer);
          console.log(`[CINEVISION] Visual Analysis for Job ${jobId}:`, {
            hasPerspective: visionAnalysis.hasScreenPerspective,
            blurScore: visionAnalysis.blurScore.toFixed(3),
            noiseScore: visionAnalysis.noiseScore.toFixed(3),
          });
        }
      } catch (cvErr) {
        console.warn("[CINEVISION] Visual analysis warning:", cvErr);
      }

      // 2. Stage: Audio Extraction
      let extractedAudioPath: string | null = job.extractedAudioPath || null;
      if (job.metadata.hasAudio && (!extractedAudioPath || !fs.existsSync(extractedAudioPath))) {
        await jobRepository.update(jobId, {
          status: "extracting_audio",
          progress: 15,
          currentStage: "Extracting 48kHz master audio stream",
        });

        const targetWav = path.join(audioDir, "master_audio.wav");
        extractedAudioPath = await ffmpegService.extractAudio(job.inputFilePath, targetWav);
        await jobRepository.update(jobId, { extractedAudioPath });
      }

      // 3. Stage: Audio Neural Processing (Modular Adapter Pass)
      let processedAudioPath: string | null = job.processedAudioPath || null;
      if (extractedAudioPath && (!processedAudioPath || !fs.existsSync(processedAudioPath))) {
        await jobRepository.update(jobId, {
          status: "processing_audio",
          progress: 25,
          currentStage: "Running Audio Processing (NOISENET / ECHONET / STEMNET / VOICENET)",
        });

        // Pass through audio AI modular adapters
        const rawAudio = await fs.promises.readFile(extractedAudioPath);
        const denoised = await aiRegistry.noisenet.suppressNoise(rawAudio);
        const dereverbed = await aiRegistry.echonet.dereverberate(denoised);
        const stems = await aiRegistry.stemnet.separateStems(dereverbed);
        const enhancedVoice = await aiRegistry.voicenet.enhanceSpeech(stems.dialogue);

        // Save isolated stems
        if (stems.dialogue.length > 0) {
          await fs.promises.writeFile(path.join(audioDir, "stem_dialogue.wav"), enhancedVoice);
        }
        if (stems.music.length > 0) {
          await fs.promises.writeFile(path.join(audioDir, "stem_music.wav"), stems.music);
        }
        if (stems.effects.length > 0) {
          await fs.promises.writeFile(path.join(audioDir, "stem_effects.wav"), stems.effects);
        }

        // Recombine enhanced dialogue with music and effects into cinema master
        let masterAudio = enhancedVoice;
        try {
          if (stems.music.length >= 44 && stems.effects.length >= 44) {
            const d = AudioDSP.decodeWav(enhancedVoice);
            const m = AudioDSP.decodeWav(stems.music);
            const e = AudioDSP.decodeWav(stems.effects);
            const maxLen = Math.max(d.samples.length, m.samples.length, e.samples.length);
            const mixed = new Float32Array(maxLen);
            for (let i = 0; i < maxLen; i++) {
              const sD = i < d.samples.length ? d.samples[i] : 0;
              const sM = i < m.samples.length ? m.samples[i] : 0;
              const sE = i < e.samples.length ? e.samples[i] : 0;
              const sum = sD + sM + sE;
              mixed[i] = Math.max(-1, Math.min(1, sum));
            }
            masterAudio = AudioDSP.encodeWav(mixed, d.sampleRate);
          }
        } catch {
          masterAudio = enhancedVoice.length > 0 ? enhancedVoice : rawAudio;
        }

        processedAudioPath = path.join(audioDir, "processed_audio.wav");
        await fs.promises.writeFile(processedAudioPath, masterAudio.length > 0 ? masterAudio : rawAudio);
        await jobRepository.update(jobId, { processedAudioPath });
      }

      // Check if paused
      job = await jobRepository.findById(jobId);
      if (job?.status === "paused") return job;

      // 4. Stage: Video Segmentation into Chunks (CINESYNC integer frame alignment)
      const diskCheck = jobScheduler.checkDiskSpace(jobDir, 1.0);
      if (!diskCheck.hasSpace) {
        throw new Error(`Insufficient storage capacity: ${diskCheck.freeGb} GB available, at least 1.0 GB required.`);
      }

      await jobRepository.update(jobId, {
        status: "segmenting_chunks",
        progress: 35,
        currentStage: "Segmenting video into chunks with exact CINESYNC frame boundary alignment",
      });

      // Segment duration: 10s for short videos, 30s for long files (up to 4 hours)
      const segmentDuration = job!.metadata.duration > 1800 ? 30 : 10;
      const chunkPattern = path.join(chunksDir, "chunk_%04d.mp4");

      const existingChunks = fs.existsSync(chunksDir)
        ? (await fs.promises.readdir(chunksDir)).filter((f) => f.startsWith("chunk_") && f.endsWith(".mp4"))
        : [];

      if (existingChunks.length === 0) {
        await ffmpegService.segmentVideo(job!.inputFilePath, chunkPattern, segmentDuration);
      }

      // Inspect created chunks
      const chunkFiles = (await fs.promises.readdir(chunksDir))
        .filter((f) => f.startsWith("chunk_") && f.endsWith(".mp4"))
        .sort();

      const totalChunks = chunkFiles.length;
      const completedIndices: number[] = job!.completedChunkIndices || [];

      await jobRepository.update(jobId, {
        chunksTotal: totalChunks,
        chunksCompleted: completedIndices.length,
      });

      // 5. Stage: Processing Video Chunks (CINEFRAME / Super-resolution)
      // Determine optimal compute provider and configure dynamic memory-aware batching
      const provider = await computeRegistry.resolveOptimalProvider();
      const batchConfig = await provider.getBatchConfig(job!.targetResolution.width, job!.targetResolution.height);
      jobScheduler.setMaxConcurrency(batchConfig.concurrencyLimit);

      await jobRepository.update(jobId, {
        status: "processing_video",
        progress: 45 + Math.floor((completedIndices.length / totalChunks) * 35),
        currentStage: `Processing ${totalChunks} video chunks on ${provider.name} (CINEFRAME / ${job!.outputQuality})`,
        computeProviderUsed: provider.id,
      });

      const processedChunkPaths: string[] = [];
      const targetRes = job!.targetResolution;

      for (let i = 0; i < totalChunks; i++) {
        // Check if paused
        const currentCheck = await jobRepository.findById(jobId);
        if (currentCheck?.status === "paused") {
          console.log(`[CINEGEN] Job ${jobId} paused at chunk ${i}/${totalChunks}`);
          return currentCheck;
        }

        const rawChunkName = chunkFiles[i];
        const rawChunkPath = path.join(chunksDir, rawChunkName);
        const outChunkName = `proc_${rawChunkName}`;
        const outChunkPath = path.join(chunksDir, outChunkName);

        // Checkpoint-aware: If chunk already processed and valid, skip re-computation
        if (!fs.existsSync(outChunkPath) || fs.statSync(outChunkPath).size < 1000) {
          // Perspective analysis (CINEVISION neural evaluation + temporal continuity)
          let perspectiveDecision: any = undefined;
          try {
            perspectiveDecision = await perspectiveService.analyzeChunkPerspective(
              rawChunkPath,
              targetRes.width,
              targetRes.height,
              {
                inputWidth: job!.metadata.width,
                inputHeight: job!.metadata.height,
              }
            );
            if (perspectiveDecision.enabled) {
              console.log(
                `[CINEVISION] Perspective active for Job ${jobId} Chunk ${i}: ${perspectiveDecision.reason}`
              );
            } else {
              console.log(
                `[CINEVISION] Perspective bypass for Job ${jobId} Chunk ${i}: ${perspectiveDecision.reason}`
              );
            }
          } catch (perspErr) {
            console.warn(`[CINEVISION] Perspective analysis notice for chunk ${i}:`, perspErr);
          }

          // Schedule chunk execution through JobScheduler on optimal compute provider
          await jobScheduler.scheduleChunk({
            taskId: `task_${jobId}_chunk_${i}`,
            jobId,
            chunkIndex: i,
            totalChunks,
            inputChunkPath: rawChunkPath,
            outputChunkPath: outChunkPath,
            targetWidth: targetRes.width,
            targetHeight: targetRes.height,
            quality: job!.outputQuality,
            fps: job!.metadata.framerate || 24,
            durationSec: segmentDuration,
            perspective: perspectiveDecision,
          });
        }

        processedChunkPaths.push(outChunkPath);

        if (!completedIndices.includes(i)) {
          completedIndices.push(i);
        }

        const completedCount = completedIndices.length;
        const videoProgress = 45 + Math.floor((completedCount / totalChunks) * 35); // 45% -> 80%

        await jobRepository.update(jobId, {
          chunksCompleted: completedCount,
          completedChunkIndices: completedIndices,
          progress: videoProgress,
          currentStage: `Processed chunk ${completedCount}/${totalChunks} via ${provider.name} to ${job!.outputQuality}`,
        });
      }

      // 6. Stage: Merging Chunks
      await jobRepository.update(jobId, {
        status: "merging_chunks",
        progress: 85,
        currentStage: "Merging processed video chunks with seamless boundary crossfade",
      });

      const concatListFile = path.join(chunksDir, "concat_list.txt");
      const concatContent = processedChunkPaths
        .map((p) => `file '${p.replace(/\\/g, "/")}'`)
        .join("\n");
      await fs.promises.writeFile(concatListFile, concatContent, "utf-8");

      const mergedVideoOnlyPath = path.join(jobDir, "merged_video_only.mp4");
      await ffmpegService.mergeVideoChunks(concatListFile, mergedVideoOnlyPath);

      // 7. Stage: CINESYNC Final Multiplexing & Dual-Audio Packaging
      await jobRepository.update(jobId, {
        status: "multiplexing",
        progress: 95,
        currentStage: "Multiplexing CINESYNC synchronized audio and fallback stream into final MP4",
      });

      const finalFilename = `CINEGEN_${jobId}_${job!.outputQuality}.mp4`;
      const finalOutputPath = path.join(storageService.getProcessedDir(), finalFilename);

      const effectiveSyncPlan = syncPlan || cineSyncEngine.buildSyncPlan({
        filePath: job!.inputFilePath,
        formatDuration: job!.metadata.duration,
        video: null,
        audio: null,
        initialOffsetMs: 0,
        durationDiscrepancyMs: 0,
        driftRate: 0,
        driftMsPerHour: 0,
        isAligned: true,
        syncRecommendation: "preserve",
        diagnostics: [],
      });

      const assemblyResult = await cineSyncEngine.assembleFinalMedia({
        restoredVideoPath: mergedVideoOnlyPath,
        processedAudioPath,
        originalSourcePath: job!.inputFilePath,
        finalOutputPath,
        syncPlan: effectiveSyncPlan,
      });

      // 8. Stage: CINESYNC Output Quality Validation
      let validation: ValidationResult | null = null;
      try {
        validation = await cineSyncValidator.validateFinalExport(finalOutputPath, job!.metadata.duration);
        console.log(`[CINESYNC] Validation for Job ${jobId}:`, {
          isValid: validation.isValid,
          syncOffsetMs: validation.syncOffsetMs,
          durationDeltaSec: validation.checks.durationDeltaSec.toFixed(3),
          hasFallbackStream: validation.checks.hasFallbackStream,
          noClippingOrSilence: validation.noClippingOrSilence,
        });

        if (!validation.isValid && validation.errors.length > 0) {
          console.warn("[CINESYNC] Validation warnings:", validation.errors);
        }
      } catch (valErr) {
        console.warn("[CINESYNC] Validation execution warning:", valErr);
      }

      // 9. Stage: Completed
      const schedulerMetrics = jobScheduler.getMetrics();
      const completedJob = await jobRepository.update(jobId, {
        status: "completed",
        progress: 100,
        currentStage: `CINESYNC cinematic restoration complete via ${provider.name}. Video ready for download.`,
        outputVideoPath: finalOutputPath,
        hasFallbackStream: assemblyResult.hasFallbackStream,
        computeProviderUsed: provider.id,
        metrics: {
          averageChunkTimeMs: schedulerMetrics.averageChunkTimeMs,
          provider: provider.name,
        },
        completedAt: new Date().toISOString(),
      });

      // Cleanup temporary chunks
      try {
        await storageService.cleanupJobDirectory(jobId);
      } catch (cleanupErr) {
        console.warn("Notice: Job scratch directory cleanup had warning:", cleanupErr);
      }

      return completedJob!;
    } catch (err: any) {
      console.error(`Error processing job ${jobId}:`, err);
      await jobRepository.update(jobId, {
        status: "failed",
        error: err.message || "An error occurred during video processing pipeline",
        currentStage: "Processing failed",
      });
      throw err;
    }
  }
}

export const videoPipeline = new VideoProcessingPipeline();
