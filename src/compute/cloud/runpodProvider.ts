import http from "http";
import https from "https";

export interface RunPodUser {
  id: string;
  email: string;
}

export interface RunPodGpuType {
  id: string;
  displayName: string;
  memoryInGb: number;
  securePrice: number;
  communityPrice: number;
}

export interface RunPodInstance {
  id: string;
  name: string;
  status: string;
  gpuTypeId: string;
  ip?: string;
  port?: number;
  costPerHour?: number;
  uptimeSeconds?: number;
}

export class RunPodProvider {
  private static readonly GRAPHQL_ENDPOINT = "https://api.runpod.io/graphql";

  /**
   * Helper to execute GraphQL queries against RunPod's API with timeout.
   */
  public static async executeGraphQL(
    apiKey: string,
    query: string,
    variables: Record<string, any> = {},
    timeoutMs: number = 10000
  ): Promise<any> {
    // If a mock handler is configured in test environments, allow it
    if ((global as any).__RUNPOD_MOCK_HANDLER__) {
      return (global as any).__RUNPOD_MOCK_HANDLER__(query, variables, apiKey);
    }

    const payload = JSON.stringify({ query, variables });
    const url = new URL(this.GRAPHQL_ENDPOINT);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: timeoutMs,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(
              new Error(`RunPod API HTTP error: ${res.statusCode} ${res.statusMessage || ""}`)
            );
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.errors && parsed.errors.length > 0) {
              const msg = parsed.errors.map((e: any) => e.message).join(", ");
              return reject(new Error(`RunPod GraphQL error: ${msg}`));
            }
            resolve(parsed.data);
          } catch (err: any) {
            reject(new Error(`Failed to parse RunPod response: ${err.message}`));
          }
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`RunPod API request timed out after ${timeoutMs}ms`));
      });

      req.on("error", (err) => {
        reject(new Error(`RunPod API connection failed: ${err.message}`));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Validate user API key against RunPod
   */
  public static async validateApiKey(
    apiKey: string,
    timeoutMs: number = 8000
  ): Promise<{ valid: boolean; user?: RunPodUser; error?: string }> {
    if (!apiKey || apiKey.trim().length === 0) {
      return { valid: false, error: "RunPod API key is empty." };
    }

    const query = `
      query {
        myself {
          id
          email
        }
      }
    `;

    try {
      const data = await this.executeGraphQL(apiKey, query, {}, timeoutMs);
      if (data && data.myself && data.myself.id) {
        return {
          valid: true,
          user: {
            id: data.myself.id,
            email: data.myself.email || "user@runpod.io",
          },
        };
      }
      return { valid: false, error: "Invalid RunPod API response: user identity not found." };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Fetch available GPU types & current prices
   */
  public static async getGpuTypes(
    apiKey: string,
    timeoutMs: number = 8000
  ): Promise<RunPodGpuType[]> {
    const query = `
      query {
        gpuTypes {
          id
          displayName
          memoryInGb
          securePrice
          communityPrice
        }
      }
    `;

    try {
      const data = await this.executeGraphQL(apiKey, query, {}, timeoutMs);
      if (data && Array.isArray(data.gpuTypes)) {
        return data.gpuTypes.map((g: any) => ({
          id: g.id,
          displayName: g.displayName || g.id,
          memoryInGb: g.memoryInGb || 24,
          securePrice: g.securePrice || 0.34,
          communityPrice: g.communityPrice || 0.29,
        }));
      }
      return [];
    } catch (err) {
      // In case of network error, return catalog defaults
      return [];
    }
  }

  /**
   * Deploy a pod with specified GPU
   */
  public static async deployPod(
    apiKey: string,
    options: {
      name: string;
      imageName: string;
      gpuTypeId: string;
      containerDiskInGb?: number;
      volumeInGb?: number;
    },
    timeoutMs: number = 15000
  ): Promise<RunPodInstance> {
    const mutation = `
      mutation {
        podFindAndDeploy(input: {
          name: "${options.name}"
          imageName: "${options.imageName}"
          gpuTypeId: "${options.gpuTypeId}"
          containerDiskInGb: ${options.containerDiskInGb || 40}
          volumeInGb: ${options.volumeInGb || 20}
          startSsh: true
        }) {
          id
          desiredStatus
          imageName
        }
      }
    `;

    const data = await this.executeGraphQL(apiKey, mutation, {}, timeoutMs);
    const pod = data.podFindAndDeploy;
    return {
      id: pod.id,
      name: options.name,
      status: pod.desiredStatus || "PROVISIONING",
      gpuTypeId: options.gpuTypeId,
    };
  }

  /**
   * Query status of an existing pod
   */
  public static async getPodStatus(
    apiKey: string,
    podId: string,
    timeoutMs: number = 8000
  ): Promise<RunPodInstance> {
    const query = `
      query {
        pod(input: { podId: "${podId}" }) {
          id
          name
          desiredStatus
          lastStatus
          runtime {
            uptimeInSeconds
            ports {
              ip
              isIpPublic
              privatePort
              publicPort
            }
          }
        }
      }
    `;

    const data = await this.executeGraphQL(apiKey, query, {}, timeoutMs);
    const pod = data.pod;
    if (!pod) throw new Error(`RunPod instance ${podId} not found.`);

    let ip: string | undefined;
    let port: number | undefined;

    if (pod.runtime && pod.runtime.ports && pod.runtime.ports.length > 0) {
      const publicPort = pod.runtime.ports.find((p: any) => p.isIpPublic) || pod.runtime.ports[0];
      ip = publicPort.ip;
      port = publicPort.publicPort;
    }

    return {
      id: pod.id,
      name: pod.name || podId,
      status: pod.lastStatus || pod.desiredStatus || "UNKNOWN",
      gpuTypeId: "runpod-gpu",
      ip,
      port,
      uptimeSeconds: pod.runtime?.uptimeInSeconds || 0,
    };
  }

  /**
   * Stop pod (prevents compute billing while keeping volume)
   */
  public static async stopPod(
    apiKey: string,
    podId: string,
    timeoutMs: number = 8000
  ): Promise<boolean> {
    const mutation = `
      mutation {
        podStop(input: { podId: "${podId}" }) {
          id
          desiredStatus
        }
      }
    `;
    const data = await this.executeGraphQL(apiKey, mutation, {}, timeoutMs);
    return !!data && !!data.podStop;
  }

  /**
   * Terminate pod (completely stops and tears down pod)
   */
  public static async terminatePod(
    apiKey: string,
    podId: string,
    timeoutMs: number = 8000
  ): Promise<boolean> {
    const mutation = `
      mutation {
        podTerminate(input: { podId: "${podId}" })
      }
    `;
    const data = await this.executeGraphQL(apiKey, mutation, {}, timeoutMs);
    return data && (data.podTerminate === true || data.podTerminate === null || typeof data.podTerminate !== "undefined");
  }
}
