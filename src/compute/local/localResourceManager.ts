import os from "os";

export interface MemorySafetyReport {
  isSafe: boolean;
  freeRamGb: number;
  totalRamGb: number;
  utilizationPercent: number;
  tfNumTensors?: number;
  tfNumBytes?: number;
  warning?: string;
}

export class LocalResourceManager {
  private static readonly CRITICAL_RAM_THRESHOLD_GB = 1.0;
  private static readonly WARNING_RAM_THRESHOLD_GB = 2.0;

  public static checkMemorySafety(): MemorySafetyReport {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    const totalRamGb = parseFloat((totalBytes / (1024 ** 3)).toFixed(2));
    const freeRamGb = parseFloat((freeBytes / (1024 ** 3)).toFixed(2));
    const utilizationPercent = parseFloat(((usedBytes / totalBytes) * 100).toFixed(1));

    let tfNumTensors: number | undefined;
    let tfNumBytes: number | undefined;

    try {
      const tf = require("@tensorflow/tfjs");
      if (tf.memory) {
        const mem = tf.memory();
        tfNumTensors = mem.numTensors;
        tfNumBytes = mem.numBytes;
      }
    } catch {}

    let isSafe = true;
    let warning: string | undefined;

    if (freeRamGb < this.CRITICAL_RAM_THRESHOLD_GB) {
      isSafe = false;
      warning = `Critical memory condition: Free RAM is ${freeRamGb} GB (below ${this.CRITICAL_RAM_THRESHOLD_GB} GB threshold). Execution throttled.`;
      // Trigger GC if node was launched with --expose-gc
      if (typeof global.gc === "function") {
        try {
          global.gc();
        } catch {}
      }
    } else if (freeRamGb < this.WARNING_RAM_THRESHOLD_GB) {
      warning = `Low memory warning: Free RAM is ${freeRamGb} GB. High batch sizes may cause swapping.`;
    }

    return {
      isSafe,
      freeRamGb,
      totalRamGb,
      utilizationPercent,
      tfNumTensors,
      tfNumBytes,
      warning,
    };
  }

  public static getDynamicBatchSize(preferredBatchSize: number = 4): number {
    const safety = this.checkMemorySafety();
    if (!safety.isSafe) return 1;
    if (safety.freeRamGb < 2.5) return Math.min(preferredBatchSize, 1);
    if (safety.freeRamGb < 5.0) return Math.min(preferredBatchSize, 2);
    return preferredBatchSize;
  }
}
