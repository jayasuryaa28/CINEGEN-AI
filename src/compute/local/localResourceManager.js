const os = require("os");

class LocalResourceManager {
  static CRITICAL_RAM_THRESHOLD_GB = 1.0;
  static WARNING_RAM_THRESHOLD_GB = 2.0;

  static checkMemorySafety() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    const totalRamGb = parseFloat((totalBytes / (1024 ** 3)).toFixed(2));
    const freeRamGb = parseFloat((freeBytes / (1024 ** 3)).toFixed(2));
    const utilizationPercent = parseFloat(((usedBytes / totalBytes) * 100).toFixed(1));

    let tfNumTensors;
    let tfNumBytes;

    try {
      const tf = require("@tensorflow/tfjs");
      if (tf.memory) {
        const mem = tf.memory();
        tfNumTensors = mem.numTensors;
        tfNumBytes = mem.numBytes;
      }
    } catch {}

    let isSafe = true;
    let warning = undefined;

    if (freeRamGb < this.CRITICAL_RAM_THRESHOLD_GB) {
      isSafe = false;
      warning = `Critical memory condition: Free RAM is ${freeRamGb} GB (below ${this.CRITICAL_RAM_THRESHOLD_GB} GB threshold). Execution throttled.`;
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

  static getDynamicBatchSize(preferredBatchSize = 4) {
    const safety = this.checkMemorySafety();
    if (!safety.isSafe) return 1;
    if (safety.freeRamGb < 2.5) return Math.min(preferredBatchSize, 1);
    if (safety.freeRamGb < 5.0) return Math.min(preferredBatchSize, 2);
    return preferredBatchSize;
  }
}

module.exports = { LocalResourceManager };
