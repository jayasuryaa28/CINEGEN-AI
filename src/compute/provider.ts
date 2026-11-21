import {
  IComputeProvider,
  ComputeProviderType,
  ComputeProviderStatus,
  ComputeHealthStatus,
  HardwareInfo,
  BatchConfig,
  ChunkExecutionTask,
  ChunkExecutionResult,
} from "./types";
import { DeviceDetector } from "./deviceDetector";

export abstract class BaseComputeProvider implements IComputeProvider {
  public abstract readonly id: string;
  public abstract readonly name: string;
  public abstract readonly type: ComputeProviderType;

  protected status: ComputeProviderStatus = "ready";
  protected activeJobs = 0;
  protected maxConcurrency = 2;
  protected lastError?: string;

  public async getStatus(): Promise<ComputeProviderStatus> {
    return this.status;
  }

  public async getHardwareInfo(): Promise<HardwareInfo> {
    return DeviceDetector.detectHardware();
  }

  public async getHealth(): Promise<ComputeHealthStatus> {
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

  public abstract getBatchConfig(targetWidth: number, targetHeight: number): Promise<BatchConfig>;
  public abstract initialize(): Promise<boolean>;
  public abstract executeChunk(task: ChunkExecutionTask): Promise<ChunkExecutionResult>;

  public async shutdown(): Promise<void> {
    this.status = "unavailable";
    this.activeJobs = 0;
  }
}
