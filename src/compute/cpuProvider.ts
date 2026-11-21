import fs from "fs";
import { BaseComputeProvider } from "./provider";
import {
  ComputeProviderType,
  BatchConfig,
  ChunkExecutionTask,
  ChunkExecutionResult,
} from "./types";
import { DeviceDetector } from "./deviceDetector";
import { ffmpegService } from "../services/ffmpeg";

export class CpuComputeProvider extends BaseComputeProvider {
  public readonly id = "local-cpu-provider";
  public readonly name = "Local CPU Compute Provider";
  public readonly type: ComputeProviderType = "cpu";

  constructor() {
    super();
    this.maxConcurrency = 2;
  }

  public async initialize(): Promise<boolean> {
    const hw = await DeviceDetector.detectHardware();
    if (!hw.ffmpegAvailable) {
      this.status = "error";
      this.lastError = "FFmpeg is not installed or accessible in local environment.";
      return false;
    }

    // Set concurrency proportional to available CPU cores
    this.maxConcurrency = Math.max(1, Math.min(4, Math.floor(hw.cpuCores / 2)));
    this.status = "ready";
    return true;
  }

  public async getBatchConfig(targetWidth: number, targetHeight: number): Promise<BatchConfig> {
    const hw = await DeviceDetector.detectHardware();
    const freeMB = hw.freeMemoryMB;
    const pixels = targetWidth * targetHeight;

    // Dynamically choose batch size and memory ceiling based on actual free RAM
    let batchSize = 4;
    let maxMemoryPerBatchMB = 512;

    if (pixels >= 3840 * 2160) {
      // 4K Ultra HD
      batchSize = freeMB > 4000 ? 2 : 1;
      maxMemoryPerBatchMB = 1024;
    } else if (pixels >= 2560 * 1440) {
      // 1440p Quad HD
      batchSize = freeMB > 4000 ? 4 : 2;
      maxMemoryPerBatchMB = 768;
    } else if (pixels >= 1920 * 1080) {
      // 1080p Full HD
      batchSize = freeMB > 4000 ? 8 : 4;
      maxMemoryPerBatchMB = 512;
    } else {
      // 720p HD
      batchSize = freeMB > 4000 ? 16 : 8;
      maxMemoryPerBatchMB = 256;
    }

    return {
      batchSize,
      targetResolution: { width: targetWidth, height: targetHeight },
      maxMemoryPerBatchMB,
      concurrencyLimit: this.maxConcurrency,
    };
  }

  public async executeChunk(task: ChunkExecutionTask): Promise<ChunkExecutionResult> {
    const tStart = Date.now();
    this.activeJobs++;
    this.status = "busy";

    try {
      if (!fs.existsSync(task.inputChunkPath)) {
        throw new Error(`Input chunk does not exist: ${task.inputChunkPath}`);
      }

      // Memory-safe execution using high-performance Lanczos filter with target dimensions
      await ffmpegService.processChunk(
        task.inputChunkPath,
        task.outputChunkPath,
        task.targetWidth,
        task.targetHeight,
        { perspective: task.perspective }
      );

      const elapsed = Date.now() - tStart;
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.status = this.activeJobs === 0 ? "ready" : "busy";

      return {
        taskId: task.taskId,
        chunkIndex: task.chunkIndex,
        outputChunkPath: task.outputChunkPath,
        executionTimeMs: elapsed,
        providerUsed: "cpu",
        success: true,
      };
    } catch (err: any) {
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.status = this.activeJobs === 0 ? "ready" : "busy";
      this.lastError = err.message;

      return {
        taskId: task.taskId,
        chunkIndex: task.chunkIndex,
        outputChunkPath: task.outputChunkPath,
        executionTimeMs: Date.now() - tStart,
        providerUsed: "cpu",
        success: false,
        error: err.message || "CPU chunk processing failed",
      };
    }
  }

  public async processChunk(task: ChunkExecutionTask): Promise<ChunkExecutionResult> {
    return this.executeChunk(task);
  }
}
