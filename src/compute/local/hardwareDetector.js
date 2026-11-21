const os = require("os");
const { execSync } = require("child_process");

class HardwareDetector {
  static async detect() {
    const cpus = os.cpus() || [];
    const cpuModel = cpus[0]?.model || "Unknown CPU";
    const threads = cpus.length;
    const speed = cpus[0]?.speed || 0;

    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    const totalGb = parseFloat((totalBytes / (1024 ** 3)).toFixed(2));
    const freeGb = parseFloat((freeBytes / (1024 ** 3)).toFixed(2));
    const usedGb = parseFloat((usedBytes / (1024 ** 3)).toFixed(2));
    const utilPercent = parseFloat(((usedBytes / totalBytes) * 100).toFixed(1));

    const gpu = this.detectGpu();
    const mediaTools = this.detectMediaTools();
    const storage = this.detectStorage();
    const backendInfo = this.probeRuntimeBackends(gpu);

    return {
      os: {
        platform: os.platform(),
        distro: os.type(),
        release: os.release(),
        arch: os.arch(),
      },
      cpu: {
        model: cpuModel,
        cores: Math.max(1, Math.floor(threads / 2)),
        threads,
        speedMhz: speed,
      },
      memory: {
        totalGb,
        freeGb,
        usedGb,
        utilizationPercent: utilPercent,
      },
      gpu,
      storage,
      mediaTools,
      inferenceBackend: backendInfo,
    };
  }

  static probeRuntimeBackends(gpu) {
    let currentBackend = "cpu";
    const supportedBackends = ["cpu"];
    let hardwareAccelerationActive = false;

    try {
      const tf = require("@tensorflow/tfjs");
      if (tf.engine && tf.engine().registryFactory) {
        const registered = Object.keys(tf.engine().registryFactory);
        registered.forEach((b) => {
          if (!supportedBackends.includes(b)) supportedBackends.push(b);
        });
      }
      currentBackend = tf.getBackend ? tf.getBackend() : "cpu";
    } catch {
      currentBackend = "cpu";
    }

    const cudaStatus = gpu.type === "nvidia"
      ? "NOT_SUPPORTED (NVIDIA GPU detected on host, but @tensorflow/tfjs-node-gpu is not compiled into Node runtime; falling back to CPU)"
      : "NOT_SUPPORTED (No NVIDIA CUDA GPU detected on host system)";

    const directMlStatus = gpu.type === "amd"
      ? "NOT_SUPPORTED (AMD Radeon GPU detected, but DirectML Node.js native addon is not available; falling back to CPU)"
      : "NOT_SUPPORTED (DirectML requires Windows C++ native Node bindings; not active in pure Node.js runtime)";

    const webGpuStatus = "NOT_SUPPORTED (WebGPU is a client browser API; headless Node.js server runtime requires Dawn bindings)";

    const healthCheck = this.runBackendHealthCheck();

    return {
      currentBackend,
      supportedBackends,
      hardwareAccelerationActive,
      cudaStatus,
      directMlStatus,
      webGpuStatus,
      healthCheck,
    };
  }

  static runBackendHealthCheck() {
    try {
      const tf = require("@tensorflow/tfjs");
      const initialTensors = tf.memory ? tf.memory().numTensors : 0;
      let opsVerified = false;

      tf.tidy(() => {
        const a = tf.tensor1d([1.0, 2.0, 3.0]);
        const b = a.square();
        const data = b.dataSync();
        if (data[0] === 1.0 && data[1] === 4.0 && data[2] === 9.0) {
          opsVerified = true;
        }
      });

      const finalTensors = tf.memory ? tf.memory().numTensors : 0;
      const noLeaks = finalTensors === initialTensors;

      return {
        healthy: opsVerified && noLeaks,
        opsVerified,
        activeTensors: finalTensors,
      };
    } catch {
      return {
        healthy: false,
        opsVerified: false,
        activeTensors: 0,
      };
    }
  }

  static detectGpu() {
    try {
      const nvidiaOut = execSync("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader", {
        timeout: 2500,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();

      if (nvidiaOut && !nvidiaOut.toLowerCase().includes("not found")) {
        const parts = nvidiaOut.split(",").map((s) => s.trim());
        const model = parts[0] || "NVIDIA GPU";
        const vramMb = parseInt(parts[1]?.replace(/[^0-9]/g, "") || "0", 10);
        const driver = parts[2] || undefined;
        return {
          detected: true,
          model,
          vramGb: parseFloat((vramMb / 1024).toFixed(1)),
          driverVersion: driver,
          isDiscrete: true,
          type: "nvidia",
        };
      }
    } catch {}

    if (os.platform() === "win32") {
      try {
        const wmicOut = execSync("wmic path win32_VideoController get Name,AdapterRAM", {
          timeout: 2500,
          stdio: ["ignore", "pipe", "ignore"],
        }).toString();

        const lines = wmicOut
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("AdapterRAM") && !l.startsWith("Name"));

        if (lines.length > 0) {
          const firstLine = lines[0];
          const tokens = firstLine.split(/\s{2,}/);
          let model = "Integrated GPU";
          let vramGb = 2.0;

          if (tokens.length >= 2) {
            const ramBytes = parseInt(tokens[0], 10);
            model = tokens[1];
            if (!isNaN(ramBytes) && ramBytes > 0) {
              vramGb = parseFloat((ramBytes / (1024 ** 3)).toFixed(1));
            }
          } else {
            model = firstLine;
          }

          const isNvidia = model.toLowerCase().includes("nvidia") || model.toLowerCase().includes("geforce");
          const isAmd = model.toLowerCase().includes("amd") || model.toLowerCase().includes("radeon");
          const isIntel = model.toLowerCase().includes("intel");

          return {
            detected: true,
            model,
            vramGb: isNaN(vramGb) || vramGb <= 0 ? 2.0 : vramGb,
            isDiscrete: isNvidia || (isAmd && !model.toLowerCase().includes("graphics")),
            type: isNvidia ? "nvidia" : isAmd ? "amd" : isIntel ? "intel" : "none",
          };
        }
      } catch {}
    }

    return {
      detected: false,
      model: "Standard Host Display Adapter",
      vramGb: 0,
      isDiscrete: false,
      type: "none",
    };
  }

  static detectMediaTools() {
    let ffmpegAvailable = false;
    let ffmpegVersion;
    let ffprobeAvailable = false;

    try {
      const out = execSync("ffmpeg -version", { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString();
      ffmpegAvailable = true;
      const match = out.match(/ffmpeg version ([^\s]+)/);
      ffmpegVersion = match ? match[1] : "detected";
    } catch {
      ffmpegAvailable = false;
    }

    try {
      execSync("ffprobe -version", { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
      ffprobeAvailable = true;
    } catch {
      ffprobeAvailable = false;
    }

    return { ffmpegAvailable, ffmpegVersion, ffprobeAvailable };
  }

  static detectStorage() {
    try {
      if (os.platform() === "win32") {
        const out = execSync('powershell -Command "(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 } | Select-Object -First 1).Free"', {
          timeout: 2500,
          stdio: ["ignore", "pipe", "ignore"],
        }).toString().trim();
        const freeBytes = parseInt(out, 10);
        if (!isNaN(freeBytes)) {
          return { freeDiskGb: parseFloat((freeBytes / (1024 ** 3)).toFixed(1)) };
        }
      }
    } catch {}
    return { freeDiskGb: 45.0 };
  }
}

module.exports = {
  HardwareDetector,
};
