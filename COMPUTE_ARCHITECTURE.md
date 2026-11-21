# CINEGEN AI — Compute Provider & Hardware Architecture

This document specifies the provider-independent compute execution architecture of CINEGEN AI.

---

## 1. Architectural Philosophy

CINEGEN AI separates high-level neural orchestration from low-level execution hardware. The compute system is designed around four foundational invariants:

1. **Vendor Independence:** The AI models and synchronization engines interact exclusively with abstract `IComputeProvider` contracts.
2. **Honest Capability Detection:** Hardware detection never reports synthetic or simulated GPU capabilities. If local GPU acceleration (WebGL/WebGPU/Node GPU) is not actively linked, the system reports `UNAVAILABLE` and falls back to CPU.
3. **Safe Cloud Offloading:** If remote cloud GPU infrastructure is not configured via environment variables, the provider reports `NOT_CONFIGURED` without throwing unhandled exceptions or inventing mock credentials.
4. **Bounded-Memory Streaming:** Media processing occurs in discrete, temporally aligned chunks, ensuring that 2- to 4-hour feature films can be processed on commodity machines without exceeding available RAM.

---

## 2. Component Taxonomy (`src/compute/`)

```
+-------------------------------------------------------------------------------+
|                             Compute Architecture                              |
+-------------------------------------------------------------------------------+

                     +----------------------------------+
                     |         DeviceDetector           |
                     |  - CPU Model, Cores, Memory      |
                     |  - GPU Hardware & TF Backend     |
                     |  - FFmpeg & FFprobe Inspection   |
                     +-----------------+----------------+
                                       |
                     +-----------------v----------------+
                     |     ComputeProviderRegistry      |
                     |  - Multi-provider registration   |
                     |  - Dynamic priority resolution   |
                     +-----------------+----------------+
                                       |
        +------------------------------+------------------------------+
        |                              |                              |
+-------v-------+              +-------v-------+              +-------v-------+
|  CpuProvider  |              |  GpuProvider  |              | CloudProvider |
|  Type: cpu    |              |Type: local_gpu|              |Type: cloud_gpu|
| Status: ready |              |Status: unavail|              |Status: not_cfg|
+---------------+              +---------------+              +---------------+
        \                              |                             /
         \                             |                            /
          +----------------------------v---------------------------+
                                       |
                     +-----------------v----------------+
                     |          JobScheduler            |
                     |  - Priority Queue (Urgent/Low)   |
                     |  - Concurrency Limiter (Max: 2-4)|
                     |  - Chunk Timeout & Retry         |
                     |  - Checkpoint Resume & Tracking  |
                     +----------------------------------+
```

### 2.1 Provider Hierarchy & Priority Resolution
When `computeRegistry.resolveOptimalProvider()` is called, it evaluates providers in order of descending computational density:
1. **Cloud GPU Provider (`cloud_gpu`):** Selected if `CLOUD_GPU_ENDPOINT` is configured, online, and healthy.
2. **Local GPU Provider (`local_gpu`):** Selected if local GPU hardware is present AND TensorFlow.js backend is active on GPU.
3. **Local CPU Provider (`cpu`):** Rock-solid baseline fallback. Always available if FFmpeg is present.

---

## 3. Dynamic Memory-Aware Batch Sizing

To prevent Out-Of-Memory (OOM) faults during high-resolution super-resolution, `CpuComputeProvider.getBatchConfig()` dynamically allocates batch sizes based on real-time free memory:

| Target Resolution | Pixels per Frame | Free RAM > 4GB | Free RAM $\le$ 4GB | Max Batch Memory |
|:---|:---:|:---:|:---:|:---:|
| **720p HD** | $1280 \times 720$ (0.92 MP) | 16 frames | 8 frames | 256 MB |
| **1080p Full HD** | $1920 \times 1080$ (2.07 MP) | 8 frames | 4 frames | 512 MB |
| **1440p Quad HD** | $2560 \times 1440$ (3.68 MP) | 4 frames | 2 frames | 768 MB |
| **4K Ultra HD** | $3840 \times 2160$ (8.29 MP) | 2 frames | 1 frame | 1024 MB |

---

## 4. Job Scheduler & Worker Pool (`src/compute/scheduler/`)

- **Task Priorities:** `urgent` (priority 10), `high` (7), `normal` (5), `low` (1).
- **Concurrency Control:** Hard concurrency limit (default: 2 workers, up to 4 on multi-core workstations).
- **Timeout Protection:** Configurable per-chunk execution timeout (default: 120s) utilizing `Promise.race()`.
- **Exponential Backoff Retry:** Failed chunks are retried up to 3 times with exponential backoff:
  $$t_{\text{backoff}} = \min(10000\text{ ms}, 1000 \times 2^{\text{attempt}}\text{ ms})$$
- **Checkpoint-Aware Resumption:** If processing is paused or interrupted, `completedChunkIndices` are recorded in the database. On resumption, completed chunks are skipped without redundant computation.
