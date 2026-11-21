# CINEGEN AI – Local PC Setup & Resource Tuning Guide

---

## 1. Overview

**Mode B (Own PC)** runs CINEGEN AI entirely on your computer's local resources. This guide explains how to configure and tune your machine for maximum stability and throughput.

---

## 2. Hardware Diagnostics

When you open the **Compute Mode** settings page (`/compute`), CINEGEN AI runs a native diagnostic probe:
- **CPU**: Physical cores and logical threads.
- **RAM**: Installed capacity and real-time free memory.
- **GPU**: Discrete vs. integrated status and VRAM capacity.
- **Media Tools**: Verification of FFmpeg and FFprobe in your system PATH.

---

## 3. Recommended Settings by Hardware Tier

| Your System Specs | Performance Tier | Recommended Quality | Concurrency | Memory Floor |
|---|:---:|:---:|:---:|:---:|
| 8GB RAM, 4 CPU Cores | **Entry** | 720p | 1 Worker | 1.0 GB |
| 16GB RAM, 6–12 CPU Cores | **Balanced** | 1080p | 1 Worker | 2.0 GB |
| 16GB–32GB RAM + Discrete GPU (8GB+ VRAM) | **Enthusiast** | 1440p | 2 Workers | 2.0 GB |
| 32GB+ RAM + Flagship GPU (16GB+ VRAM) | **Workstation**| 4K | 2–4 Workers | 3.0 GB |

---

## 4. Tuning Controls in the UI

1. **Chunk Execution Concurrency**:
   - Set to `1 Worker` on CPU-only laptops to avoid CPU overheating and system UI freezing.
   - Set to `2 Workers` on desktop machines with 12+ threads or discrete graphics cards.
2. **Memory Safety Floor**:
   - Default: `2.0 GB`.
   - If free system memory dips below this floor during complex neural inference, CINEGEN AI automatically throttles the batch size to `1` and calls Node.js garbage collection to prevent crash errors.

---

## 5. Resuming Interrupted Jobs

CINEGEN AI automatically saves checkpoint metadata after every chunk completes:
- If your computer reboots or you close the browser, your completed chunks are preserved.
- When you reopen the application, CINEGEN AI recognizes previously processed chunks and resumes exactly where it left off with zero duplicate processing.
