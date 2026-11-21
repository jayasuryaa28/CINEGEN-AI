class LocalCapabilityAdvisor {
  static evaluate(profile) {
    const { memory, cpu, gpu } = profile;
    const warnings = [];

    let performanceTier = "entry";
    let maxQuality = "720p";
    let recommendedMode = "own_pc";
    let recommendedConcurrency = 1;
    let recommendedBatchSize = 1;

    if (gpu.isDiscrete && gpu.vramGb >= 16 && memory.totalGb >= 32) {
      performanceTier = "workstation";
      maxQuality = "4K";
      recommendedConcurrency = 2;
      recommendedBatchSize = 4;
      recommendedMode = "own_pc";
    } else if (gpu.isDiscrete && gpu.vramGb >= 8 && memory.totalGb >= 16) {
      performanceTier = "enthusiast";
      maxQuality = "1440p";
      recommendedConcurrency = 1;
      recommendedBatchSize = 2;
      recommendedMode = "own_pc";
    } else if (memory.totalGb >= 14 && cpu.threads >= 6) {
      performanceTier = "balanced";
      maxQuality = "1080p";
      recommendedConcurrency = 1;
      recommendedBatchSize = 1;
      recommendedMode = "own_pc";
    } else {
      performanceTier = "entry";
      maxQuality = "720p";
      recommendedConcurrency = 1;
      recommendedBatchSize = 1;
      recommendedMode = memory.totalGb < 8 ? "cloud_gpu" : "own_pc";
    }

    if (!gpu.isDiscrete) {
      warnings.push(
        "No discrete NVIDIA/AMD GPU detected. Neural restoration will run on CPU, which takes approx 2.5x-4.5x real-time for 1080p."
      );
    }

    if (memory.freeGb < 3.0) {
      warnings.push(
        `Low free RAM detected (${memory.freeGb} GB available). Close other applications to prevent memory throttling.`
      );
    }

    if (profile.storage && profile.storage.freeDiskGb < 15.0) {
      warnings.push(
        `Limited disk space (${profile.storage.freeDiskGb} GB free). Ensure sufficient space for intermediate frame chunks.`
      );
    }

    const canProcess4kLocally =
      (gpu.isDiscrete && gpu.vramGb >= 16) || (memory.totalGb >= 32 && cpu.threads >= 12);
    const canProcess1080pLocally = memory.totalGb >= 12 || (gpu.isDiscrete && gpu.vramGb >= 4);
    const cloudGpuAdvisedForLongVideos = !gpu.isDiscrete || gpu.vramGb < 8;

    let summary = "";
    if (performanceTier === "workstation") {
      summary = "Workstation hardware detected. Optimal for high-throughput local 4K processing.";
    } else if (performanceTier === "enthusiast") {
      summary = "Powerful PC detected. Excellent for local 1080p and 1440p restoration.";
    } else if (performanceTier === "balanced") {
      summary = "Balanced PC detected. Great for 1080p restoration with reliable CPU execution.";
    } else {
      summary =
        "Entry-level hardware detected. 720p local restoration supported; Cloud GPU recommended for HD/4K.";
    }

    return {
      recommendedMode,
      performanceTier,
      maxRecommendedQuality: maxQuality,
      recommendedConcurrency,
      recommendedBatchSize,
      summary,
      warnings,
      features: {
        canProcess4kLocally,
        canProcess1080pLocally,
        cloudGpuAdvisedForLongVideos,
      },
    };
  }
}

module.exports = { LocalCapabilityAdvisor };
