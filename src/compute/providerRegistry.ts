import { IComputeProvider, ComputeProviderType } from "./types";
import { CpuComputeProvider } from "./cpuProvider";
import { GpuComputeProvider } from "./gpuProvider";
import { CloudComputeProvider } from "./cloudProvider";

export class ComputeProviderRegistry {
  private providers: Map<string, IComputeProvider> = new Map();
  private activeProviderId: string = "local-cpu-provider";

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    const cpu = new CpuComputeProvider();
    const gpu = new GpuComputeProvider();
    const cloud = new CloudComputeProvider();

    this.registerProvider(cpu);
    this.registerProvider(gpu);
    this.registerProvider(cloud);
  }

  public registerProvider(provider: IComputeProvider) {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): IComputeProvider | undefined {
    return this.providers.get(id);
  }

  public getAllProviders(): IComputeProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Automatically select the optimal healthy compute provider based on active user mode
   * User mode "cloud_gpu": Cloud GPU (with automatic Local CPU fallback)
   * User mode "own_pc": Local GPU -> Local CPU
   */
  public async resolveOptimalProvider(): Promise<IComputeProvider> {
    if (this.activeProviderId && this.providers.has(this.activeProviderId) && this.activeProviderId !== "local-cpu-provider") {
      const active = this.providers.get(this.activeProviderId);
      if (active) return active;
    }

    const providers = this.getAllProviders();
    let activeMode = "own_pc";

    try {
      const fs = require("fs");
      const path = require("path");
      const settingsPath = path.resolve(
        process.env.STORAGE_LOCAL_DIR || "./storage_data",
        "compute_settings.json"
      );
      if (fs.existsSync(settingsPath)) {
        const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        if (data.activeMode) activeMode = data.activeMode;
      }
    } catch {}

    // 1. If Cloud GPU mode requested, try Cloud first
    if (activeMode === "cloud_gpu") {
      const cloud = providers.find((p) => p.type === "cloud_gpu");
      if (cloud) {
        await cloud.initialize();
        const status = await cloud.getStatus();
        if (status === "ready") {
          this.activeProviderId = cloud.id;
          return cloud;
        }
      }
    }

    // 2. Check Local GPU
    const gpu = providers.find((p) => p.type === "local_gpu");
    if (gpu) {
      await gpu.initialize();
      const status = await gpu.getStatus();
      if (status === "ready") {
        this.activeProviderId = gpu.id;
        return gpu;
      }
    }

    // 3. Fallback to Local CPU
    const cpu = providers.find((p) => p.type === "cpu") || new CpuComputeProvider();
    await cpu.initialize();
    this.activeProviderId = cpu.id;
    return cpu;
  }

  public getActiveProvider(): IComputeProvider {
    return this.providers.get(this.activeProviderId) || new CpuComputeProvider();
  }

  public setActiveProvider(id: string): boolean {
    if (this.providers.has(id)) {
      this.activeProviderId = id;
      return true;
    }
    return false;
  }
}

export const computeRegistry = new ComputeProviderRegistry();
