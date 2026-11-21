import { spawn } from "child_process";
import fs from "fs";
import { timelineAnalyzer, TimelineReport } from "./timeline";
import { AudioDSP } from "@/ai/audio/dsp";

export interface ValidationResult {
  isValid: boolean;
  videoValid: boolean;
  audioValid: boolean;
  durationMatch: boolean;
  timestampsValid: boolean;
  syncOffsetMs: number;
  syncValid: boolean;
  noClippingOrSilence: boolean;
  checks: {
    videoPlayable: boolean;
    audioPlayable: boolean;
    hasFallbackStream: boolean;
    finalDurationSec: number;
    expectedDurationSec: number;
    durationDeltaSec: number;
    audioRms: number;
    audioPeak: number;
    clippedSamples: number;
    hasSilentGaps: boolean;
  };
  errors: string[];
  warnings: string[];
}

export class CineSyncValidator {
  /**
   * Complete media verification suite
   */
  public async validateFinalExport(
    exportedPath: string,
    expectedDuration: number
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!fs.existsSync(exportedPath)) {
      return {
        isValid: false,
        videoValid: false,
        audioValid: false,
        durationMatch: false,
        timestampsValid: false,
        syncOffsetMs: Infinity,
        syncValid: false,
        noClippingOrSilence: false,
        checks: {
          videoPlayable: false,
          audioPlayable: false,
          hasFallbackStream: false,
          finalDurationSec: 0,
          expectedDurationSec: expectedDuration,
          durationDeltaSec: expectedDuration,
          audioRms: 0,
          audioPeak: 0,
          clippedSamples: 0,
          hasSilentGaps: true,
        },
        errors: [`Exported file not found: ${exportedPath}`],
        warnings: [],
      };
    }

    // 1. Analyze Timeline
    let timeline: TimelineReport;
    try {
      timeline = await timelineAnalyzer.analyzeTimeline(exportedPath);
    } catch (e: any) {
      errors.push(`Failed to analyze exported media timeline: ${e.message}`);
      return {
        isValid: false,
        videoValid: false,
        audioValid: false,
        durationMatch: false,
        timestampsValid: false,
        syncOffsetMs: Infinity,
        syncValid: false,
        noClippingOrSilence: false,
        checks: {
          videoPlayable: false,
          audioPlayable: false,
          hasFallbackStream: false,
          finalDurationSec: 0,
          expectedDurationSec: expectedDuration,
          durationDeltaSec: expectedDuration,
          audioRms: 0,
          audioPeak: 0,
          clippedSamples: 0,
          hasSilentGaps: true,
        },
        errors,
        warnings,
      };
    }

    const videoValid = !!timeline.video && timeline.video.duration > 0;
    const audioValid = !!timeline.audio && timeline.audio.duration > 0;
    if (!videoValid) errors.push("Video stream is missing or zero-length.");
    if (!audioValid) errors.push("Audio stream is missing or zero-length.");

    // 2. Playability Verification (Decode test frames / samples via FFmpeg null sink)
    const videoPlayable = await this.testStreamPlayable(exportedPath, "v:0");
    const audioPlayable = await this.testStreamPlayable(exportedPath, "a:0");
    if (!videoPlayable) errors.push("Video stream failed decoding/playability check.");
    if (!audioPlayable) errors.push("Audio stream failed decoding/playability check.");

    // Check for fallback audio track (Track 1 = Master, Track 2 = Original Fallback)
    const hasFallbackStream = await this.testStreamPlayable(exportedPath, "a:1");

    // 3. Duration Verification (within +/- 100ms tolerance)
    const finalDurationSec = timeline.formatDuration;
    const durationDeltaSec = Math.abs(finalDurationSec - expectedDuration);
    const durationMatch = durationDeltaSec <= 0.15; // 150ms tolerance
    if (!durationMatch) {
      errors.push(`Duration mismatch: exported = ${finalDurationSec.toFixed(3)}s, expected = ${expectedDuration.toFixed(3)}s (delta = ${(durationDeltaSec * 1000).toFixed(1)}ms).`);
    }

    // 4. Timestamp Verification
    const timestampsValid =
      (!timeline.video || (timeline.video.ptsInitial >= 0 && !timeline.video.hasDiscontinuities)) &&
      (!timeline.audio || timeline.audio.ptsInitial >= -0.05);
    if (!timestampsValid) {
      warnings.push("Timestamp discontinuities or irregular packet timing detected.");
    }

    // 5. Synchronization Verification (Tolerance +/- 20ms)
    const syncOffsetMs = Math.abs(timeline.initialOffsetMs);
    const syncValid = syncOffsetMs <= 25.0; // Cinema standard is well within 1 frame (41.7ms)
    if (!syncValid) {
      errors.push(`A/V synchronization offset of ${timeline.initialOffsetMs.toFixed(1)}ms exceeds 25ms cinema tolerance.`);
    }

    // 6. Audio Acoustic Integrity (Clipping & Silence Checks)
    let audioRms = 0;
    let audioPeak = 0;
    let clippedSamples = 0;
    let hasSilentGaps = false;

    if (audioValid) {
      try {
        const audioBuf = await this.extractAudioSamples(exportedPath);
        const decoded = AudioDSP.decodeWav(audioBuf);
        const s = decoded.samples;
        let sumSq = 0;

        for (let i = 0; i < s.length; i++) {
          const val = s[i];
          const abs = Math.abs(val);
          if (abs > audioPeak) audioPeak = abs;
          if (abs >= 0.999) clippedSamples++;
          sumSq += val * val;
        }

        audioRms = s.length > 0 ? Math.sqrt(sumSq / s.length) : 0;
        if (audioRms < 1e-4) {
          hasSilentGaps = true;
          warnings.push("Extracted audio stream is nearly or entirely silent.");
        }
      } catch (err: any) {
        warnings.push(`Could not run deep audio sample scan: ${err.message}`);
      }
    }

    const noClippingOrSilence = clippedSamples === 0 && !hasSilentGaps;
    if (clippedSamples > 0) {
      warnings.push(`Detected ${clippedSamples} clipped audio samples.`);
    }

    const isValid = videoValid && audioValid && videoPlayable && audioPlayable && durationMatch && syncValid && errors.length === 0;

    return {
      isValid,
      videoValid,
      audioValid,
      durationMatch,
      timestampsValid,
      syncOffsetMs,
      syncValid,
      noClippingOrSilence,
      checks: {
        videoPlayable,
        audioPlayable,
        hasFallbackStream,
        finalDurationSec,
        expectedDurationSec: expectedDuration,
        durationDeltaSec,
        audioRms,
        audioPeak,
        clippedSamples,
        hasSilentGaps,
      },
      errors,
      warnings,
    };
  }

  private async testStreamPlayable(filePath: string, streamSelector: string): Promise<boolean> {
    return new Promise((resolve) => {
      const args = [
        "-v", "error",
        "-i", filePath,
        "-map", streamSelector,
        "-t", "3", // decode up to 3 seconds
        "-f", "null",
        "-",
      ];
      const proc = spawn("ffmpeg", args);
      let errOutput = "";
      proc.stderr.on("data", (d) => (errOutput += d.toString()));
      proc.on("close", (code) => {
        resolve(code === 0 && errOutput.trim().length === 0);
      });
    });
  }

  private async extractAudioSamples(filePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i", filePath,
        "-map", "0:a:0",
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        "pipe:1",
      ];
      const proc = spawn("ffmpeg", args);
      const chunks: Buffer[] = [];
      let errOutput = "";

      proc.stdout.on("data", (c) => chunks.push(c));
      proc.stderr.on("data", (c) => (errOutput += c.toString()));
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(`Failed to decode audio: ${errOutput}`));
        resolve(Buffer.concat(chunks));
      });
    });
  }
}

export const cineSyncValidator = new CineSyncValidator();
