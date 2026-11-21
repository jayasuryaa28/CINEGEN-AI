import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { TimelineReport, timelineAnalyzer } from "./timeline";
import { AudioDSP } from "@/ai/audio/dsp";

export interface ChunkBoundary {
  index: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  duration: number; // in seconds
  startFrame: number;
  endFrame: number;
  frameCount: number;
  startSample: number;
  endSample: number;
  sampleCount: number;
}

export interface SyncPlan {
  action: "preserve" | "align_offset" | "conform_drift";
  offsetMs: number;
  audioDelayMs: number;
  resampleNeeded: boolean;
  targetSampleRate: number;
  targetFps: number;
  audioFilters: string[];
  videoFilters: string[];
  preserveOriginalFallback: boolean;
}

export interface AssemblyOptions {
  restoredVideoPath: string;
  processedAudioPath: string | null;
  originalSourcePath: string;
  finalOutputPath: string;
  syncPlan: SyncPlan;
  targetQuality?: string;
}

export class CineSyncEngine {
  /**
   * Audio-Visual Energy Cross-Correlation Offset Estimator
   */
  public async calculateOffset(videoFrames: Buffer[], audioBuffer: Buffer): Promise<number> {
    if (videoFrames.length < 2 || audioBuffer.length < 44) {
      return 0; // Not enough data to correlate
    }

    try {
      const { samples, sampleRate } = AudioDSP.decodeWav(audioBuffer);
      const numFrames = videoFrames.length;

      // 1. Calculate visual motion energy per frame (frame difference)
      const visualEnergy: number[] = new Array(numFrames).fill(0);
      for (let i = 1; i < numFrames; i++) {
        const prev = videoFrames[i - 1];
        const curr = videoFrames[i];
        const minLen = Math.min(prev.length, curr.length);
        let diffSum = 0;
        const step = Math.max(1, Math.floor(minLen / 1000)); // Sample ~1000 pixels for speed
        let count = 0;
        for (let p = 0; p < minLen; p += step) {
          diffSum += Math.abs(curr[p] - prev[p]);
          count++;
        }
        visualEnergy[i] = count > 0 ? diffSum / count : 0;
      }

      // 2. Calculate audio envelope energy in matching windows (assuming ~24 fps)
      const fps = 24;
      const samplesPerFrame = Math.floor(sampleRate / fps);
      const audioEnergy: number[] = new Array(numFrames).fill(0);

      for (let i = 0; i < numFrames; i++) {
        const start = i * samplesPerFrame;
        const end = Math.min(samples.length, start + samplesPerFrame);
        let sumSq = 0;
        let count = 0;
        for (let s = start; s < end; s++) {
          sumSq += samples[s] * samples[s];
          count++;
        }
        audioEnergy[i] = count > 0 ? Math.sqrt(sumSq / count) : 0;
      }

      // 3. Compute normalized cross-correlation over lag window [-12, +12] frames (~ +/-500ms)
      const maxLag = Math.min(12, Math.floor(numFrames / 4));
      if (maxLag <= 0) return 0;

      let bestLag = 0;
      let maxCorr = -Infinity;

      const vMean = visualEnergy.reduce((a, b) => a + b, 0) / numFrames;
      const aMean = audioEnergy.reduce((a, b) => a + b, 0) / numFrames;

      let vStd = Math.sqrt(visualEnergy.reduce((sum, v) => sum + Math.pow(v - vMean, 2), 0) / numFrames);
      let aStd = Math.sqrt(audioEnergy.reduce((sum, a) => sum + Math.pow(a - aMean, 2), 0) / numFrames);

      if (vStd < 1e-4 || aStd < 1e-4) {
        return 0; // Signals lack sufficient dynamics for correlation
      }

      for (let lag = -maxLag; lag <= maxLag; lag++) {
        let cov = 0;
        let overlap = 0;
        for (let i = 0; i < numFrames; i++) {
          const j = i + lag;
          if (j >= 0 && j < numFrames) {
            cov += (visualEnergy[i] - vMean) * (audioEnergy[j] - aMean);
            overlap++;
          }
        }
        const corr = overlap > 0 ? cov / (overlap * vStd * aStd) : 0;
        if (corr > maxCorr) {
          maxCorr = corr;
          bestLag = lag;
        }
      }

      // Convert best lag from frames to milliseconds
      const offsetMs = Math.round((bestLag / fps) * 1000);
      return offsetMs;
    } catch {
      return 0;
    }
  }

  /**
   * Synthesize a Synchronization Plan from timeline diagnostics
   */
  public buildSyncPlan(timeline: TimelineReport): SyncPlan {
    const targetFps = timeline.video?.fpsNominal || 24;
    const targetSampleRate = 48000;
    const audioFilters: string[] = [];
    const videoFilters: string[] = [];

    let action: SyncPlan["action"] = "preserve";
    let offsetMs = timeline.initialOffsetMs;
    let audioDelayMs = 0;
    let resampleNeeded = false;

    // Rule: Do not modify synchronization unnecessarily when original streams are already aligned (< 15ms)
    if (timeline.isAligned && !timeline.video?.isVfr) {
      action = "preserve";
      offsetMs = 0;
    } else if (Math.abs(timeline.initialOffsetMs) >= 15) {
      action = "align_offset";
      // If audio starts before video (initialOffsetMs < 0), delay audio
      // If audio starts after video (initialOffsetMs > 0), advance audio by trimming delay
      if (timeline.initialOffsetMs < 0) {
        audioDelayMs = Math.abs(timeline.initialOffsetMs);
        audioFilters.push(`adelay=${Math.round(audioDelayMs)}|${Math.round(audioDelayMs)}`);
      } else {
        audioFilters.push(`atrim=start=${(timeline.initialOffsetMs / 1000).toFixed(4)},asetpts=PTS-STARTPTS`);
      }
      if (Math.abs(timeline.durationDiscrepancyMs + timeline.initialOffsetMs) > 100) {
        resampleNeeded = true;
        audioFilters.push("aresample=async=1000:min_hard_comp=0.100000:first_pts=0");
      }
    } else {
      // Clock drift, duration mismatch, or VFR detected
      action = "conform_drift";
      resampleNeeded = true;
      audioFilters.push("aresample=async=1000:min_hard_comp=0.100000:first_pts=0");
    }

    // Always enforce Constant Frame Rate (CFR) filter for video to prevent player jitter
    if (timeline.video?.isVfr) {
      videoFilters.push(`fps=fps=${targetFps}`);
    }

    return {
      action,
      offsetMs,
      audioDelayMs,
      resampleNeeded,
      targetSampleRate,
      targetFps,
      audioFilters,
      videoFilters,
      preserveOriginalFallback: true,
    };
  }

  /**
   * Exact Sample and Frame Boundary Calculator for Chunking
   * Guarantees 0 dropped frames, 0 duplicated frames, and 0 audio sample discontinuities.
   */
  public calculateChunkBoundaries(
    totalDuration: number,
    targetChunkDuration: number = 10,
    fps: number = 24,
    sampleRate: number = 48000
  ): ChunkBoundary[] {
    const chunks: ChunkBoundary[] = [];
    const totalFrames = Math.max(1, Math.round(totalDuration * fps));
    const totalSamples = Math.max(1, Math.round(totalDuration * sampleRate));
    const framesPerChunk = Math.max(1, Math.round(targetChunkDuration * fps));

    let currentFrame = 0;
    let chunkIndex = 0;

    while (currentFrame < totalFrames) {
      const startFrame = currentFrame;
      const endFrame = Math.min(totalFrames, currentFrame + framesPerChunk);
      const frameCount = endFrame - startFrame;

      const startTime = startFrame / fps;
      const endTime = endFrame / fps;
      const duration = endTime - startTime;

      const startSample = Math.round(startTime * sampleRate);
      const endSample = endFrame === totalFrames ? totalSamples : Math.round(endTime * sampleRate);
      const sampleCount = endSample - startSample;

      chunks.push({
        index: chunkIndex,
        startTime,
        endTime,
        duration,
        startFrame,
        endFrame,
        frameCount,
        startSample,
        endSample,
        sampleCount,
      });

      currentFrame = endFrame;
      chunkIndex++;
    }

    return chunks;
  }

  /**
   * Final Media Assembly with Dual Audio Tracks (Restored Master + Original Fallback)
   */
  public async assembleFinalMedia(options: AssemblyOptions): Promise<{
    outputPath: string;
    hasFallbackStream: boolean;
    duration: number;
  }> {
    const {
      restoredVideoPath,
      processedAudioPath,
      originalSourcePath,
      finalOutputPath,
      syncPlan,
    } = options;

    if (!fs.existsSync(restoredVideoPath)) {
      throw new Error(`Restored video missing for assembly: ${restoredVideoPath}`);
    }

    const outDir = path.dirname(finalOutputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    return new Promise((resolve, reject) => {
      const args: string[] = ["-y"];

      // Input 0: Restored Video
      args.push("-i", restoredVideoPath);

      // Input 1: Enhanced/Processed Audio (Master)
      const hasProcessedAudio = !!(processedAudioPath && fs.existsSync(processedAudioPath));
      if (hasProcessedAudio) {
        args.push("-i", processedAudioPath!);
      }

      // Input 2: Original Media for Fallback Audio Stream
      const hasOriginalFallback = !!(syncPlan.preserveOriginalFallback && fs.existsSync(originalSourcePath));
      if (hasOriginalFallback) {
        args.push("-i", originalSourcePath);
      }

      // Map Video: Stream 0:v:0
      args.push("-map", "0:v:0");

      if (hasProcessedAudio && hasOriginalFallback) {
        // Map Track 1 (Default): Processed Master Audio
        // Map Track 2 (Fallback): Original Audio Stream
        args.push("-map", "1:a:0");
        args.push("-map", "2:a:0?");

        args.push(
          "-c:v", "copy",
          "-c:a:0", "aac",
          "-b:a:0", "320k",
          "-metadata:s:a:0", "title=CINEGEN Master Audio (Restored)",
          "-metadata:s:a:0", "handler_name=CINEGEN Master",
          "-c:a:1", "copy",
          "-metadata:s:a:1", "title=Original Audio (Fallback)",
          "-metadata:s:a:1", "handler_name=Original Fallback"
        );
      } else if (hasProcessedAudio) {
        args.push("-map", "1:a:0");
        args.push(
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "320k",
          "-metadata:s:a:0", "title=CINEGEN Master Audio"
        );
      } else {
        // Video only
        args.push("-c:v", "copy", "-an");
      }

      // Faststart for seamless web streaming playback
      args.push("-shortest", "-movflags", "+faststart", finalOutputPath);

      const proc = spawn("ffmpeg", args);
      let stderr = "";

      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("close", async (code) => {
        if (code !== 0) {
          return reject(new Error(`Final assembly multiplexing failed (code ${code}): ${stderr}`));
        }

        try {
          const finalReport = await timelineAnalyzer.analyzeTimeline(finalOutputPath);
          resolve({
            outputPath: finalOutputPath,
            hasFallbackStream: hasProcessedAudio && hasOriginalFallback,
            duration: finalReport.formatDuration,
          });
        } catch {
          resolve({
            outputPath: finalOutputPath,
            hasFallbackStream: hasProcessedAudio && hasOriginalFallback,
            duration: 0,
          });
        }
      });
    });
  }
}

export const cineSyncEngine = new CineSyncEngine();
