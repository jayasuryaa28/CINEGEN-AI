const http = require("http");
const https = require("https");
const { URL } = require("url");
const { CpuComputeProvider } = require("../cpuProvider");

class CloudJobExecutor {
  constructor(config) {
    this.config = config || {
      endpointUrl: process.env.CLOUD_WORKER_ENDPOINT,
      authToken: process.env.CLOUD_WORKER_TOKEN,
      timeoutMs: parseInt(process.env.CLOUD_WORKER_TIMEOUT_MS || "60000", 10),
      maxRetries: 2,
    };
    this.fallbackProvider = new CpuComputeProvider();
  }

  async executeChunkWithFallback(task) {
    if (!this.config.endpointUrl || this.config.endpointUrl.trim().length === 0) {
      const res = await this.fallbackProvider.processChunk(task);
      return {
        ...res,
        metrics: {
          ...(res.metrics || {}),
          cloudFallback: true,
          fallbackReason: "Cloud worker endpoint unconfigured. Processed on local CPU.",
        },
      };
    }

    try {
      const result = await this.dispatchToRemoteWorker(task);
      return result;
    } catch (cloudErr) {
      console.warn(
        `[CloudJobExecutor] Remote cloud execution failed for chunk ${task.taskId || task.chunkIndex}: ${cloudErr.message}. Falling back to local CPU.`
      );
      const fallbackResult = await this.fallbackProvider.processChunk(task);
      return {
        ...fallbackResult,
        metrics: {
          ...(fallbackResult.metrics || {}),
          cloudFallback: true,
          fallbackReason: `Remote cloud failure: ${cloudErr.message}. Automatically recovered via local CPU.`,
        },
      };
    }
  }

  async dispatchToRemoteWorker(task) {
    if (global.__CLOUD_WORKER_MOCK__) {
      return global.__CLOUD_WORKER_MOCK__(task);
    }

    const targetUrl = new URL(this.config.endpointUrl);
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
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (err) {
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

module.exports = { CloudJobExecutor };
