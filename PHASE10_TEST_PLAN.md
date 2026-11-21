# CINEGEN AI — PHASE 10: REAL-WORLD TESTING & VALIDATION PLAN

**Target Release:** CINEGEN AI `v1.0.0-rc1`  
**Execution Environment:** Pure JavaScript / TypeScript (Node.js 18+, TensorFlow.js, FFmpeg)  
**Date:** November 21, 2026  
**Auditor / Agent:** Antigravity AI Engine  

---

## 1. Objective & Scope

The objective of Phase 10 is to rigorously evaluate CINEGEN AI on real-world, theatre-recorded, and uncurated video/audio capture scenarios. Synthetic test datasets used during model training simulate certain mathematical distributions (Gaussian noise, idealized geometric keystone, standard convolutive blur), but real theatre bootlegs and handheld cinema recordings introduce complex optical and acoustic artifacts:
- Off-axis optical keystoning with non-linear lens distortion.
- Mobile phone rolling shutter and high-frequency hand tremors.
- Non-uniform screen illumination, cinema projector flicker, and ambient light glare.
- Complex room acoustics (long reverberation decay, audience murmurs, phone alerts).
- Heavy mobile compression artifacts and variable frame rates (VFR).

This test plan defines the evaluation protocols, reference-free quality metrics, test matrices, and reporting structures required to determine whether CINEGEN AI delivers genuine restoration quality improvements in real-world scenarios.

---

## 2. Strict Engineering Constraints

1. **JavaScript & TypeScript Only**: All test harnesses, metric calculators, and image processing tools must run natively under Node.js. Absolutely zero Python scripts or Python libraries are allowed.
2. **Cleanroom & Model Weight Integrity**: Existing neural network checkpoints (`CINEVISION`, `CINEFRAME`, `NOISENET`, `STEMNET`) and training datasets must remain strictly preserved. No random weights or external AI APIs may be introduced.
3. **No Metric Fabrication**: If a ground-truth original movie master is unavailable (as is typical for real bootleg recordings), **do not report synthetic PSNR or SSIM**. Reference-free metrics (Laplacian edge energy, noise variance, temporal difference flicker variance, spectral flatness) and qualitative expert assessments must be used.
4. **Legal & Ethical Boundaries**: No unauthorized copyrighted theatrical films will be downloaded, scraped, or redistributed. Evaluation must use authorized recordings, held-out open commons test footage (`clean_source_4` and `clean_source_10`), or realistic optical test vectors. Conditions with no available physical recording will be explicitly marked **NOT TESTED**.
5. **Conservative Audio Gating**: `ECHONET` (dereverberation) and `VOICENET` (speech enhancement) remain bypassed by default unless empirical tests demonstrate measurable gain without dialogue damage.

---

## 3. Real-World Condition Test Matrix

Ten distinct capture conditions are specified:

| Profile ID | Condition Description | Primary Artifacts Simulated / Tested | Key Evaluation Metrics |
| :--- | :--- | :--- | :--- |
| **RW-01** | **Rear-Centre Recording** | Distance defocus blur, optical keystoning, low-contrast washed black levels | Sharpness gain, edge preservation, screen boundary accuracy |
| **RW-02** | **Side-Angle Recording** | Severe perspective tilt, trapezoidal distortion, asymmetric blur | Perspective correction matrix, aspect ratio retention |
| **RW-03** | **Front-Row Recording** | Upward vertical keystone, close-range screen curvature, neck-angle tilt | Geometric alignment, corner sharpness |
| **RW-04** | **Handheld Camera Shake** | High-frequency jitter, rolling shutter distortion, motion blur | Temporal difference variance ($\sigma^2_{\Delta t}$), frame stability |
| **RW-05** | **Low-Light & Uneven Lighting** | Sensor shot noise, chroma noise in shadow regions, washed out dynamic range | Immerkaer noise variance, local contrast ratio |
| **RW-06** | **Screen Glare & Reflections** | Specular exit-sign reflection, glass refraction, localized glare spots | Contrast degradation, artifact mitigation |
| **RW-07** | **Moiré Patterns & Flickering** | Aliasing from camera sensor vs. screen pixel grid, 24Hz/60Hz beat frequency flicker | Frame-to-frame luminance variance, frequency spectrum |
| **RW-08** | **Audience Obstruction** | Silhouettes of heads, audience movement in bottom third of frame | Edge boundary preservation, avoidance of hallucinated infill |
| **RW-09** | **Mobile Low-Res Quality** | 480p/720p capture, mobile digital zoom, sensor noise, aggressive ISP sharpening | 2× Super-resolution detail recovery vs. over-sharpening halo |
| **RW-10** | **Heavy Compression Artifacts** | Low-bitrate H.264/H.265 macroblocking, banding, DCT ringing | Macroblock smoothing vs. real edge retention |

---

## 4. Evaluation Methodology & Metrics

### 4.1 Reference-Free Video Quality Metrics
When evaluating real-world video where ground-truth digital film masters are unavailable, the following objective reference-free mathematical metrics are employed:

1. **Laplacian Edge Energy Variance ($\text{Var}(\nabla^2 I)$)**:
   $$\text{Var}(\nabla^2 I) = \frac{1}{N} \sum_{(x,y)} (\nabla^2 I(x,y) - \mu_{\nabla^2})^2$$
   Quantifies high-frequency edge definition and sharpness. A higher value indicates sharper boundaries, provided it is not driven by noise.
2. **Immerkaer Fast Noise Variance ($\sigma_n^2$)**:
   $$\sigma_n^2 = \frac{\pi}{2} \frac{1}{6(W-2)(H-2)} \sum |I * K_{\text{noise}}|$$
   Where $K_{\text{noise}} = \begin{bmatrix} 1 & -2 & 1 \\ -2 & 4 & -2 \\ 1 & -2 & 1 \end{bmatrix}$. Measures additive sensor noise independent of image structure.
3. **Temporal Inter-Frame Difference Variance ($\text{TIDV}$)**:
   $$\text{TIDV} = \text{Var}(I_{t} - I_{t-1})$$
   Measures temporal stability, flickering, and motion inconsistency between consecutive video frames. Lower variance across static regions indicates high temporal coherence.
4. **Sobel Edge Gradient Magnitude**:
   Measures structural edge definition across horizontal and vertical gradients.

### 4.2 5-Way Video Restoration Comparison
Every video scenario is evaluated across five parallel branches:
1. **Original Input**: Unprocessed capture.
2. **FFmpeg Baseline**: Conventional non-AI filtering (Bicubic upscaling + unsharp filter `unsharp=5:5:0.8:5:5:0.0`).
3. **CINEVISION Only**: Perspective and keystone analysis pass.
4. **CINEFRAME Only**: Neural 2× residual super-resolution.
5. **Full CINEGEN Pipeline**: Full end-to-end processing with CINESYNC.

### 4.3 Audio Quality Metrics
Audio performance is evaluated under real acoustic theatre conditions (crowd chatter, echo/reverb, distortion, hiss, low dialogue, music):
- **SDR & SI-SDR**: Signal-to-Distortion Ratio and Scale-Invariant SDR where paired reference audio is available.
- **Spectral Flatness Measure (SFM)**: Distinguishes tonal signals from white noise / hiss.
- **High-Frequency Noise Energy Ratio ($E_{>8\text{kHz}} / E_{\text{total}}$)**: Quantifies reduction of background hiss.
- **Dynamic Crest Factor**: Peak-to-RMS ratio measuring dynamic range preservation.
- **Clipping Count**: Samples saturated at $\ge 0.999$.

---

## 5. Pipeline & Hardware Scalability Matrix

Full workflow verification will be tested across:
- **30-Second Clip**: Full inference on Local CPU.
- **1-Minute Clip**: Full inference on Local CPU.
- **5-Minute Media**: Multi-chunk pipeline processing with CINESYNC.
- **10-Minute Media**: Multi-chunk scalability and memory stability.
- **Long-Duration (1–4 Hours)**: Integer chunk boundary alignment and interruption recovery verification.

Hardware testing monitors:
- Host CPU core utilization (AMD Ryzen 5 7430U, 12 threads).
- Process RAM usage & dynamic memory floor throttling ($< 2.0\text{ GB}$).
- Per-frame processing speed (latency in milliseconds).
- Disk storage overhead for intermediate video chunks.
- Resumption from atomic checkpoints after simulated interruption.

---

## 6. Phase 10 Deliverables & Reporting Structure

Upon execution of the test suite, the following eight markdown reports will be generated:
1. `PHASE10_TEST_PLAN.md` (This document)
2. `PHASE10_DATASET_REPORT.md` (Real-world dataset manifest and condition profiles)
3. `PHASE10_VIDEO_QUALITY_REPORT.md` (Empirical metrics, 5-way comparisons, reference-free analysis)
4. `PHASE10_AUDIO_QUALITY_REPORT.md` (NOISENET, STEMNET, ECHONET, VOICENET acoustic evaluations)
5. `PHASE10_PIPELINE_REPORT.md` (End-to-end integration, CINESYNC, failure recovery, duration scalability)
6. `PHASE10_PERFORMANCE_REPORT.md` (Resource utilization, CPU/RAM benchmarks, memory throttling)
7. `PHASE10_BUG_REPORT.md` (Root-cause analysis and fixes for any identified defects)
8. `PHASE10_FINAL_REPORT.md` (Comprehensive Phase 10 synthesis and release verdict)
