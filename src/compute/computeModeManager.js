const fs = require("fs");
const path = require("path");
const { computeRegistry } = require("./providerRegistry");

class ComputeModeManager {
  static SETTINGS_FILE = path.resolve(
    process.env.STORAGE_LOCAL_DIR || "./storage_data",
    "compute_settings.json"
  );

  static DEFAULT_SETTINGS = {
    activeMode: "own_pc",
    preferredCloudProvider: "runpod",
    preferredGpuId: "rtx-3090",
    maxLocalConcurrency: 1,
    memorySafetyLimitGb: 2.0,
    updatedAt: new Date().toISOString(),
  };

  static async getSettings() {
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

  static async saveSettings(settings) {
    const current = await this.getSettings();
    const updated = {
      ...current,
      ...settings,
      updatedAt: new Date().toISOString(),
    };

    const dir = path.dirname(this.SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.SETTINGS_FILE, JSON.stringify(updated, null, 2), { mode: 0o600 });

    if (updated.activeMode === "cloud_gpu") {
      computeRegistry.setActiveProvider("generic-cloud-provider");
    } else {
      computeRegistry.setActiveProvider("local-cpu-provider");
    }

    return updated;
  }

  static async getActiveMode() {
    const s = await this.getSettings();
    return s.activeMode;
  }
}

module.exports = { ComputeModeManager };
