# CINEGEN AI — PHASE 10: PERFORMANCE & RESOURCE PROFILING REPORT

**Evaluation Scope:** Local PC Hardware Profiling, CPU Neural Latency, Memory Ceiling, Storage Footprint, and Cloud GPU Distinction  
**Hardware Profile:** AMD Ryzen 5 7430U (6 Cores / 12 Threads), 16GB DDR4 RAM, Integrated Radeon Graphics  
**Date:** November 21, 2026  
**Auditor / Agent:** Antigravity AI Engine  

---

## 1. Executive Summary

Phase 10 evaluated the operational performance, memory stability, and storage consumption of CINEGEN AI under real processing conditions. Because consumer laptops often lack discrete CUDA hardware, local PC execution relies primarily on multi-threaded CPU inference. This report details measured latency figures, dynamic memory safety throttling, intermediate storage requirements, and the distinction between simulated cloud tests and paid live provisioning.

---

## 2. Hardware Diagnostics & Resource Utilization

| Resource | Detected Specification | Operating State | Performance Notes |
| :--- | :--- | :--- | :--- |
| **CPU** | AMD Ryzen 5 7430U | 12 Logical Threads | Multi-threaded CPU execution active via Node.js worker pools |
| **System RAM** | 15.33 GB Total | 6.86 GB Free | Dynamic batching throttles batch size to 1 if free RAM $< 2.0\text{ GB}$ |
| **Local GPU** | Integrated Radeon Graphics | Shared System Memory (0 GB Discrete VRAM) | Classified as `Integrated`; GPU hardware acceleration marked `false` |
| **Inference Backend** | TensorFlow.js CPU | Pure CPU Native Fallback | Multi-platform portable; zero Python dependencies |
| **Media Tools** | FFmpeg 8.1.1 & FFprobe | System PATH Accessible | Fast stream chunking, demuxing, and H.264/AAC encoding |

---

## 3. Neural Inference Latency & Speed Benchmark

CINEFRAME was benchmarked on consecutive video frames at $640 \times 360 \longrightarrow 1280 \times 720$:

- **Frame 1 Latency:** 374 ms (Cold start / tensor compilation)
- **Frame 2 Latency:** 294 ms
- **Frame 3 Latency:** 283 ms
- **Frame 4 Latency:** 263 ms
- **Frame 5 Latency:** 262 ms
- **Average Frame Latency:** **295.4 ms**
- **Sustained Throughput:** **3.38 frames/sec on CPU**
- **Process Memory (RSS):** Started at 74.9 MB, peaked at 108.4 MB (Delta: **+33.5 MB**)

### Practical Runtime Implications for Users:
- **5-Second Clip (120 frames):** $\approx 35\text{ seconds}$ on CPU.
- **1-Minute Clip (1,440 frames):** $\approx 7.1\text{ minutes}$ on CPU.
- **1-Hour Feature Film (86,400 frames):** $\approx 7.1\text{ hours}$ on CPU.
- **Recommendation:** Users running feature films should either execute batch processing overnight on local PC or utilize Mode A (Cloud GPU) for $\approx 20\text{x}$ faster turnaround ($\approx 21\text{ minutes}$ on an RTX 3090).

---

## 4. Storage Footprint & Scratch Management

Processing video via multi-chunk segmentation generates intermediate raw audio and video chunks:

| Video Length | Target Quality | Estimated Intermediate Chunk Storage | Scratch Space Required | Auto-Cleanup Active |
| :---: | :---: | :---: | :---: | :---: |
| **30 Seconds** | 720p | 3 chunks ($\approx 7.5\text{ MB}$ each) | $\approx 22.5\text{ MB}$ | Yes |
| **10 Minutes** | 1080p | 60 chunks ($\approx 12.0\text{ MB}$ each) | $\approx 720.0\text{ MB}$ | Yes |
| **1 Hour** | 1080p | 120 chunks ($\approx 22.0\text{ MB}$ each) | $\approx 2.64\text{ GB}$ | Yes |
| **4 Hours** | 1080p | 480 chunks ($\approx 22.0\text{ MB}$ each) | $\approx 10.55\text{ GB}$ | Yes |

*Note: `VideoProcessingPipeline` automatically cleans up intermediate chunks in `storage_data/jobs/<id>` upon successful job completion.*

---

## 5. Cloud GPU Integration & Live vs. Mock Distinction

To uphold strict truthfulness and protect tester finances:

1. **Provider Client Code:** **VERIFIED**. Full TLS HTTP/GraphQL client implementation exists for RunPod (`/graphql`) and Vast.ai (`/api/v0/`).
2. **Credential Security:** **VERIFIED**. Personal user API keys are encrypted at rest with AES-256-GCM.
3. **GPU Catalog & Cost Estimator:** **VERIFIED**. 7 GPU tiers cataloged; cost estimation calculates realistic billable hours.
4. **Live Paid Provisioning:** Marked **NOT_RUN**. No paid cloud instances were provisioned during automated test runs. Paid cloud resources are gated behind explicit user confirmation modals and require user-funded accounts.
