import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { videoPipeline } from "./pipeline";
import { jobRepository } from "./db";

export interface IJobQueue {
  addJob(jobId: string): Promise<void>;
}

/**
 * Robust Queue Adapter:
 * Attempts Redis connection; if Redis is unavailable in local environment,
 * automatically falls back to asynchronous in-process queue worker with full
 * error boundary and progress tracking.
 */
export class QueueManager implements IJobQueue {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private redisClient: Redis | null = null;
  private isFallbackMode: boolean = false;
  private fallbackQueue: string[] = [];
  private isProcessingFallback: boolean = false;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      const host = process.env.REDIS_HOST || "localhost";
      const port = parseInt(process.env.REDIS_PORT || "6379", 10);

      const client = new Redis({
        host,
        port,
        maxRetriesPerRequest: null,
        connectTimeout: 1500,
        retryStrategy: () => null, // Do not hang if Redis isn't running locally
      });

      client.on("error", () => {
        if (!this.isFallbackMode) {
          console.log("[QueueManager] Redis not detected locally. Seamlessly activating high-performance In-Memory Worker Queue.");
          this.isFallbackMode = true;
        }
      });

      client.on("connect", () => {
        console.log("[QueueManager] Connected to Redis. Initializing BullMQ worker.");
        this.redisClient = client;
        this.setupBullMQ();
      });
    } catch {
      this.isFallbackMode = true;
    }
  }

  private setupBullMQ() {
    if (!this.redisClient) return;

    this.queue = new Queue("cinegen-video-jobs", {
      connection: this.redisClient,
    });

    this.worker = new Worker(
      "cinegen-video-jobs",
      async (job) => {
        const { jobId } = job.data;
        await videoPipeline.processJob(jobId);
      },
      {
        connection: this.redisClient,
        concurrency: 1,
      }
    );

    this.worker.on("completed", (job) => {
      console.log(`[BullMQ] Job ${job.id} completed successfully.`);
    });

    this.worker.on("failed", (job, err) => {
      console.error(`[BullMQ] Job ${job?.id} failed:`, err);
    });
  }

  public async addJob(jobId: string): Promise<void> {
    if (this.queue && !this.isFallbackMode) {
      await this.queue.add("process-video", { jobId }, {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
      });
    } else {
      // High-performance asynchronous background execution
      this.fallbackQueue.push(jobId);
      this.processNextFallback();
    }
  }

  private async processNextFallback() {
    if (this.isProcessingFallback || this.fallbackQueue.length === 0) {
      return;
    }

    this.isProcessingFallback = true;
    const nextJobId = this.fallbackQueue.shift();

    if (nextJobId) {
      // Run asynchronously without blocking HTTP request thread
      setImmediate(async () => {
        try {
          await videoPipeline.processJob(nextJobId);
        } catch (err) {
          console.error(`[In-Memory Queue] Job ${nextJobId} processing error:`, err);
          await jobRepository.update(nextJobId, {
            status: "failed",
            error: (err as any).message || "Job failed in worker queue",
          });
        } finally {
          this.isProcessingFallback = false;
          this.processNextFallback();
        }
      });
    } else {
      this.isProcessingFallback = false;
    }
  }
}

export const queueManager = new QueueManager();
