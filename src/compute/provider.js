const { DeviceDetector } = require("./deviceDetector");

class BaseComputeProvider {
  constructor() {
    this.status = "ready";
    this.activeJobs = 0;
    this.maxConcurrency = 2;
    this.lastError = undefined;
  }

  async getStatus() {
    return this.status;
  }

  async getHardwareInfo() {
    return DeviceDetector.detectHardware();
  }

  async getHealth() {
    const mem = process.memoryUsage();
    return {
      providerId: this.id,
      providerType: this.type,
      status: this.status,
      isAvailable: this.status === "ready" || this.status === "busy",
      activeJobs: this.activeJobs,
      maxConcurrency: this.maxConcurrency,
      memoryUsageMB: {
        heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
        rss: Math.round(mem.rss / (1024 * 1024)),
      },
      lastHealthCheck: new Date().toISOString(),
      errorMessage: this.lastError,
    };
  }

  async shutdown() {
    this.status = "unavailable";
    this.activeJobs = 0;
  }
}

module.exports = { BaseComputeProvider };
