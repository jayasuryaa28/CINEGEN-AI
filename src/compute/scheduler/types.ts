import { ChunkExecutionTask, ChunkExecutionResult } from "../types";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface ScheduledTask {
  task: ChunkExecutionTask;
  priority: number; // 0 (low) to 10 (urgent)
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  submittedAt: number;
  startedAt?: number;
  completedAt?: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: ChunkExecutionResult;
  error?: string;
  resolve?: (res: ChunkExecutionResult) => void;
  reject?: (err: any) => void;
}

export interface SchedulerMetrics {
  activeWorkers: number;
  maxConcurrency: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  retriedTasks: number;
  averageChunkTimeMs: number;
}
