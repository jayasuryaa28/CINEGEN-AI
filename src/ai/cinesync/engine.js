const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { timelineAnalyzer } = require("./timeline");
const { AudioDSP } = require("../audio/dsp");

class CineSyncEngine {
  async calculateOffset(videoFrames, audioBuffer) {
    if (videoFrames.length < 2 || audioBuffer.length < 44) {
      return 0;
    }

    try {
      const { samples, sampleRate } = AudioDSP.decodeWav(audioBuffer);
      const numFrames = videoFrames.length;

      const visualEnergy = new Array(numFrames).fill(0);
      for (let i = 1; i < numFrames; i++) {
        const prev = videoFrames[i - 1];
        const curr = videoFrames[i];
        const minLen = Math.min(prev.length, curr.length);
        let diffSum = 0;
        const step = Math.max(1, Math.floor(minLen / 1000));
        let count = 0;
        for (let p = 0; p < minLen; p += step) {
          diffSum += Math.abs(curr[p] - prev[p]);
          count++;
        }
        visualEnergy[i] = count > 0 ? diffSum / count : 0;
      }

      const fps = 24;
      const samplesPerFrame = Math.floor(sampleRate / fps);
      const audioEnergy = new Array(numFrames).fill(0);

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

      const maxLag = Math.min(12, Math.floor(numFrames / 4));
      if (maxLag <= 0) return 0;

      let bestLag = 0;
      let maxCorr = -Infinity;

      const vMean = visualEnergy.reduce((a, b) => a + b, 0) / numFrames;
      const aMean = audioEnergy.reduce((a, b) => a + b, 0) / numFrames;

      let vStd = Math.sqrt(visualEnergy.reduce((sum, v) => sum + Math.pow(v - vMean, 2), 0) / numFrames);
      let aStd = Math.sqrt(audioEnergy.reduce((sum, a) => sum + Math.pow(a - aMean, 2), 0) / numFrames);

      if (vStd < 1e-4 || aStd < 1e-4) {
        return 0;
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

      const offsetMs = Math.round((bestLag / fps) * 1000);
      return offsetMs;
    } catch {
      return 0;
    }
  }

  buildSyncPlan(timeline) {
    const targetFps = timeline.video?.fpsNominal || 24;
    const targetSampleRate = 48000;
    const audioFilters = [];
    const videoFilters = [];

    let action = "preserve";
    let offsetMs = timeline.initialOffsetMs;
    let audioDelayMs = 0;
    let resampleNeeded = false;

    if (timeline.isAligned && !timeline.video?.isVfr) {
      action = "preserve";
      offsetMs = 0;
    } else if (Math.abs(timeline.initialOffsetMs) >= 15) {
      action = "align_offset";
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
      action = "conform_drift";
      resampleNeeded = true;
      audioFilters.push("aresample=async=1000:min_hard_comp=0.100000:first_pts=0");
    }

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

  calculateChunkBoundaries(totalDuration, targetChunkDuration = 10, fps = 24, sampleRate = 48000) {
    const chunks = [];
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

  async assembleFinalMedia(options) {
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
      const args = ["-y"];

      args.push("-i", restoredVideoPath);

      const hasProcessedAudio = processedAudioPath && fs.existsSync(processedAudioPath);
      if (hasProcessedAudio) {
        args.push("-i", processedAudioPath);
      }

      const hasOriginalFallback = syncPlan.preserveOriginalFallback && fs.existsSync(originalSourcePath);
      if (hasOriginalFallback) {
        args.push("-i", originalSourcePath);
      }

      args.push("-map", "0:v:0");

      if (hasProcessedAudio && hasOriginalFallback) {
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
        args.push("-c:v", "copy", "-an");
      }

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

const cineSyncEngine = new CineSyncEngine();

module.exports = {
  CineSyncEngine,
  cineSyncEngine,
};
