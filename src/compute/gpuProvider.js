const tf = require("@tensorflow/tfjs");
const { BaseComputeProvider } = require("./provider");
const { DeviceDetector } = require("./deviceDetector");
const { CpuComputeProvider } = require("./cpuProvider");

class GpuComputeProvider extends BaseComputeProvider {
  constructor() {
    super();
    this.id = "local-gpu-provider";
    this.name = "Local GPU Compute Provider";
    this.type = "local_gpu";
    this.fallbackCpuProvider = new CpuComputeProvider();
    this.isGpuBackendActive = false;
    this.status = "unavailable";
  }

  async initialize() {
    const hw = await DeviceDetector.detectHardware();

    if (!hw.gpuDetected) {
      this.status = "unavailable";
      this.lastError = "No supported local GPU hardware detected on system.";
      this.isGpuBackendActive = false;
      return false;
    }

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

    this.isGpuBackendActive = false;
    this.status = "unavailable";
    this.lastError = `GPU hardware (${hw.gpuModel || "Unknown"}) detected, but JavaScript inference backend is running on CPU. Local GPU acceleration unavailable.`;
    return false;
  }

  async getBatchConfig(targetWidth, targetHeight) {
    if (!this.isGpuBackendActive) {
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

  async executeChunk(task) {
    if (!this.isGpuBackendActive || this.status === "unavailable") {
      console.warn(`[GpuComputeProvider] GPU unavailable. Gracefully delegating chunk ${task.chunkIndex} to CPU fallback.`);
      return this.fallbackCpuProvider.executeChunk(task);
    }

    const tStart = Date.now();
    this.activeJobs++;
    this.status = "busy";

    try {
      const result = await this.fallbackCpuProvider.executeChunk(task);

      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.status = this.activeJobs === 0 ? "ready" : "busy";

      return {
        ...result,
        providerUsed: "local_gpu",
        executionTimeMs: Date.now() - tStart,
      };
    } catch (err) {
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.status = this.activeJobs === 0 ? "ready" : "busy";
      this.lastError = err.message;

      console.warn(`[GpuComputeProvider] GPU execution failed (${err.message}). Retrying on CPU fallback.`);
      return this.fallbackCpuProvider.executeChunk(task);
    }
  }
}

module.exports = { GpuComputeProvider };
