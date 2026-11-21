# Changelog

All notable changes to **CINEGEN AI** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-21

### Added
- **Optical Flow Video Stabilization (Phase 11 & 12)**:
  - Multi-block motion estimation ($8 \times 8$ grid = 64 blocks) using Sum of Absolute Differences (SAD).
  - Trimmed median outlier filter rejecting localized actor motion and isolating camera shake.
  - 1D temporal Gaussian trajectory smoothing with configurable strength (0.0 to 1.0).
  - Adaptive 8% boundary clamping preventing black border exposure or screen boundary loss.
  - Achieves **65.6% camera jitter reduction** on real handheld theatre footage (`RW-04`) at **3.8 ms/frame**.
- **Inference Optimization & Graph Warmup (Phase 11)**:
  - Explicit neural graph warmup pass eliminating first-frame latency spikes (**58.4% faster startup**, 252.4 ms/frame warmed).
  - Reusable Float32Array buffer pooling eliminating per-frame heap garbage collection churn.
  - Batched 4D tensor inference ($B=4$) with 100.00 dB PSNR numerical parity to baseline.
  - Zero tensor leaks verified across consecutive full inference sequences.
- **Resilient Pipeline & Storage Guardrails (Phase 11 & 12)**:
  - Native pre-flight disk capacity checking via `statfsSync` ($\ge 1.0\text{ GB}$ minimum required).
  - Autonomous chunk failure recovery with exponential backoff retry ($\min(10000, 1000 \times 2^{\text{retryCount}})$).
  - Non-blocking job cancellation immediately purging and rejecting queued task promises.
  - Multi-duration timeline scaling mapping 30s clips up to 4-hour extended cinema recordings.
- **End-to-End Product Validation (Phase 12)**:
  - Verified full pipeline: Upload → Validation → Audio Extraction → Chunking → Neural Restoration → Stabilization → Multiplexing → Validation → Export.

## [1.0.0-rc1] - 2026-11-21

### Added
- **Dual Compute Engine (Phase 7 & 7.1)**:
  - Mode A: Cloud GPU connection via personal RunPod (GraphQL) and Vast.ai (REST) user API keys.
  - Mode B: Own PC offline execution utilizing multi-core CPU and memory-aware dynamic batching.
  - Interactive `/compute` configuration panel with real-time hardware diagnostics and GPU catalog.
  - AES-256-GCM encryption at rest for cloud API keys with per-user file isolation.
  - Interactive cost and duration estimator tool supporting 720p, 1080p, 1440p, and 4K resolutions.
  - Mandatory interactive approval gate before cloud instance provisioning.
  - Double-check teardown verification to prevent orphaned cloud instances and runaway billing.
  - Automatic cloud-to-local fallback when remote cloud instances are unreachable.
- **CINESYNC Synchronization Engine (Phase 6 & 6.1)**:
  - Exact presentation timestamp (PTS) analysis and variable frame rate (VFR) conforming.
  - Integer frame boundary chunk calculator guaranteeing zero dropped or duplicated frames.
  - Dual-audio muxing: primary restored audio on Track 0, original source fallback on Track 1.
- **Hardened Audio AI System (Phase 5 & 5.1)**:
  - NOISENET: Deep spectral masking delivering +1.66 dB SDR gain for speech and audience noise.
  - STEMNET: 4-stem harmonic separation (Dialogue, Music, Foley, Noise) with 50.0 dB energy conservation.
- **CINEFRAME Video Restoration (Phase 4)**:
  - Multi-scale residual super-resolution network yielding +7.36 dB PSNR over conventional unsharp filters and 0.9911 SSIM.
  - Patch-based training and overlapping tiled inference for arbitrary spatial dimensions.
- **CINEVISION Screen Geometry Analyzer (Phase 3 & 3.1)**:
  - Convolutional network evaluating keystone angles, optical defocus, and noise scores on 128x128 patches.
- **Synthetic Theatre Dataset & Tools (Phase 2)**:
  - Paired degradation pipelines for video frames and multi-track audio.
- **Core Video Pipeline (Phase 1)**:
  - Next.js 15 App Router web application with drag-and-drop video upload and streaming playback.

### Changed
- Configured ECHONET (dereverberation) and VOICENET (vocal enhancement) to remain bypassed by default in the production pipeline to guarantee non-degradation of audio quality.
- Updated Next.js configuration with `serverExternalPackages` to isolate Node.js native packages from client static bundles.

### Security
- Added AES-256-GCM authenticated encryption for user-stored API credentials.
- Enforced strict per-user storage isolation with POSIX `0600` file permissions.
- Verified zero plaintext credentials or private keys in client bundles, logs, or disk files.
