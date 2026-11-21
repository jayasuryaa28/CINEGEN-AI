import http from "http";
import https from "https";
import { URL } from "url";
import { ChunkExecutionTask, ChunkExecutionResult } from "../types";
import { CpuComputeProvider } from "../cpuProvider";

export interface CloudExecutorConfig {
  endpointUrl?: string;
  authToken?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class CloudJobExecutor {
  private config: CloudExecutorConfig;
  private fallbackProvider: CpuComputeProvider;

  constructor(config?: CloudExecutorConfig) {
    this.config = config || {
      endpointUrl: process.env.CLOUD_WORKER_ENDPOINT,
      authToken: process.env.CLOUD_WORKER_TOKEN,
      timeoutMs: parseInt(process.env.CLOUD_WORKER_TIMEOUT_MS || "60000", 10),
      maxRetries: 2,
    };
    this.fallbackProvider = new CpuComputeProvider();
  }

  /**
   * Execute a chunk on cloud GPU worker, falling back to local CPU if cloud fails.
   */
  public async executeChunkWithFallback(
    task: ChunkExecutionTask
  ): Promise<ChunkExecutionResult> {
    const startTime = Date.now();

    // If cloud worker endpoint is not configured or mock mock-cloud-fail is set, fallback
    if (!this.config.endpointUrl || this.config.endpointUrl.trim().length === 0) {
      const res = await this.fallbackProvider.processChunk(task);
      return {
        ...res,
        metrics: {
          ...((res as any).metrics || {}),
          cloudFallback: true,
          fallbackReason: "Cloud worker endpoint unconfigured. Processed on local CPU.",
        },
      };
    }

    try {
      const result = await this.dispatchToRemoteWorker(task);
      return result;
    } catch (cloudErr: any) {
      console.warn(
        `[CloudJobExecutor] Remote cloud execution failed for chunk ${task.taskId || task.chunkIndex}: ${cloudErr.message}. Falling back to local CPU.`
      );
      const fallbackResult = await this.fallbackProvider.processChunk(task);
      return {
        ...fallbackResult,
        metrics: {
          ...((fallbackResult as any).metrics || {}),
          cloudFallback: true,
          fallbackReason: `Remote cloud failure: ${cloudErr.message}. Automatically recovered via local CPU.`,
        },
      };
    }
  }

  private async dispatchToRemoteWorker(
    task: ChunkExecutionTask
  ): Promise<ChunkExecutionResult> {
    // If test mock is defined
    if ((global as any).__CLOUD_WORKER_MOCK__) {
      return (global as any).__CLOUD_WORKER_MOCK__(task);
    }

    const targetUrl = new URL(this.config.endpointUrl!);
    const payload = JSON.stringify(task);

    return new Promise((resolve, reject) => {
      const isHttps = targetUrl.protocol === "https:";
      const client = isHttps ? https : http;

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname || "/process_chunk",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${this.config.authToken || ""}`,
        },
        timeout: this.config.timeoutMs || 60000,
      };

      const req = client.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(
              new Error(`Cloud worker responded with HTTP ${res.statusCode}: ${body.slice(0, 200)}`)
            );
          }
          try {
            const parsed = JSON.parse(body) as ChunkExecutionResult;
            resolve(parsed);
          } catch (err: any) {
            reject(new Error(`Failed to parse cloud worker response: ${err.message}`));
          }
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Cloud worker timed out after ${this.config.timeoutMs}ms`));
      });

      req.on("error", (err) => {
        reject(new Error(`Failed to connect to cloud worker: ${err.message}`));
      });

      req.write(payload);
      req.end();
    });
  }
}
