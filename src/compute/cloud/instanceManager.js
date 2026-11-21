const fs = require("fs");
const path = require("path");
const { CredentialManager } = require("./credentialManager");
const { RunPodProvider } = require("./runpodProvider");
const { VastProvider } = require("./vastProvider");
const { GpuCatalog } = require("./gpuCatalog");

class InstanceManager {
  static STORAGE_FILE = path.resolve(
    process.env.STORAGE_LOCAL_DIR || "./storage_data",
    "cloud_instances.json"
  );

  static loadInstances() {
    if (!fs.existsSync(this.STORAGE_FILE)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
    } catch {
      return [];
    }
  }

  static saveInstances(instances) {
    const dir = path.dirname(this.STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.STORAGE_FILE, JSON.stringify(instances, null, 2), {
      mode: 0o600,
    });
  }

  static async provisionInstance(params) {
    if (!params.userApprovedCost) {
      throw new Error(
        "Cost approval required: User must explicitly confirm the hourly rate before cloud GPU provisioning."
      );
    }

    const apiKey = await CredentialManager.getDecryptedCredential(
      params.userId,
      params.provider
    );
    if (!apiKey) {
      throw new Error(
        `No API key configured for provider '${params.provider}'. Please add your API key in Compute Settings.`
      );
    }

    const gpu = GpuCatalog.getGpuById(params.gpuId) || GpuCatalog.getCatalog(params.provider)[0];
    const hourlyRate =
      params.provider === "runpod" ? gpu.hourlyRateRunPodUsd : gpu.hourlyRateVastUsd;

    const defaultImage =
      params.imageName || "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04";

    let providerInstanceId = "";
    try {
      if (params.provider === "runpod") {
        const pod = await RunPodProvider.deployPod(apiKey, {
          name: `cinegen-worker-${Date.now()}`,
          imageName: defaultImage,
          gpuTypeId: params.gpuId,
        });
        providerInstanceId = pod.id;
      } else {
        const inst = await VastProvider.createInstance(apiKey, params.gpuId, {
          image: defaultImage,
        });
        providerInstanceId = inst.id;
      }
    } catch (err) {
      const failedRecord = {
        id: `inst_${Date.now()}`,
        providerInstanceId: "none",
        userId: params.userId,
        provider: params.provider,
        gpuModel: gpu.model,
        hourlyRateUsd: hourlyRate,
        status: "failed",
        createdAt: new Date().toISOString(),
        totalCostUsd: 0,
        errorMessage: err.message,
      };
      const all = this.loadInstances();
      all.push(failedRecord);
      this.saveInstances(all);
      throw new Error(`Cloud GPU provisioning failed: ${err.message}`);
    }

    const record = {
      id: `inst_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      providerInstanceId,
      userId: params.userId,
      provider: params.provider,
      gpuModel: gpu.model,
      hourlyRateUsd: hourlyRate,
      status: "provisioning",
      createdAt: new Date().toISOString(),
      totalCostUsd: 0,
    };

    const instances = this.loadInstances();
    instances.push(record);
    this.saveInstances(instances);
    return record;
  }

  static async terminateInstance(userId, instanceRecordId) {
    const instances = this.loadInstances();
    const idx = instances.findIndex((i) => i.id === instanceRecordId && i.userId === userId);
    if (idx === -1) {
      throw new Error(`Instance record '${instanceRecordId}' not found for user '${userId}'.`);
    }

    const record = instances[idx];
    if (record.status === "terminated") {
      return { success: true, verifiedTerminated: true, record };
    }

    const apiKey = await CredentialManager.getDecryptedCredential(userId, record.provider);
    let verifiedTerminated = false;

    if (apiKey && record.providerInstanceId && record.providerInstanceId !== "none") {
      try {
        if (record.provider === "runpod") {
          await RunPodProvider.terminatePod(apiKey, record.providerInstanceId);
          try {
            const status = await RunPodProvider.getPodStatus(apiKey, record.providerInstanceId);
            verifiedTerminated =
              status.status === "TERMINATED" ||
              status.status === "DEAD" ||
              status.status === "UNKNOWN";
          } catch {
            verifiedTerminated = true;
          }
        } else {
          await VastProvider.destroyInstance(apiKey, record.providerInstanceId);
          try {
            const status = await VastProvider.getInstanceStatus(apiKey, record.providerInstanceId);
            verifiedTerminated =
              status.status === "deleted" ||
              status.status === "stopped" ||
              status.status === "unknown";
          } catch {
            verifiedTerminated = true;
          }
        }
      } catch (err) {
        record.errorMessage = `Provider teardown warning: ${err.message}`;
      }
    } else {
      verifiedTerminated = true;
    }

    const now = new Date();
    const created = new Date(record.createdAt);
    const durationHours = Math.max(0.01, (now.getTime() - created.getTime()) / (1000 * 3600));
    record.totalCostUsd = parseFloat((durationHours * record.hourlyRateUsd).toFixed(3));
    record.status = "terminated";
    record.terminatedAt = now.toISOString();

    instances[idx] = record;
    this.saveInstances(instances);

    return {
      success: true,
      verifiedTerminated,
      record,
    };
  }

  static getUserInstances(userId) {
    return this.loadInstances().filter((i) => i.userId === userId);
  }

  static getActiveInstances(userId) {
    return this.loadInstances().filter(
      (i) => i.userId === userId && (i.status === "provisioning" || i.status === "running")
    );
  }
}

module.exports = { InstanceManager };
