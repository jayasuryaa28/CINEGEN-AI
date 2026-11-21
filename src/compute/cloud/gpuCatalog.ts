export interface GpuOffer {
  id: string;
  model: string;
  vramGb: number;
  memoryBandwidthGbps: number;
  cudaComputeCapability: string;
  recommendedMaxResolution: "720p" | "1080p" | "1440p" | "4K";
  providers: ("runpod" | "vast")[];
  hourlyRateRunPodUsd: number;
  hourlyRateVastUsd: number;
  description: string;
  available: boolean;
}

export const VERIFIED_GPU_CATALOG: GpuOffer[] = [
  {
    id: "rtx-3080",
    model: "NVIDIA GeForce RTX 3080",
    vramGb: 10,
    memoryBandwidthGbps: 760,
    cudaComputeCapability: "8.6",
    recommendedMaxResolution: "1080p",
    providers: ["vast"],
    hourlyRateRunPodUsd: 0.16,
    hourlyRateVastUsd: 0.12,
    description: "Budget entry-level cloud GPU for 720p and 1080p CineGen AI workloads.",
    available: true,
  },
  {
    id: "rtx-3090",
    model: "NVIDIA GeForce RTX 3090",
    vramGb: 24,
    memoryBandwidthGbps: 936,
    cudaComputeCapability: "8.6",
    recommendedMaxResolution: "1440p",
    providers: ["runpod", "vast"],
    hourlyRateRunPodUsd: 0.22,
    hourlyRateVastUsd: 0.18,
    description: "High-value 24GB VRAM GPU. Excellent price-to-performance for full-length 1080p/1440p films.",
    available: true,
  },
  {
    id: "rtx-4090",
    model: "NVIDIA GeForce RTX 4090",
    vramGb: 24,
    memoryBandwidthGbps: 1008,
    cudaComputeCapability: "8.9",
    recommendedMaxResolution: "4K",
    providers: ["runpod", "vast"],
    hourlyRateRunPodUsd: 0.34,
    hourlyRateVastUsd: 0.29,
    description: "Ada Lovelace architecture with 4th-gen Tensor cores. Top tier for fast 4K restoration.",
    available: true,
  },
  {
    id: "rtx-a4000",
    model: "NVIDIA RTX A4000",
    vramGb: 16,
    memoryBandwidthGbps: 448,
    cudaComputeCapability: "8.6",
    recommendedMaxResolution: "1080p",
    providers: ["runpod", "vast"],
    hourlyRateRunPodUsd: 0.17,
    hourlyRateVastUsd: 0.15,
    description: "Reliable workstation GPU with 16GB ECC memory. Stable enterprise choice.",
    available: true,
  },
  {
    id: "rtx-a5000",
    model: "NVIDIA RTX A5000",
    vramGb: 24,
    memoryBandwidthGbps: 768,
    cudaComputeCapability: "8.6",
    recommendedMaxResolution: "1440p",
    providers: ["runpod", "vast"],
    hourlyRateRunPodUsd: 0.26,
    hourlyRateVastUsd: 0.22,
    description: "24GB professional workstation GPU. Highly consistent batch processing.",
    available: true,
  },
  {
    id: "rtx-6000-ada",
    model: "NVIDIA RTX 6000 Ada",
    vramGb: 48,
    memoryBandwidthGbps: 960,
    cudaComputeCapability: "8.9",
    recommendedMaxResolution: "4K",
    providers: ["runpod", "vast"],
    hourlyRateRunPodUsd: 0.78,
    hourlyRateVastUsd: 0.65,
    description: "Massive 48GB VRAM. Handles 4K uncompressed feature-length sequences with large batch sizes.",
    available: true,
  },
  {
    id: "a100-sxm4-80gb",
    model: "NVIDIA A100-SXM4-80GB",
    vramGb: 80,
    memoryBandwidthGbps: 2039,
    cudaComputeCapability: "8.0",
    recommendedMaxResolution: "4K",
    providers: ["runpod"],
    hourlyRateRunPodUsd: 1.89,
    hourlyRateVastUsd: 1.65,
    description: "Datacenter flagship with 2TB/s memory bandwidth for ultra high throughput pipelines.",
    available: true,
  },
];

export class GpuCatalog {
  public static getCatalog(provider?: "runpod" | "vast"): GpuOffer[] {
    if (!provider) return [...VERIFIED_GPU_CATALOG];
    return VERIFIED_GPU_CATALOG.filter((gpu) => gpu.providers.includes(provider));
  }

  public static getGpuById(id: string): GpuOffer | undefined {
    return VERIFIED_GPU_CATALOG.find((gpu) => gpu.id === id);
  }

  public static getGpuByModel(modelSubstring: string): GpuOffer | undefined {
    const search = modelSubstring.toLowerCase();
    return VERIFIED_GPU_CATALOG.find((gpu) => gpu.model.toLowerCase().includes(search));
  }

  public static getRecommendedGpu(
    resolution: "720p" | "1080p" | "1440p" | "4K",
    provider?: "runpod" | "vast"
  ): GpuOffer {
    const list = this.getCatalog(provider);
    if (resolution === "4K") {
      return (
        list.find((g) => g.id === "rtx-4090") ||
        list.find((g) => g.vramGb >= 24) ||
        list[0]
      );
    }
    if (resolution === "1440p") {
      return (
        list.find((g) => g.id === "rtx-3090") ||
        list.find((g) => g.vramGb >= 16) ||
        list[0]
      );
    }
    return (
      list.find((g) => g.id === "rtx-3090") ||
      list.find((g) => g.id === "rtx-3080") ||
      list[0]
    );
  }
}
