# CINEGEN AI – GPU COMPATIBILITY & SELECTION GUIDE
**Hardware Requirements for CINEFRAME and Audio AI Video Restoration**

---

## 1. Overview

CINEGEN AI's deep neural networks (CINEFRAME 3-stage visual enhancement, NOISENET speech denoiser, and STEMNET harmonic source separation) demand substantial floating-point throughput and video memory (VRAM). This guide details optimal hardware tiers across both local and cloud environments.

---

## 2. Resolution VRAM Requirements Matrix

| Target Resolution | Minimum VRAM | Recommended VRAM | Recommended Local GPU | Recommended Cloud GPU |
|---|---|---|---|---|
| **720p HD** | 6 GB | 8 GB | RTX 3060 / RX 6600 | RTX 3080 / RTX A4000 |
| **1080p Full HD** | 8 GB | 12 GB | RTX 3070 / RTX 4070 | RTX 3090 / RTX A5000 |
| **1440p Quad HD** | 12 GB | 16 GB | RTX 4080 / RX 7900 XT | RTX 3090 / RTX 4090 |
| **4K Ultra HD** | 16 GB | 24 GB+ | RTX 4090 (24GB) | RTX 4090 / A100 / RTX 6000 Ada |

---

## 3. Verified Cloud GPU Options (RunPod & Vast.ai)

| GPU Model | Architecture | VRAM | Memory Bandwidth | RunPod Hourly | Vast.ai Hourly | Best Suited For |
|---|---|---|---|---|---|---|
| **NVIDIA RTX 3080** | Ampere (8.6) | 10 GB | 760 GB/s | — | ~$0.12 | Budget 720p / 1080p |
| **NVIDIA RTX A4000** | Ampere (8.6) | 16 GB | 448 GB/s | ~$0.17 | ~$0.15 | Stable 1080p / 1440p |
| **NVIDIA RTX 3090** | Ampere (8.6) | 24 GB | 936 GB/s | ~$0.22 | ~$0.18 | **Best Value for Feature Films** |
| **NVIDIA RTX A5000** | Ampere (8.6) | 24 GB | 768 GB/s | ~$0.26 | ~$0.22 | Enterprise 1080p / 1440p |
| **NVIDIA RTX 4090** | Ada Lovelace (8.9) | 24 GB | 1008 GB/s | ~$0.34 | ~$0.29 | **Flagship 4K Restoration** |
| **NVIDIA RTX 6000 Ada** | Ada Lovelace (8.9) | 48 GB | 960 GB/s | ~$0.78 | ~$0.65 | Heavy Uncompressed 4K Sequences |
| **NVIDIA A100 SXM4** | Ampere (8.0) | 80 GB | 2039 GB/s | ~$1.89 | ~$1.65 | High-Throughput Batch Processing |

---

## 4. Local GPU Compatibility & Requirements

### 4.1 NVIDIA GPUs
- **CUDA Architecture**: Compute Capability 7.5 or higher (Turing, Ampere, Ada Lovelace, Hopper).
- **Driver**: NVIDIA Display Driver >= 525.60.
- **Backend**: TensorFlow.js uses CUDA/DirectML/WebGL acceleration where supported.

### 4.2 AMD GPUs
- DirectML or WebGL backend supported for Windows systems.
- For Linux, ROCm 5.0+ supported on RDNA2/RDNA3 architectures.

### 4.3 Apple Silicon (M1/M2/M3/M4)
- Unified Memory architecture allows running 4K models with 16GB+ or 24GB+ Unified Memory.
- WebGL backend is automatically utilized in Safari/Chromium environments.
