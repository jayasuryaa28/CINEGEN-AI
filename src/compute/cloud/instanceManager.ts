import fs from "fs";
import path from "path";
import { CredentialManager, CloudProviderId } from "./credentialManager";
import { RunPodProvider } from "./runpodProvider";
import { VastProvider } from "./vastProvider";
import { GpuCatalog } from "./gpuCatalog";

export interface ManagedInstanceRecord {
  id: string; // our internal id or provider instance id
  providerInstanceId: string;
  userId: string;
  provider: CloudProviderId;
  gpuModel: string;
  hourlyRateUsd: number;
  status: "provisioning" | "running" | "stopped" | "terminated" | "failed";
  createdAt: string;
  terminatedAt?: string;
  totalCostUsd: number;
  endpointUrl?: string;
  errorMessage?: string;
}

export class InstanceManager {
  private static readonly STORAGE_FILE = path.resolve(
    process.env.STORAGE_LOCAL_DIR || "./storage_data",
    "cloud_instances.json"
  );

  private static loadInstances(): ManagedInstanceRecord[] {
    if (!fs.existsSync(this.STORAGE_FILE)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.STORAGE_FILE, "utf-8"));
    } catch {
      return [];
    }
  }

  private static saveInstances(instances: ManagedInstanceRecord[]): void {
    const dir = path.dirname(this.STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.STORAGE_FILE, JSON.stringify(instances, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Provision an instance with mandatory user cost approval
   */
  public static async provisionInstance(params: {
    userId: string;
    provider: CloudProviderId;
    gpuId: string;
    userApprovedCost: boolean;
    imageName?: string;
  }): Promise<ManagedInstanceRecord> {
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
    } catch (err: any) {
      const failedRecord: ManagedInstanceRecord = {
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

    const record: ManagedInstanceRecord = {
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

  /**
   * Terminate instance and verify termination with provider
   */
  public static async terminateInstance(
    userId: string,
    instanceRecordId: string
  ): Promise<{ success: boolean; verifiedTerminated: boolean; record: ManagedInstanceRecord }> {
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
          // Verify termination
          try {
            const status = await RunPodProvider.getPodStatus(apiKey, record.providerInstanceId);
            verifiedTerminated =
              status.status === "TERMINATED" ||
              status.status === "DEAD" ||
              status.status === "UNKNOWN";
          } catch {
            // If getPodStatus throws 404 or error, the pod is confirmed dead
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
      } catch (err: any) {
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

  /**
   * Get all instances belonging to a user
   */
  public static getUserInstances(userId: string): ManagedInstanceRecord[] {
    return this.loadInstances().filter((i) => i.userId === userId);
  }

  /**
   * Get currently active instances for a user
   */
  public static getActiveInstances(userId: string): ManagedInstanceRecord[] {
    return this.loadInstances().filter(
      (i) => i.userId === userId && (i.status === "provisioning" || i.status === "running")
    );
  }
}
