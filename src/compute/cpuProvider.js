const fs = require("fs");
const { spawn } = require("child_process");
const { BaseComputeProvider } = require("./provider");
const { DeviceDetector } = require("./deviceDetector");

class CpuComputeProvider extends BaseComputeProvider {
  constructor() {
    super();
    this.id = "local-cpu-provider";
    this.name = "Local CPU Compute Provider";
    this.type = "cpu";
    this.maxConcurrency = 2;
  }

  async initialize() {
    const hw = await DeviceDetector.detectHardware();
    if (!hw.ffmpegAvailable) {
      this.status = "error";
      this.lastError = "FFmpeg is not installed or accessible in local environment.";
      return false;
    }

    this.maxConcurrency = Math.max(1, Math.min(4, Math.floor(hw.cpuCores / 2)));
    this.status = "ready";
    return true;
  }

  async getBatchConfig(targetWidth, targetHeight) {
    const hw = await DeviceDetector.detectHardware();
    const freeMB = hw.freeMemoryMB;
    const pixels = targetWidth * targetHeight;

    let batchSize = 4;
    let maxMemoryPerBatchMB = 512;

    if (pixels >= 3840 * 2160) {
      batchSize = freeMB > 4000 ? 2 : 1;
      maxMemoryPerBatchMB = 1024;
    } else if (pixels >= 2560 * 1440) {
      batchSize = freeMB > 4000 ? 4 : 2;
      maxMemoryPerBatchMB = 768;
    } else if (pixels >= 1920 * 1080) {
      batchSize = freeMB > 4000 ? 8 : 4;
      maxMemoryPerBatchMB = 512;
    } else {
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

  async executeChunk(task) {
    const tStart = Date.now();
    this.activeJobs++;
    this.status = "busy";

    try {
      if (!fs.existsSync(task.inputChunkPath)) {
        throw new Error(`Input chunk does not exist: ${task.inputChunkPath}`);
      }

      await this.runFfmpegProcessChunk(
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
    } catch (err) {
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

  runFfmpegProcessChunk(inputPath, outputPath, targetWidth, targetHeight, options = {}) {
    return new Promise((resolve, reject) => {
      const filterParts = [];
      if (options.perspective && options.perspective.enabled && options.perspective.filterString) {
        filterParts.push(options.perspective.filterString);
      }
      filterParts.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos`);
      filterParts.push(`unsharp=5:5:0.5:5:5:0.0`);
      filterParts.push(`fps=fps=24`);
      const filter = filterParts.join(",");

      const args = [
        "-y",
        "-i", inputPath,
        "-vf", filter,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-an",
        outputPath,
      ];

      const proc = spawn("ffmpeg", args);
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => {
        if (code === 0) resolve(outputPath);
        else reject(new Error(`FFmpeg chunk processing failed (code ${code}): ${stderr}`));
      });
    });
  }

  async processChunk(task) {
    return this.executeChunk(task);
  }
}

module.exports = { CpuComputeProvider };
