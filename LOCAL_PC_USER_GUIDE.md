# CINEGEN AI – LOCAL PC USER GUIDE (MODE B)
**Offline, Private Video Restoration on Your Computer's Hardware**

---

## 1. Overview

**Mode B – Own PC** allows you to execute CINEGEN AI's entire neural restoration suite locally on your computer:
- **100% Private**: Your video and audio files never leave your computer.
- **Zero Cost**: Completely free with no API keys or cloud accounts needed.
- **Offline Capable**: Works with no internet connection once installed.

---

## 2. Hardware Diagnostics & Capability Advisor

When you navigate to **Compute Mode** (`/compute`) and select **Mode B – Own PC**, CINEGEN AI performs a native hardware probe:

### Inspected Metrics:
- **Processor (CPU)**: Model, physical core count, logical thread count, base clock.
- **Memory (RAM)**: Total installed RAM, real-time free RAM, utilization percentage.
- **Graphics (GPU)**: Model, dedicated VRAM, discrete vs. integrated status.
- **Media Acceleration**: FFmpeg / FFprobe availability.
- **Storage**: Free disk space for intermediate video chunks.

### Performance Tiers:
- **Workstation (32GB+ RAM, 16GB+ VRAM GPU)**: Optimal for native 4K restoration.
- **Enthusiast (16GB+ RAM, 8GB+ VRAM GPU)**: High performance for 1440p and 1080p.
- **Balanced (12GB+ RAM, 6+ CPU Cores)**: Recommended for 720p and 1080p.
- **Entry (8GB RAM, 4 CPU Cores)**: Recommended for 720p restoration.

---

## 3. Tuning Local Resource Controls

### 3.1 Concurrency (Parallel Workers)
- **1 Worker (Recommended for CPU-only systems)**: Prevents CPU starvation and excessive RAM consumption.
- **2 Workers (Recommended for 16GB+ RAM or dedicated GPUs)**: Processes two chunks in parallel.
- **4 Workers (Recommended for high-end workstations)**: Maximum throughput.

### 3.2 Memory Safety Margin
- Configure the memory safety floor (e.g. **2.0 GB**).
- If your system's free RAM drops below this limit during a complex neural pass, CINEGEN AI automatically throttles the batch size to `1` and triggers garbage collection to prevent out-of-memory errors.

---

## 4. Expected Processing Speeds on CPU

Because modern deep neural networks (CINEFRAME and Audio AI) are computationally intensive, local CPU restoration requires patience:
- **720p Video**: ~1.5x to 2.5x real-time (A 10-minute video takes ~15–25 minutes).
- **1080p Video**: ~2.5x to 4.5x real-time (A 10-minute video takes ~25–45 minutes).
- **4K Video**: Not recommended on CPU. Consider using **Mode A (Cloud GPU)** for 4K.

---

## 5. Resuming Interrupted Jobs

If you close the application or your computer reboots during a long restoration job:
1. Re-open CINEGEN AI.
2. The job queue recognizes all previously completed chunks.
3. Click **Resume** to continue processing from the last saved chunk with zero redundant processing.
