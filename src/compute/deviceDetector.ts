import os from "os";
import { spawnSync } from "child_process";
import * as tf from "@tensorflow/tfjs";
import { HardwareInfo } from "./types";

export class DeviceDetector {
  private static cachedInfo: HardwareInfo | null = null;
  private static cacheTime = 0;
  private static readonly CACHE_TTL_MS = 10000; // 10s TTL

  public static async detectHardware(forceRefresh = false): Promise<HardwareInfo> {
    const now = Date.now();
    if (!forceRefresh && this.cachedInfo && now - this.cacheTime < this.CACHE_TTL_MS) {
      // Return updated live free memory even with cached hardware profile
      return {
        ...this.cachedInfo,
        freeMemoryBytes: os.freemem(),
        freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
      };
    }

    const cpus = os.cpus() || [];
    const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : "Unknown CPU";
    const cpuCores = cpus.length;

    const totalMemoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();
    const totalMemoryMB = Math.round(totalMemoryBytes / (1024 * 1024));
    const freeMemoryMB = Math.round(freeMemoryBytes / (1024 * 1024));

    // Detect FFmpeg & FFprobe
    const ffmpegAvailable = this.checkBinary("ffmpeg");
    const ffprobeAvailable = this.checkBinary("ffprobe");

    // Detect GPU hardware presence securely via system diagnostics
    const gpuInfo = this.detectGpuHardware();

    // Detect active JavaScript inference backend
    let inferenceBackend = "cpu";
    try {
      inferenceBackend = tf.getBackend() || "cpu";
    } catch {
      inferenceBackend = "cpu";
    }

    const info: HardwareInfo = {
      os: `${os.type()} ${os.release()}`,
      platform: os.platform(),
      arch: os.arch(),
      cpuModel,
      cpuCores,
      totalMemoryBytes,
      freeMemoryBytes,
      totalMemoryMB,
      freeMemoryMB,
      gpuDetected: gpuInfo.detected,
      gpuModel: gpuInfo.model,
      gpuVramMB: gpuInfo.vramMB,
      inferenceBackend,
      ffmpegAvailable,
      ffprobeAvailable,
    };

    this.cachedInfo = info;
    this.cacheTime = now;
    return info;
  }

  private static checkBinary(binaryName: string): boolean {
    try {
      const res = spawnSync(binaryName, ["-version"], {
        encoding: "utf8",
        timeout: 2000,
      });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  private static detectGpuHardware(): { detected: boolean; model?: string; vramMB?: number } {
    const platform = os.platform();

    if (platform === "win32") {
      try {
        // Query WMI VideoController on Windows
        const res = spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object -Property Name, AdapterRAM | ConvertTo-Json",
          ],
          { encoding: "utf8", timeout: 3000 }
        );

        if (res.status === 0 && res.stdout.trim().length > 0) {
          const parsed = JSON.parse(res.stdout);
          const controllers = Array.isArray(parsed) ? parsed : [parsed];

          // Look for dedicated or primary GPU
          for (const ctrl of controllers) {
            const name = ctrl.Name || "";
            if (name && !name.includes("Virtual") && !name.includes("RDP")) {
              const ramBytes = ctrl.AdapterRAM || 0;
              const vramMB = ramBytes > 0 ? Math.round(ramBytes / (1024 * 1024)) : undefined;
              return {
                detected: true,
                model: name,
                vramMB,
              };
            }
          }
        }
      } catch {
        // Fallback or restricted environment
      }
    }

    // Attempt nvidia-smi query if available
    try {
      const res = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], {
        encoding: "utf8",
        timeout: 2000,
      });

      if (res.status === 0 && res.stdout.trim().length > 0) {
        const parts = res.stdout.trim().split(",").map((s) => s.trim());
        const model = parts[0];
        const vramMB = parts[1] ? parseInt(parts[1], 10) : undefined;
        return {
          detected: true,
          model,
          vramMB,
        };
      }
    } catch {
      // Not present
    }

    return {
      detected: false,
    };
  }
}
