const https = require("https");
const { URL } = require("url");

class VastProvider {
  static API_BASE = "https://console.vast.ai/api/v0";

  static async executeRest(apiKey, endpoint, method = "GET", body = null, timeoutMs = 10000) {
    if (global.__VAST_MOCK_HANDLER__) {
      return global.__VAST_MOCK_HANDLER__(endpoint, method, body, apiKey);
    }

    const fullUrl = `${this.API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const url = new URL(fullUrl);
    const payload = body ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const headers = {
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
          } catch (err) {
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

  static async validateApiKey(apiKey, timeoutMs = 8000) {
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
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  static async getOffers(apiKey, filters = {}, timeoutMs = 8000) {
    try {
      const queryParams = new URLSearchParams();
      if (filters.minGpuRamGb) {
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
        return data.offers.map((o) => ({
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

  static async createInstance(apiKey, offerId, options, timeoutMs = 15000) {
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

  static async getInstanceStatus(apiKey, instanceId, timeoutMs = 8000) {
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

  static async stopInstance(apiKey, instanceId, timeoutMs = 8000) {
    const data = await this.executeRest(
      apiKey,
      `/instances/${instanceId}/`,
      "PUT",
      { state: "stopped" },
      timeoutMs
    );
    return !!data && (data.success !== false);
  }

  static async destroyInstance(apiKey, instanceId, timeoutMs = 8000) {
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

module.exports = { VastProvider };
