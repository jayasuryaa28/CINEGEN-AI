/**
 * CINEGEN AI — Compute Provider System Interfaces & Types
 *
 * Defines the vendor-independent execution contract for:
 * 1. CPU Execution (Default local fallback)
 * 2. Local GPU Execution (Genuinely supported local hardware acceleration)
 * 3. Cloud GPU Execution (Remote worker orchestration)
 */

export type ComputeProviderType = "cpu" | "local_gpu" | "cloud_gpu";

export type ComputeProviderStatus =
  | "ready"
  | "busy"
  | "unavailable"
  | "not_configured"
  | "error";

export interface HardwareInfo {
  os: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  gpuDetected: boolean;
  gpuModel?: string;
  gpuVramMB?: number;
  inferenceBackend: string;
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
}

export interface ComputeHealthStatus {
  providerId: string;
  providerType: ComputeProviderType;
  status: ComputeProviderStatus;
  isAvailable: boolean;
  activeJobs: number;
  maxConcurrency: number;
  memoryUsageMB: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  lastHealthCheck: string;
  details?: Record<string, any>;
  errorMessage?: string;
}

export interface BatchConfig {
  batchSize: number;
  targetResolution: { width: number; height: number };
  maxMemoryPerBatchMB: number;
  concurrencyLimit: number;
}

export interface ChunkExecutionTask {
  taskId: string;
  jobId: string;
  chunkIndex: number;
  totalChunks: number;
  inputChunkPath: string;
  outputChunkPath: string;
  targetWidth: number;
  targetHeight: number;
  quality: string;
  fps: number;
  durationSec: number;
  perspective?: {
    enabled: boolean;
    filterString?: string;
    corners?: [number, number][];
    interpolation?: "cubic" | "linear";
    confidence?: number;
    reason?: string;
  };
}

export interface ChunkExecutionResult {
  taskId: string;
  chunkIndex: number;
  outputChunkPath: string;
  executionTimeMs: number;
  providerUsed: ComputeProviderType;
  success: boolean;
  error?: string;
  metrics?: Record<string, any>;
}

export interface IComputeProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ComputeProviderType;

  getStatus(): Promise<ComputeProviderStatus>;
  getHealth(): Promise<ComputeHealthStatus>;
  getHardwareInfo(): Promise<HardwareInfo>;
  getBatchConfig(targetWidth: number, targetHeight: number): Promise<BatchConfig>;

  initialize(): Promise<boolean>;
  executeChunk(task: ChunkExecutionTask): Promise<ChunkExecutionResult>;
  shutdown(): Promise<void>;
}

export interface RemoteCloudWorkerConfig {
  endpointUrl?: string;
  authToken?: string;
  workerId?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface CloudJobSubmission {
  jobId: string;
  chunkIndex: number;
  remoteJobId: string;
  status: "queued" | "running" | "completed" | "failed";
  submittedAt: string;
  updatedAt: string;
  resultUrl?: string;
  error?: string;
}

export type UserComputeMode = "own_pc" | "cloud_gpu";

export interface ComputeSettingsConfig {
  activeMode: UserComputeMode;
  preferredCloudProvider?: "runpod" | "vast";
  preferredGpuId?: string;
  maxLocalConcurrency?: number;
  memorySafetyLimitGb?: number;
  updatedAt: string;
}

