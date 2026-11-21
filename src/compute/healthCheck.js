const { computeRegistry } = require("./providerRegistry");
const { DeviceDetector } = require("./deviceDetector");

class HealthCheckManager {
  static async runSystemHealthCheck() {
    const hardware = await DeviceDetector.detectHardware(true);
    const providers = computeRegistry.getAllProviders();
    const providerReports = [];
    const warnings = [];

    const activeProvider = computeRegistry.getActiveProvider();

    for (const p of providers) {
      try {
        const health = await p.getHealth();
        providerReports.push(health);

        if (health.status === "error") {
          warnings.push(`Provider ${p.name} is in ERROR state: ${health.errorMessage || "Unknown error"}`);
        } else if (health.status === "not_configured" && p.type === "cloud_gpu") {
          // Normal unconfigured state for cloud provider
        }
      } catch (err) {
        warnings.push(`Failed to check health for ${p.name}: ${err.message}`);
      }
    }

    if (!hardware.ffmpegAvailable) {
      warnings.push("CRITICAL: FFmpeg binary is missing from PATH.");
    }
    if (!hardware.ffprobeAvailable) {
      warnings.push("CRITICAL: FFprobe binary is missing from PATH.");
    }
    if (hardware.freeMemoryMB < 1000) {
      warnings.push(`Low available system memory: ${hardware.freeMemoryMB} MB remaining.`);
    }

    return {
      timestamp: new Date().toISOString(),
      hardware,
      activeProviderId: activeProvider.id,
      activeProviderType: activeProvider.type,
      providers: providerReports,
      allHealthy: warnings.filter((w) => w.startsWith("CRITICAL")).length === 0,
      warnings,
    };
  }
}

module.exports = { HealthCheckManager };
