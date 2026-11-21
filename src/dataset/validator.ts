import fs from "fs";
import { ffmpegService } from "@/services/ffmpeg";
import { DatasetSamplePair, QualityValidationReport } from "@/types/dataset";

export class DatasetValidator {
  /**
   * Performs deep automated quality checks across every clean/degraded pair in the dataset.
   */
  public async validatePair(pair: DatasetSamplePair): Promise<{
    passed: boolean;
    errors: { type: any; message: string }[];
  }> {
    const errors: { type: any; message: string }[] = [];

    // 1. Physical existence of all media files
    if (!fs.existsSync(pair.cleanTarget.videoPath)) {
      errors.push({
        type: "missing_file",
        message: `Clean target video not found: ${pair.cleanTarget.videoPath}`,
      });
    }
    if (!fs.existsSync(pair.cleanTarget.audioPath)) {
      errors.push({
        type: "missing_file",
        message: `Clean target audio not found: ${pair.cleanTarget.audioPath}`,
      });
    }
    if (!fs.existsSync(pair.degradedSample.videoPath)) {
      errors.push({
        type: "missing_file",
        message: `Degraded video not found: ${pair.degradedSample.videoPath}`,
      });
    }
    if (!fs.existsSync(pair.degradedSample.audioPath)) {
      errors.push({
        type: "missing_file",
        message: `Degraded audio not found: ${pair.degradedSample.audioPath}`,
      });
    }

    if (errors.length > 0) {
      return { passed: false, errors };
    }

    // 2. Deep FFprobe inspection of degraded media files
    try {
      const degVideoMeta = await ffmpegService.probeVideo(pair.degradedSample.videoPath);
      const cleanVideoMeta = await ffmpegService.probeVideo(pair.cleanTarget.videoPath);

      // Verify non-zero duration and duration match within reasonable tolerance (0.5s)
      if (degVideoMeta.duration <= 0 || cleanVideoMeta.duration <= 0) {
        errors.push({
          type: "corrupt_media",
          message: `Zero or invalid duration detected (Clean: ${cleanVideoMeta.duration}s, Degraded: ${degVideoMeta.duration}s)`,
        });
      }

      if (Math.abs(degVideoMeta.duration - cleanVideoMeta.duration) > 0.5) {
        errors.push({
          type: "mismatched_duration",
          message: `Duration mismatch between clean (${cleanVideoMeta.duration.toFixed(2)}s) and degraded (${degVideoMeta.duration.toFixed(2)}s)`,
        });
      }

      // Verify resolution degradation occurred as configured
      const expectedWidth = pair.degradationProfileApplied.video.downscaleWidth;
      const expectedHeight = pair.degradationProfileApplied.video.downscaleHeight;
      if (degVideoMeta.width !== expectedWidth || degVideoMeta.height !== expectedHeight) {
        errors.push({
          type: "invalid_resolution",
          message: `Degraded resolution mismatch. Expected ${expectedWidth}x${expectedHeight}, got ${degVideoMeta.width}x${degVideoMeta.height}`,
        });
      }
    } catch (probeErr: any) {
      errors.push({
        type: "corrupt_media",
        message: `FFprobe failed to inspect media pair: ${probeErr.message}`,
      });
    }

    // 3. Audio file size check
    try {
      const cleanAudioStat = await fs.promises.stat(pair.cleanTarget.audioPath);
      const degAudioStat = await fs.promises.stat(pair.degradedSample.audioPath);

      if (cleanAudioStat.size < 1000 || degAudioStat.size < 1000) {
        errors.push({
          type: "broken_audio",
          message: `Audio track too small or unwritten (Clean: ${cleanAudioStat.size}B, Degraded: ${degAudioStat.size}B)`,
        });
      }
    } catch (statErr: any) {
      errors.push({
        type: "broken_audio",
        message: `Failed to stat audio streams: ${statErr.message}`,
      });
    }

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates an entire manifest of pairs
   */
  public async validateDataset(samples: DatasetSamplePair[]): Promise<QualityValidationReport> {
    const report: QualityValidationReport = {
      passed: true,
      timestamp: new Date().toISOString(),
      totalChecked: samples.length,
      errors: [],
      warnings: [],
    };

    for (const sample of samples) {
      const res = await this.validatePair(sample);
      if (!res.passed) {
        report.passed = false;
        for (const err of res.errors) {
          report.errors.push({
            pairId: sample.pairId,
            type: err.type,
            message: err.message,
          });
        }
      }
    }

    return report;
  }
}

export const datasetValidator = new DatasetValidator();
