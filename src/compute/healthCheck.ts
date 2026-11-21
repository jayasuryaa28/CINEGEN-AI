import { ComputeHealthStatus, HardwareInfo } from "./types";
import { computeRegistry } from "./providerRegistry";
import { DeviceDetector } from "./deviceDetector";

export interface SystemComputeHealthReport {
  timestamp: string;
  hardware: HardwareInfo;
  activeProviderId: string;
  activeProviderType: string;
  providers: ComputeHealthStatus[];
  allHealthy: boolean;
  warnings: string[];
}

export class HealthCheckManager {
  public static async runSystemHealthCheck(): Promise<SystemComputeHealthReport> {
    const hardware = await DeviceDetector.detectHardware(true);
    const providers = computeRegistry.getAllProviders();
    const providerReports: ComputeHealthStatus[] = [];
    const warnings: string[] = [];

    let activeProvider = computeRegistry.getActiveProvider();

    for (const p of providers) {
      try {
        const health = await p.getHealth();
        providerReports.push(health);

        if (health.status === "error") {
          warnings.push(`Provider ${p.name} is in ERROR state: ${health.errorMessage || "Unknown error"}`);
        } else if (health.status === "not_configured" && p.type === "cloud_gpu") {
          // Normal unconfigured state for cloud provider
        }
      } catch (err: any) {
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
