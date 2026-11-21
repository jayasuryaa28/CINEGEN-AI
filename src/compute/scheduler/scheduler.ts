import {
  ChunkExecutionTask,
  ChunkExecutionResult,
  IComputeProvider,
} from "../types";
import { computeRegistry } from "../providerRegistry";
import { ScheduledTask, TaskPriority, SchedulerMetrics } from "./types";

export class JobScheduler {
  private queue: ScheduledTask[] = [];
  private activeTasks: Map<string, ScheduledTask> = new Map();
  private cancelledJobIds: Set<string> = new Set();
  private pausedJobIds: Set<string> = new Set();

  private maxConcurrency = 2;
  private defaultTimeoutMs = 120000; // 2 minutes per chunk
  private maxRetries = 3;

  private completedCount = 0;
  private failedCount = 0;
  private retriedCount = 0;
  private totalChunkTimeMs = 0;

  constructor(maxConcurrency = 2) {
    this.maxConcurrency = maxConcurrency;
  }

  public setMaxConcurrency(concurrency: number) {
    this.maxConcurrency = Math.max(1, concurrency);
  }

  private priorityToNumber(priority: TaskPriority): number {
    switch (priority) {
      case "urgent":
        return 10;
      case "high":
        return 7;
      case "normal":
        return 5;
      case "low":
        return 1;
      default:
        return 5;
    }
  }

  /**
   * Submit a chunk task to the scheduler
   */
  public async scheduleChunk(
    task: ChunkExecutionTask,
    priority: TaskPriority = "normal",
    timeoutMs = this.defaultTimeoutMs
  ): Promise<ChunkExecutionResult> {
    const scheduled: ScheduledTask = {
      task,
      priority: this.priorityToNumber(priority),
      retryCount: 0,
      maxRetries: this.maxRetries,
      timeoutMs,
      submittedAt: Date.now(),
      status: "queued",
    };

    return new Promise((resolve, reject) => {
      scheduled.resolve = resolve;
      scheduled.reject = reject;

      const executeOrQueue = async () => {
        if (this.cancelledJobIds.has(task.jobId)) {
          scheduled.status = "cancelled";
          return reject(new Error(`Job ${task.jobId} was cancelled`));
        }

        if (this.activeTasks.size < this.maxConcurrency) {
          this.runTask(scheduled, resolve, reject);
        } else {
          // Push to priority queue and sort descending by priority
          this.queue.push(scheduled);
          this.queue.sort((a, b) => b.priority - a.priority || a.submittedAt - b.submittedAt);
        }
      };

      executeOrQueue();
    });
  }

  private async runTask(
    scheduled: ScheduledTask,
    resolve: (res: ChunkExecutionResult) => void,
    reject: (err: any) => void
  ) {
    const taskId = scheduled.task.taskId;
    const jobId = scheduled.task.jobId;

    if (this.cancelledJobIds.has(jobId)) {
      scheduled.status = "cancelled";
      this.dispatchNext();
      return reject(new Error(`Task ${taskId} cancelled for job ${jobId}`));
    }

    if (this.pausedJobIds.has(jobId)) {
      scheduled.status = "queued";
      this.queue.unshift(scheduled);
      return reject(new Error(`Task ${taskId} paused for job ${jobId}`));
    }

    this.activeTasks.set(taskId, scheduled);
    scheduled.status = "running";
    scheduled.startedAt = Date.now();

    try {
      const provider = await computeRegistry.resolveOptimalProvider();

      // Wrap execution in timeout race
      const result = await this.executeWithTimeout(provider, scheduled.task, scheduled.timeoutMs);

      if (!result.success) {
        throw new Error(result.error || "Chunk execution failed");
      }

      scheduled.status = "completed";
      scheduled.completedAt = Date.now();
      scheduled.result = result;

      this.completedCount++;
      const duration = scheduled.completedAt - scheduled.startedAt!;
      this.totalChunkTimeMs += duration;

      this.activeTasks.delete(taskId);
      this.dispatchNext();
      resolve(result);
    } catch (err: any) {
      if (scheduled.retryCount < scheduled.maxRetries && !this.cancelledJobIds.has(jobId)) {
        scheduled.retryCount++;
        this.retriedCount++;
        const backoffMs = Math.min(10000, 1000 * Math.pow(2, scheduled.retryCount));
        console.warn(`[JobScheduler] Task ${taskId} failed (${err.message}). Retrying attempt ${scheduled.retryCount}/${scheduled.maxRetries} after ${backoffMs}ms...`);

        this.activeTasks.delete(taskId);

        setTimeout(() => {
          this.runTask(scheduled, resolve, reject);
        }, backoffMs);
      } else {
        scheduled.status = "failed";
        scheduled.error = err.message;
        this.failedCount++;
        this.activeTasks.delete(taskId);
        this.dispatchNext();
        reject(err);
      }
    }
  }

  private async executeWithTimeout(
    provider: IComputeProvider,
    task: ChunkExecutionTask,
    timeoutMs: number
  ): Promise<ChunkExecutionResult> {
    let timer: NodeJS.Timeout;

    const timeoutPromise = new Promise<ChunkExecutionResult>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Chunk execution timed out after ${timeoutMs}ms on provider ${provider.name}`));
      }, timeoutMs);
    });

    try {
      const execPromise = provider.executeChunk(task);
      const result = await Promise.race([execPromise, timeoutPromise]);
      clearTimeout(timer!);
      return result;
    } catch (err) {
      clearTimeout(timer!);
      throw err;
    }
  }

  private dispatchNext() {
    if (this.queue.length === 0 || this.activeTasks.size >= this.maxConcurrency) {
      return;
    }

    const index = this.queue.findIndex((t) => !this.pausedJobIds.has(t.task.jobId));
    if (index === -1) return;

    const [nextTask] = this.queue.splice(index, 1);
    if (nextTask && nextTask.resolve && nextTask.reject) {
      this.runTask(nextTask, nextTask.resolve, nextTask.reject);
    }
  }

  public cancelJob(jobId: string) {
    this.cancelledJobIds.add(jobId);
    const remaining: ScheduledTask[] = [];
    for (const t of this.queue) {
      if (t.task.jobId === jobId) {
        t.status = "cancelled";
        if (t.reject) t.reject(new Error(`Job ${jobId} was cancelled`));
      } else {
        remaining.push(t);
      }
    }
    this.queue = remaining;
  }

  public pauseJob(jobId: string) {
    this.pausedJobIds.add(jobId);
    // Keep queued chunks intact so they can resume
  }

  public resumeJob(jobId: string) {
    this.pausedJobIds.delete(jobId);
    this.cancelledJobIds.delete(jobId);
    this.dispatchNext();
  }

  public getMetrics(): SchedulerMetrics {
    const avg = this.completedCount > 0 ? Math.round(this.totalChunkTimeMs / this.completedCount) : 0;
    return {
      activeWorkers: this.activeTasks.size,
      maxConcurrency: this.maxConcurrency,
      queuedTasks: this.queue.length,
      completedTasks: this.completedCount,
      failedTasks: this.failedCount,
      retriedTasks: this.retriedCount,
      averageChunkTimeMs: avg,
    };
  }

  public checkDiskSpace(targetPath = "./", minFreeGb = 2.0): { hasSpace: boolean; freeGb: number } {
    try {
      const fs = require("fs");
      if (typeof fs.statfsSync === "function") {
        const stat = fs.statfsSync(targetPath);
        const freeGb = (stat.bsize * stat.bfree) / (1024 ** 3);
        return {
          hasSpace: freeGb >= minFreeGb,
          freeGb: parseFloat(freeGb.toFixed(2)),
        };
      }
    } catch {
      // Fallback
    }
    return { hasSpace: true, freeGb: 999.0 };
  }

  public reset() {
    this.queue = [];
    this.activeTasks.clear();
    this.cancelledJobIds.clear();
    this.pausedJobIds.clear();
  }
}

export const jobScheduler = new JobScheduler();
