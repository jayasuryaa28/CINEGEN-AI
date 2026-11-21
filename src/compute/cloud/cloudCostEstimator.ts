import { GpuOffer, GpuCatalog } from "./gpuCatalog";

export interface CostEstimateInput {
  videoDurationSeconds: number;
  targetResolution: "720p" | "1080p" | "1440p" | "4K";
  gpuId?: string;
  provider: "runpod" | "vast";
  containerSetupMinutes?: number;
}

export interface CostEstimateResult {
  provider: "runpod" | "vast";
  gpuModel: string;
  vramGb: number;
  hourlyRateUsd: number;
  videoDurationFormatted: string;
  estimatedProcessingMinutes: number;
  containerSetupMinutes: number;
  totalEstimatedMinutes: number;
  typicalCostUsd: number;
  costRange: {
    minCostUsd: number;
    maxCostUsd: number;
  };
  localCpuComparison: {
    estimatedHours: number;
    description: string;
  };
}

export class CloudCostEstimator {
  /**
   * Calculate RTF (Real-Time Factor) based on GPU tier and resolution
   */
  public static getRealTimeFactor(
    vramGb: number,
    cudaCompute: string,
    resolution: "720p" | "1080p" | "1440p" | "4K"
  ): number {
    const isAda = parseFloat(cudaCompute) >= 8.9;
    const isHighVram = vramGb >= 24;

    if (resolution === "4K") {
      if (isAda) return 0.85; // e.g. RTX 4090
      if (isHighVram) return 1.25; // e.g. RTX 3090 / A5000
      return 1.85; // e.g. A4000
    }
    if (resolution === "1440p") {
      if (isAda) return 0.45;
      if (isHighVram) return 0.65;
      return 0.95;
    }
    if (resolution === "1080p") {
      if (isAda) return 0.25;
      if (isHighVram) return 0.35;
      return 0.5;
    }
    // 720p
    if (isAda) return 0.15;
    if (isHighVram) return 0.22;
    return 0.3;
  }

  /**
   * Estimate cost for a video restoration workload
   */
  public static estimate(input: CostEstimateInput): CostEstimateResult {
    const gpu =
      (input.gpuId ? GpuCatalog.getGpuById(input.gpuId) : undefined) ||
      GpuCatalog.getRecommendedGpu(input.targetResolution, input.provider);

    const setupMins = input.containerSetupMinutes !== undefined ? input.containerSetupMinutes : 4;
    const rtf = this.getRealTimeFactor(
      gpu.vramGb,
      gpu.cudaComputeCapability,
      input.targetResolution
    );

    const processingMins = (input.videoDurationSeconds * rtf) / 60;
    const totalMins = processingMins + setupMins;
    const billableHours = Math.max(0.083, totalMins / 60); // minimum ~5 minutes billing block

    const hourlyRate =
      input.provider === "runpod" ? gpu.hourlyRateRunPodUsd : gpu.hourlyRateVastUsd;

    const typicalCost = billableHours * hourlyRate;
    const minCost = Math.max(0.05, (Math.max(0.05, (processingMins * 0.85 + setupMins) / 60)) * hourlyRate);
    const maxCost = Math.max(minCost + 0.05, (Math.max(0.1, (processingMins * 1.35 + setupMins + 3) / 60)) * hourlyRate);

    // CPU comparison: CPU takes approx 3x to 6x real-time
    const cpuRtf = input.targetResolution === "4K" ? 8.5 : input.targetResolution === "1080p" ? 3.5 : 2.0;
    const cpuHours = (input.videoDurationSeconds * cpuRtf) / 3600;

    const formatDuration = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h > 0) return `${h}h ${m}m ${s}s`;
      return `${m}m ${s}s`;
    };

    return {
      provider: input.provider,
      gpuModel: gpu.model,
      vramGb: gpu.vramGb,
      hourlyRateUsd: hourlyRate,
      videoDurationFormatted: formatDuration(input.videoDurationSeconds),
      estimatedProcessingMinutes: parseFloat(processingMins.toFixed(1)),
      containerSetupMinutes: setupMins,
      totalEstimatedMinutes: parseFloat(totalMins.toFixed(1)),
      typicalCostUsd: parseFloat(typicalCost.toFixed(3)),
      costRange: {
        minCostUsd: parseFloat(minCost.toFixed(3)),
        maxCostUsd: parseFloat(maxCost.toFixed(3)),
      },
      localCpuComparison: {
        estimatedHours: parseFloat(cpuHours.toFixed(1)),
        description: `Local CPU processing takes approx ${cpuHours.toFixed(1)} hours (${(
          cpuHours * 60 / totalMins
        ).toFixed(1)}x slower than ${gpu.model}).`,
      },
    };
  }
}
