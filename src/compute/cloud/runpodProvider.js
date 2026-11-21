const https = require("https");
const { URL } = require("url");

class RunPodProvider {
  static GRAPHQL_ENDPOINT = "https://api.runpod.io/graphql";

  static async executeGraphQL(apiKey, query, variables = {}, timeoutMs = 10000) {
    if (global.__RUNPOD_MOCK_HANDLER__) {
      return global.__RUNPOD_MOCK_HANDLER__(query, variables, apiKey);
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
              const msg = parsed.errors.map((e) => e.message).join(", ");
              return reject(new Error(`RunPod GraphQL error: ${msg}`));
            }
            resolve(parsed.data);
          } catch (err) {
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

  static async validateApiKey(apiKey, timeoutMs = 8000) {
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
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  static async getGpuTypes(apiKey, timeoutMs = 8000) {
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
        return data.gpuTypes.map((g) => ({
          id: g.id,
          displayName: g.displayName || g.id,
          memoryInGb: g.memoryInGb || 24,
          securePrice: g.securePrice || 0.34,
          communityPrice: g.communityPrice || 0.29,
        }));
      }
      return [];
    } catch (err) {
      return [];
    }
  }

  static async deployPod(apiKey, options, timeoutMs = 15000) {
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

  static async getPodStatus(apiKey, podId, timeoutMs = 8000) {
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

    let ip;
    let port;

    if (pod.runtime && pod.runtime.ports && pod.runtime.ports.length > 0) {
      const publicPort = pod.runtime.ports.find((p) => p.isIpPublic) || pod.runtime.ports[0];
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

  static async stopPod(apiKey, podId, timeoutMs = 8000) {
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

  static async terminatePod(apiKey, podId, timeoutMs = 8000) {
    const mutation = `
      mutation {
        podTerminate(input: { podId: "${podId}" })
      }
    `;
    const data = await this.executeGraphQL(apiKey, mutation, {}, timeoutMs);
    return data && (data.podTerminate === true || data.podTerminate === null || typeof data.podTerminate !== "undefined");
  }
}

module.exports = { RunPodProvider };
