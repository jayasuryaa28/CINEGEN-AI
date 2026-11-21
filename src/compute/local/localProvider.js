const { BaseComputeProvider } = require("../provider");
const { CpuComputeProvider } = require("../cpuProvider");
const { HardwareDetector } = require("./hardwareDetector");
const { LocalCapabilityAdvisor } = require("./localCapabilityAdvisor");
const { LocalResourceManager } = require("./localResourceManager");

class LocalComputeProvider extends BaseComputeProvider {
  constructor() {
    super();
    this.id = "local-own-pc";
    this.name = "Own PC Compute Provider";
    this.type = "cpu";
    this.underlyingCpuProvider = new CpuComputeProvider();
    this.maxConcurrency = 1;
  }

  async initialize() {
    const success = await this.underlyingCpuProvider.initialize();
    if (!success) {
      this.status = this.underlyingCpuProvider.getStatus();
      this.lastError = this.underlyingCpuProvider.getLastError();
      return false;
    }

    this.cachedProfile = await HardwareDetector.detect();
    this.cachedAdvice = LocalCapabilityAdvisor.evaluate(this.cachedProfile);
    this.maxConcurrency = this.cachedAdvice.recommendedConcurrency;
    this.status = "ready";
    return true;
  }

  async getBatchConfig(targetWidth, targetHeight) {
    const baseConfig = await this.underlyingCpuProvider.getBatchConfig(targetWidth, targetHeight);
    const dynamicBatch = LocalResourceManager.getDynamicBatchSize(baseConfig.batchSize);
    return {
      ...baseConfig,
      batchSize: dynamicBatch,
    };
  }

  async processChunk(task) {
    const safety = LocalResourceManager.checkMemorySafety();
    if (!safety.isSafe) {
      console.warn(`[LocalComputeProvider] Warning: Low free memory (${safety.freeRamGb} GB). Running chunk ${task.chunkId} in conservative mode.`);
    }

    const result = await this.underlyingCpuProvider.processChunk(task);
    return {
      ...result,
      metrics: {
        ...(result.metrics || {}),
        localCompute: true,
        freeRamGb: safety.freeRamGb,
      },
    };
  }

  async executeChunk(task) {
    return this.processChunk(task);
  }

  async getHardwareProfile() {
    if (!this.cachedProfile) {
      this.cachedProfile = await HardwareDetector.detect();
    }
    return this.cachedProfile;
  }

  async getCapabilityAdvice() {
    if (!this.cachedAdvice) {
      const profile = await this.getHardwareProfile();
      this.cachedAdvice = LocalCapabilityAdvisor.evaluate(profile);
    }
    return this.cachedAdvice;
  }
}

module.exports = { LocalComputeProvider };
