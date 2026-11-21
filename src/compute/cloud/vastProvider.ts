import https from "https";
import { URL } from "url";

export interface VastUser {
  id: number | string;
  email: string;
  balance?: number;
}

export interface VastOffer {
  id: number;
  gpuName: string;
  numGpus: number;
  gpuRamMb: number;
  dphTotal: number; // dollars per hour
  cudaVers: number;
  dlperf: number;
  reliability: number;
}

export interface VastInstance {
  id: string;
  status: string;
  actualStatus?: string;
  gpuName?: string;
  sshHost?: string;
  sshPort?: number;
  costPerHour?: number;
  uptimeSeconds?: number;
}

export class VastProvider {
  private static readonly API_BASE = "https://console.vast.ai/api/v0";

  /**
   * Helper to execute HTTPS REST requests against Vast.ai API with timeout.
   */
  public static async executeRest(
    apiKey: string,
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: any,
    timeoutMs: number = 10000
  ): Promise<any> {
    if ((global as any).__VAST_MOCK_HANDLER__) {
      return (global as any).__VAST_MOCK_HANDLER__(endpoint, method, body, apiKey);
    }

    const fullUrl = `${this.API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const url = new URL(fullUrl);
    const payload = body ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      };

      if (payload) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(payload).toString();
      }

      const options = {
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        timeout: timeoutMs,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode === 401) {
            return reject(new Error("Vast.ai API authentication failed: 401 Unauthorized"));
          }
          if (res.statusCode && res.statusCode === 403) {
            return reject(new Error("Vast.ai API permission denied: 403 Forbidden"));
          }
          if (res.statusCode && res.statusCode >= 400) {
            return reject(
              new Error(`Vast.ai API error: ${res.statusCode} ${res.statusMessage || ""}`)
            );
          }
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve(parsed);
          } catch (err: any) {
            reject(new Error(`Failed to parse Vast.ai response: ${err.message}`));
          }
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Vast.ai API request timed out after ${timeoutMs}ms`));
      });

      req.on("error", (err) => {
        reject(new Error(`Vast.ai API connection failed: ${err.message}`));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Validate Vast.ai API key by fetching current user account profile
   */
  public static async validateApiKey(
    apiKey: string,
    timeoutMs: number = 8000
  ): Promise<{ valid: boolean; user?: VastUser; error?: string }> {
    if (!apiKey || apiKey.trim().length === 0) {
      return { valid: false, error: "Vast.ai API key is empty." };
    }

    try {
      const data = await this.executeRest(apiKey, "/users/current", "GET", undefined, timeoutMs);
      if (data && (data.id || data.email || data.username)) {
        return {
          valid: true,
          user: {
            id: data.id || "vast-user",
            email: data.email || "user@vast.ai",
            balance: data.balance || 0,
          },
        };
      }
      return { valid: false, error: "Invalid Vast.ai API response: user identity not found." };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Query available GPU bundles / offers from Vast.ai
   */
  public static async getOffers(
    apiKey: string,
    filters?: { minGpuRamGb?: number; maxPriceHourly?: number },
    timeoutMs: number = 8000
  ): Promise<VastOffer[]> {
    try {
      const queryParams = new URLSearchParams();
      if (filters?.minGpuRamGb) {
        queryParams.set("gpu_ram", (filters.minGpuRamGb * 1024).toString());
      }
      const data = await this.executeRest(
        apiKey,
        `/bundles/?${queryParams.toString()}`,
        "GET",
        undefined,
        timeoutMs
      );

      if (data && Array.isArray(data.offers)) {
        return data.offers.map((o: any) => ({
          id: o.id,
          gpuName: o.gpu_name,
          numGpus: o.num_gpus || 1,
          gpuRamMb: o.gpu_ram || 24000,
          dphTotal: o.dph_total || 0.25,
          cudaVers: o.cuda_vers || 12.0,
          dlperf: o.dlperf || 0,
          reliability: o.reliability || 0.99,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Create an instance on Vast.ai from an offer ask
   */
  public static async createInstance(
    apiKey: string,
    offerId: number | string,
    options: { image: string; diskGb?: number },
    timeoutMs: number = 15000
  ): Promise<VastInstance> {
    const body = {
      client_id: "me",
      image: options.image,
      disk: options.diskGb || 40,
      runtype: "ssh",
    };

    const data = await this.executeRest(
      apiKey,
      `/asks/${offerId}/`,
      "PUT",
      body,
      timeoutMs
    );

    const instanceId = (data.new_contract || data.id || offerId).toString();
    return {
      id: instanceId,
      status: "provisioning",
      actualStatus: "loading",
      costPerHour: data.dph_total || 0.25,
    };
  }

  /**
   * Query instance status on Vast.ai
   */
  public static async getInstanceStatus(
    apiKey: string,
    instanceId: string | number,
    timeoutMs: number = 8000
  ): Promise<VastInstance> {
    const data = await this.executeRest(
      apiKey,
      `/instances/${instanceId}/`,
      "GET",
      undefined,
      timeoutMs
    );

    const inst = data.instances ? data.instances[0] : data;
    if (!inst) throw new Error(`Vast.ai instance ${instanceId} not found.`);

    return {
      id: instanceId.toString(),
      status: inst.actual_status || inst.status || "unknown",
      actualStatus: inst.actual_status,
      gpuName: inst.gpu_name,
      sshHost: inst.ssh_host,
      sshPort: inst.ssh_port,
      costPerHour: inst.dph_total,
      uptimeSeconds: inst.duration,
    };
  }

  /**
   * Stop an instance on Vast.ai
   */
  public static async stopInstance(
    apiKey: string,
    instanceId: string | number,
    timeoutMs: number = 8000
  ): Promise<boolean> {
    const data = await this.executeRest(
      apiKey,
      `/instances/${instanceId}/`,
      "PUT",
      { state: "stopped" },
      timeoutMs
    );
    return !!data && (data.success !== false);
  }

  /**
   * Destroy an instance on Vast.ai
   */
  public static async destroyInstance(
    apiKey: string,
    instanceId: string | number,
    timeoutMs: number = 8000
  ): Promise<boolean> {
    const data = await this.executeRest(
      apiKey,
      `/instances/${instanceId}/`,
      "DELETE",
      undefined,
      timeoutMs
    );
    return !!data && (data.success !== false);
  }
}
