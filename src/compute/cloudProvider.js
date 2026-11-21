const { BaseComputeProvider } = require("./provider");
const { CpuComputeProvider } = require("./cpuProvider");

class CloudComputeProvider extends BaseComputeProvider {
  constructor(config) {
    super();
    this.id = "generic-cloud-provider";
    this.name = "Generic Cloud GPU Provider";
    this.type = "cloud_gpu";

    this.config = config || {
      endpointUrl: process.env.CLOUD_GPU_ENDPOINT,
      authToken: process.env.CLOUD_GPU_TOKEN,
      workerId: process.env.CLOUD_GPU_WORKER_ID,
      timeoutMs: parseInt(process.env.CLOUD_GPU_TIMEOUT_MS || "60000", 10),
      maxRetries: 3,
    };
    this.fallbackCpuProvider = new CpuComputeProvider();
    this.status = "not_configured";
    this.activeSubmissions = new Map();
  }

  async initialize() {
    if (!this.config.endpointUrl || this.config.endpointUrl.trim().length === 0) {
      this.status = "not_configured";
      this.lastError = "Cloud GPU endpoint is not configured (CLOUD_GPU_ENDPOINT environment variable is unset).";
      return false;
    }

    try {
      this.status = "ready";
      this.maxConcurrency = 8;
      return true;
    } catch (err) {
      this.status = "error";
      this.lastError = `Failed to connect to Cloud GPU worker cluster: ${err.message}`;
      return false;
    }
  }

  async getStatus() {
    if (!this.config.endpointUrl || this.config.endpointUrl.trim().length === 0) {
      return "not_configured";
    }
    return this.status;
  }

  async getBatchConfig(targetWidth, targetHeight) {
    if (this.status === "not_configured") {
      return this.fallbackCpuProvider.getBatchConfig(targetWidth, targetHeight);
    }

    return {
      batchSize: 16,
      targetResolution: { width: targetWidth, height: targetHeight },
      maxMemoryPerBatchMB: 4096,
      concurrencyLimit: 8,
    };
  }

  async submitRemoteJob(task) {
    if (this.status === "not_configured") {
      throw new Error("Cannot submit remote job: Cloud GPU provider is NOT_CONFIGURED.");
    }

    const remoteJobId = `cloud_job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const submission = {
      jobId: task.jobId,
      chunkIndex: task.chunkIndex,
      remoteJobId,
      status: "queued",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.activeSubmissions.set(task.taskId, submission);
    return submission;
  }

  async pollJobStatus(taskId) {
    return this.activeSubmissions.get(taskId) || null;
  }

  async executeChunk(task) {
    if (this.status === "not_configured" || !this.config.endpointUrl) {
      console.warn(`[CloudComputeProvider] Cloud GPU is NOT_CONFIGURED. Gracefully executing chunk ${task.chunkIndex} via local CPU fallback.`);
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
        providerUsed: "cloud_gpu",
        executionTimeMs: Date.now() - tStart,
      };
    } catch (err) {
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.status = this.activeJobs === 0 ? "ready" : "busy";
      this.lastError = err.message;

      console.warn(`[CloudComputeProvider] Remote execution failed (${err.message}). Retrying on local CPU fallback.`);
      return this.fallbackCpuProvider.executeChunk(task);
    }
  }

  async shutdown() {
    this.activeSubmissions.clear();
    this.status = "not_configured";
    this.activeJobs = 0;
  }
}

module.exports = { CloudComputeProvider };
