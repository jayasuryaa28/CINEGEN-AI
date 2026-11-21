import fs from "fs";
import path from "path";
import { UserComputeMode, ComputeSettingsConfig } from "./types";
import { computeRegistry } from "./providerRegistry";

export class ComputeModeManager {
  private static readonly SETTINGS_FILE = path.resolve(
    process.env.STORAGE_LOCAL_DIR || "./storage_data",
    "compute_settings.json"
  );

  private static readonly DEFAULT_SETTINGS: ComputeSettingsConfig = {
    activeMode: "own_pc",
    preferredCloudProvider: "runpod",
    preferredGpuId: "rtx-3090",
    maxLocalConcurrency: 1,
    memorySafetyLimitGb: 2.0,
    updatedAt: new Date().toISOString(),
  };

  public static async getSettings(): Promise<ComputeSettingsConfig> {
    if (!fs.existsSync(this.SETTINGS_FILE)) {
      return { ...this.DEFAULT_SETTINGS };
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.SETTINGS_FILE, "utf-8"));
      return { ...this.DEFAULT_SETTINGS, ...data };
    } catch {
      return { ...this.DEFAULT_SETTINGS };
    }
  }

  public static async saveSettings(
    settings: Partial<ComputeSettingsConfig>
  ): Promise<ComputeSettingsConfig> {
    const current = await this.getSettings();
    const updated: ComputeSettingsConfig = {
      ...current,
      ...settings,
      updatedAt: new Date().toISOString(),
    };

    const dir = path.dirname(this.SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.SETTINGS_FILE, JSON.stringify(updated, null, 2), { mode: 0o600 });

    // Sync with ComputeProviderRegistry
    if (updated.activeMode === "cloud_gpu") {
      computeRegistry.setActiveProvider("generic-cloud-provider");
    } else {
      computeRegistry.setActiveProvider("local-cpu-provider");
    }

    return updated;
  }

  public static async getActiveMode(): Promise<UserComputeMode> {
    const s = await this.getSettings();
    return s.activeMode;
  }
}
