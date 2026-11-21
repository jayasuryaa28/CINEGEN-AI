const { computeRegistry } = require("../providerRegistry");

class JobScheduler {
  constructor(maxConcurrency = 2) {
    this.queue = [];
    this.activeTasks = new Map();
    this.cancelledJobIds = new Set();
    this.pausedJobIds = new Set();

    this.maxConcurrency = maxConcurrency;
    this.defaultTimeoutMs = 120000;
    this.maxRetries = 3;

    this.completedCount = 0;
    this.failedCount = 0;
    this.retriedCount = 0;
    this.totalChunkTimeMs = 0;
  }

  setMaxConcurrency(concurrency) {
    this.maxConcurrency = Math.max(1, concurrency);
  }

  priorityToNumber(priority) {
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

  async scheduleChunk(task, priority = "normal", timeoutMs = this.defaultTimeoutMs) {
    const scheduled = {
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
          this.queue.push(scheduled);
          this.queue.sort((a, b) => b.priority - a.priority || a.submittedAt - b.submittedAt);
        }
      };

      executeOrQueue();
    });
  }

  async runTask(scheduled, resolve, reject) {
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
      const result = await this.executeWithTimeout(provider, scheduled.task, scheduled.timeoutMs);

      if (!result.success) {
        throw new Error(result.error || "Chunk execution failed");
      }

      scheduled.status = "completed";
      scheduled.completedAt = Date.now();
      scheduled.result = result;

      this.completedCount++;
      const duration = scheduled.completedAt - scheduled.startedAt;
      this.totalChunkTimeMs += duration;

      this.activeTasks.delete(taskId);
      this.dispatchNext();
      resolve(result);
    } catch (err) {
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

  async executeWithTimeout(provider, task, timeoutMs) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Chunk execution timed out after ${timeoutMs}ms on provider ${provider.name}`));
      }, timeoutMs);
    });

    try {
      const execPromise = provider.executeChunk(task);
      const result = await Promise.race([execPromise, timeoutPromise]);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  dispatchNext() {
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

  cancelJob(jobId) {
    this.cancelledJobIds.add(jobId);
    const remaining = [];
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

  pauseJob(jobId) {
    this.pausedJobIds.add(jobId);
  }

  resumeJob(jobId) {
    this.pausedJobIds.delete(jobId);
    this.cancelledJobIds.delete(jobId);
    this.dispatchNext();
  }

  getMetrics() {
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

  checkDiskSpace(targetPath = "./", minFreeGb = 2.0) {
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
    } catch {}
    return { hasSpace: true, freeGb: 999.0 };
  }

  reset() {
    this.queue = [];
    this.activeTasks.clear();
    this.cancelledJobIds.clear();
    this.pausedJobIds.clear();
  }
}

const jobScheduler = new JobScheduler();

module.exports = {
  JobScheduler,
  jobScheduler,
};
