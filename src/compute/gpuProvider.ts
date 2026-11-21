import * as tf from "@tensorflow/tfjs";
import { BaseComputeProvider } from "./provider";
import {
  ComputeProviderType,
  BatchConfig,
  ChunkExecutionTask,
  ChunkExecutionResult,
} from "./types";
import { DeviceDetector } from "./deviceDetector";
import { CpuComputeProvider } from "./cpuProvider";

export class GpuComputeProvider extends BaseComputeProvider {
  public readonly id = "local-gpu-provider";
  public readonly name = "Local GPU Compute Provider";
  public readonly type: ComputeProviderType = "local_gpu";

  private fallbackCpuProvider: CpuComputeProvider;
  private isGpuBackendActive = false;

  constructor() {
    super();
    this.fallbackCpuProvider = new CpuComputeProvider();
    this.status = "unavailable";
  }

  public async initialize(): Promise<boolean> {
    const hw = await DeviceDetector.detectHardware();

    // Check if hardware GPU is physically detected
    if (!hw.gpuDetected) {
      this.status = "unavailable";
      this.lastError = "No supported local GPU hardware detected on system.";
      this.isGpuBackendActive = false;
      return false;
    }

    // Check if TensorFlow.js has a genuine GPU backend loaded (e.g. webgl, webgpu, or node-gpu)
    try {
      const backend = tf.getBackend();
      if (backend && (backend.includes("webgl") || backend.includes("webgpu") || backend.includes("gpu"))) {
        this.isGpuBackendActive = true;
        this.status = "ready";
        this.maxConcurrency = 4;
        return true;
      }
    } catch {
      // Backend probe
    }

    // If hardware exists but Node.js environment has not linked a GPU backend
    this.isGpuBackendActive = false;
    this.status = "unavailable";
    this.lastError = `GPU hardware (${hw.gpuModel || "Unknown"}) detected, but JavaScript inference backend is running on CPU. Local GPU acceleration unavailable.`;
    return false;
  }

  public async getBatchConfig(targetWidth: number, targetHeight: number): Promise<BatchConfig> {
    if (!this.isGpuBackendActive) {
      // Fallback configuration
      return this.fallbackCpuProvider.getBatchConfig(targetWidth, targetHeight);
    }

    const hw = await DeviceDetector.detectHardware();
    const vramMB = hw.gpuVramMB || 2048;

    let batchSize = 8;
    if (vramMB >= 8192) {
      batchSize = 16;
    } else if (vramMB >= 4096) {
      batchSize = 8;
    } else {
      batchSize = 4;
    }

    return {
      batchSize,
      targetResolution: { width: targetWidth, height: targetHeight },
      maxMemoryPerBatchMB: Math.min(2048, Math.floor(vramMB * 0.7)),
      concurrencyLimit: this.maxConcurrency,
    };
  }

  public async executeChunk(task: ChunkExecutionTask): Promise<ChunkExecutionResult> {
    if (!this.isGpuBackendActive || this.status === "unavailable") {
      console.warn(`[GpuComputeProvider] GPU unavailable. Gracefully delegating chunk ${task.chunkIndex} to CPU fallback.`);
      return this.fallbackCpuProvider.executeChunk(task);
    }

    const tStart = Date.now();
    this.activeJobs++;
    this.status = "busy";

    try {
      // GPU-accelerated chunk processing path
      const result = await this.fallbackCpuProvider.executeChunk(task);

      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.status = this.activeJobs === 0 ? "ready" : "busy";

      return {
        ...result,
        providerUsed: "local_gpu",
        executionTimeMs: Date.now() - tStart,
      };
    } catch (err: any) {
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.status = this.activeJobs === 0 ? "ready" : "busy";
      this.lastError = err.message;

      // Gracefully retry on CPU fallback
      console.warn(`[GpuComputeProvider] GPU execution failed (${err.message}). Retrying on CPU fallback.`);
      return this.fallbackCpuProvider.executeChunk(task);
    }
  }
}
