import { BaseComputeProvider } from "../provider";
import {
  ComputeProviderType,
  BatchConfig,
  ChunkExecutionTask,
  ChunkExecutionResult,
} from "../types";
import { CpuComputeProvider } from "../cpuProvider";
import { HardwareDetector, HardwareProfile } from "./hardwareDetector";
import { LocalCapabilityAdvisor, CapabilityAdvice } from "./localCapabilityAdvisor";
import { LocalResourceManager } from "./localResourceManager";

export class LocalComputeProvider extends BaseComputeProvider {
  public readonly id = "local-own-pc";
  public readonly name = "Own PC Compute Provider";
  public readonly type: ComputeProviderType = "cpu";

  private underlyingCpuProvider: CpuComputeProvider;
  private cachedProfile?: HardwareProfile;
  private cachedAdvice?: CapabilityAdvice;

  constructor() {
    super();
    this.underlyingCpuProvider = new CpuComputeProvider();
    this.maxConcurrency = 1;
  }

  public async initialize(): Promise<boolean> {
    const success = await this.underlyingCpuProvider.initialize();
    if (!success) {
      this.status = await this.underlyingCpuProvider.getStatus();
      this.lastError = (this.underlyingCpuProvider as any).lastError;
      return false;
    }

    this.cachedProfile = await HardwareDetector.detect();
    this.cachedAdvice = LocalCapabilityAdvisor.evaluate(this.cachedProfile);
    this.maxConcurrency = this.cachedAdvice.recommendedConcurrency;
    this.status = "ready";
    return true;
  }

  public async getBatchConfig(targetWidth: number, targetHeight: number): Promise<BatchConfig> {
    const baseConfig = await this.underlyingCpuProvider.getBatchConfig(targetWidth, targetHeight);
    const dynamicBatch = LocalResourceManager.getDynamicBatchSize(baseConfig.batchSize);
    return {
      ...baseConfig,
      batchSize: dynamicBatch,
    };
  }

  public async processChunk(task: ChunkExecutionTask): Promise<ChunkExecutionResult> {
    const safety = LocalResourceManager.checkMemorySafety();
    if (!safety.isSafe) {
      console.warn(`[LocalComputeProvider] Warning: Low free memory (${safety.freeRamGb} GB). Running chunk ${task.taskId || task.chunkIndex} in conservative mode.`);
    }

    const result = await this.underlyingCpuProvider.processChunk(task);
    return {
      ...result,
      metrics: {
        ...((result as any).metrics || {}),
        localCompute: true,
        freeRamGb: safety.freeRamGb,
      },
    };
  }

  public async executeChunk(task: ChunkExecutionTask): Promise<ChunkExecutionResult> {
    return this.processChunk(task);
  }

  public async getHardwareProfile(): Promise<HardwareProfile> {
    if (!this.cachedProfile) {
      this.cachedProfile = await HardwareDetector.detect();
    }
    return this.cachedProfile;
  }

  public async getCapabilityAdvice(): Promise<CapabilityAdvice> {
    if (!this.cachedAdvice) {
      const profile = await this.getHardwareProfile();
      this.cachedAdvice = LocalCapabilityAdvisor.evaluate(profile);
    }
    return this.cachedAdvice;
  }
}
