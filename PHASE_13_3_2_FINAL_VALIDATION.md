# CINEGEN AI — PHASE 13.3.2: FINAL CINEFRAME TECHNICAL VALIDATION

**Validation Date:** November 21, 2026  
**Status:** COMPLETE & EMPIRICALLY VALIDATED  
**Classification:** Read-Only Technical Architecture Validation  
**Target Subsystem:** `CINEFRAME` Temporal Video Super-Resolution & Enhancement  
**Workspace Path:** ``

---

## EXECUTIVE SUMMARY & FINAL VERDICT

| Investigation Domain | Finding & Validation Status | Verdict |
| :--- | :--- | :--- |
| **1. Hann Window Mathematics** | The naive 1D formula from Phase 13.3.1 fails at image boundaries (vignettes to 0) and at irregular final tiles (weights spike to 4.0 in 2D corners, causing 300% brightness seams). Formulated and tested **Normalized Weight-Accumulation Blending** ($I_{out} = \frac{\sum W_k I_k}{\sum W_k}$), which achieves **$0.0000$ constant error** and **$2.3 \times 10^{-7}$ gradient error**. | **VALIDATED WITH CORRECTION** |
| **2. Receptive Field Calculation** | Layer-by-layer audit reveals the exact theoretical receptive field is **13 input pixels** (NOT 17 pixels as previously approximated). The padding boundary attenuation region is strictly **6 input pixels** (12 output pixels). The 32px tile overlap ($16\text{ px}$ margin) provides a **$2.67\times$ safety factor**. | **VERIFIED & CORRECTED (13 px)** |
| **3. Dynamic Resolution Stability** | The FCN architecture is strictly translation-equivariant. Direct comparison of $256 \times 256$ full inference against isolated $64 \times 64$ sub-crops demonstrated **$0.0000\text{e}+0$ feature deviation** in the central receptive zone. Output ranges and distributions remain stable. | **VALIDATED (Translation Equivariant)** |
| **4. GPU Feasibility & Limitations** | Host system has AMD Ryzen 5 7430U (integrated Radeon Graphics); no NVIDIA CUDA GPU exists. TensorFlow.js only has `cpu` registered. **All GPU figures are explicitly marked as UNVERIFIED THEORETICAL ESTIMATES**. Conservative VRAM requirements: 720p: 2GB; 1080p: 4GB; 1440p: 6GB; 4K: 8–12GB. | **UNVERIFIED (Host is CPU-Only)** |
| **5. Temporal Overlap & Audio Sync** | Validated with real frame-indexing test across 240 frames ($R=1$). Boundary frames are strictly used as temporal context and trimmed before chunk output. **Output frame count $\Delta = 0$ frames ($0.000\text{ ms}$ audio drift)**. | **VALIDATED (Strict $\pm 1$ Trimming)** |
| **6. Training Readiness** | Checkpoint is functional for integration testing but unready for production theatre restoration (trained on synthetic $24\times 24$ crops). Outlined full training pipeline for $128\times 128 / 256\times 256$ patches with video-disjoint splits and temporal loss. | **ACTIONABLE BLUEPRINT DEFINED** |

### Overall Verdict: **CONDITIONAL GO**

Proceed to Phase 13.3 implementation subject to:
1. **Mandatory Normalized Blending:** Use explicit accumulator weight normalization ($I = \sum W_k I_k / \sum W_k$) instead of naive piecewise Hann weighting.
2. **GPU Gating with FFmpeg Fallback:** Because pure JS CPU inference is $\sim 213\text{ s/frame}$ at 1080p and no CUDA GPU is active, Node.js workers must default to FFmpeg Lanczos scaling until native GPU bindings are provisioned.
3. **Exact $\pm 1$ Frame Trimming:** Never emit boundary context frames into chunk media containers.

---

## 1. HANN WINDOW MATHEMATICS & BLENDING VERIFICATION

### 1.1 Mathematical Formulation of Proposed Naive Blending
In Phase 13.3.1, the 1D raised-cosine window was proposed:

$$w_{1D}(x) = \begin{cases} 
\frac{1}{2} \left[ 1 - \cos\left( \frac{\pi (x + 0.5)}{O} \right) \right], & 0 \le x < O \\
1.0, & O \le x < W_{\text{tile}} - O \\
\frac{1}{2} \left[ 1 - \cos\left( \frac{\pi (W_{\text{tile}} - x - 0.5)}{O} \right) \right], & W_{\text{tile}} - O \le x < W_{\text{tile}}
\end{cases}$$

### 1.2 Identified Mathematical & Structural Flaws
Through empirical testing on a standard 1080p ($1920 \times 1080$) grid with tile dimensions $W = 256, H = 256, O = 32$, two fatal issues were exposed in the naive formulation:

1. **Outer Boundary Vignetting (Zero-Weight Attenuation):**
   - At outer image boundaries ($x < O$ or $x > \text{Width} - O$), there is no adjacent neighbor tile to provide the complementary cosine half $\frac{1}{2}[1 + \cos(\cdot)]$.
   - Consequently, the naive weights drop to $0.0$ at the perimeter borders, causing severe black vignetting and contrast collapse at the image edges.
2. **Irregular Tile Overlap (Brightness Seam Spikes):**
   - A 1080p frame ($1920 \times 1080$) is not an integer multiple of the nominal tile stride $S = W - O = 224$:
     $$\frac{1920}{224} = 8.5714, \quad \frac{1080}{224} = 4.8214$$
   - The final horizontal tile must be clamped to $x = 1920 - 256 = 1664$.
   - The preceding tile was placed at $7 \times 224 = 1568$.
   - The actual overlap between these tiles is:
     $$O_{\text{actual}} = 1568 + 256 - 1664 = 160 \text{ pixels}$$
   - Because $160\text{ px} \gg 32\text{ px}$, both tiles evaluate to $w = 1.0$ across a $96\text{-pixel}$ band. When summed naively without division, the accumulated weight reaches **$2.0$** (and up to **$4.0$** at 2D corners).
   - This creates massive **bright bands and grid line seams** (+300% luminance error).

### 1.3 Corrected Mathematical Implementation: Normalized Partition of Unity
To guarantee mathematical Partition of Unity across arbitrary image resolutions and irregular overlaps, blending must perform **Explicit Weight Accumulation and Normalization**:

$$I_{\text{out}}(x, y) = \frac{\sum_{k=1}^{K} W_k(x, y) \cdot I_k(x, y)}{\sum_{k=1}^{K} W_k(x, y)}$$

Where each tile's weight $W_k(x, y)$ is defined by a 2D separable continuous Hann window:
$$w_{\text{tile}}(u, v) = \max\left( \epsilon, \; \frac{1}{4} \left[ 1 - \cos\left( \frac{2\pi (u + 0.5)}{W_{\text{tile}}} \right) \right] \left[ 1 - \cos\left( \frac{2\pi (v + 0.5)}{H_{\text{tile}}} \right) \right] \right)$$
where $\epsilon = 10^{-4}$ guarantees that the denominator $\sum_k W_k(x, y) > 0$ strictly everywhere.

### 1.4 JavaScript Test Results (`scripts/test_phase13_3_2_validation.js`)
A rigorous test was executed on a 1080p canvas with $45$ tiles ($9 \times 5$ grid):

| Test Condition | Metric | Naive Phase 13.3.1 Formula | Corrected Normalized Accumulation |
| :--- | :--- | :--- | :--- |
| **Weight Map Range** | $[\min W, \max W]$ | $[0.0000, 4.0000]$ (Fatal) | $[0.0001, 1.3826]$ |
| **Uncovered / Zero Pixels** | Pixel count ($W = 0$) | 0 | 0 |
| **Constant Image Test ($I = 1.0$)** | Max Seam Error $|\hat{I} - 1.0|$ | **3.0000 (300% Error)** | **$0.0000\text{e}+0$ (Exact Preservation)** |
| **Linear Gradient Test** | Max Boundary Discontinuity | **2.7989** | **$2.2973 \times 10^{-7}$ (Smooth)** |

The corrected normalized blending algorithm completely eliminates brightness seams and edge vignetting.

---

## 2. RECEPTIVE FIELD & BOUNDARY REGION VERIFICATION

### 2.1 Layer-by-Layer Architectural Trace
A layer-by-layer inspection of the actual CINEFRAME computational graph (`src/ai/cineframe/model.ts` and `scripts/train_and_evaluate_cineframe.js`) was performed:

| Sequential Stage / Layer | Layer Class | Kernel Size | Stride | Padding | Output Filters | Input-Domain RF |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Input** | `tf.input` | — | — | — | 9 | $1 \text{ px}$ |
| **`stageA_temporal_conv`** | `Conv2D` | $3 \times 3$ | 1 | `same` | 16 | $1 + (3-1) = \mathbf{3 \text{ px}}$ |
| **`stageA_temporal_attn`** | `Conv2D` | $1 \times 1$ | 1 | `same` | 16 | $3 \text{ px}$ |
| **`stageA_attended_fusion`** | `Multiply` | — | — | — | 16 | $3 \text{ px}$ |
| **`rdb_0_c1`** | `Conv2D` | $3 \times 3$ | 1 | `same` | 16 | $3 + (3-1) = \mathbf{5 \text{ px}}$ |
| **`rdb_0_c2`** | `Conv2D` | $3 \times 3$ | 1 | `same` | 16 | $5 + (3-1) = \mathbf{7 \text{ px}}$ |
| **`rdb_0_add`** | `Add` | — | — | — | 16 | $7 \text{ px}$ |
| **`rdb_1_c1`** | `Conv2D` | $3 \times 3$ | 1 | `same` | 16 | $7 + (3-1) = \mathbf{9 \text{ px}}$ |
| **`rdb_1_c2`** | `Conv2D` | $3 \times 3$ | 1 | `same` | 16 | $9 + (3-1) = \mathbf{11 \text{ px}}$ |
| **`rdb_1_add`** | `Add` | — | — | — | 16 | $11 \text{ px}$ |
| **`global_residual_add`** | `Add` | — | — | — | 16 | $11 \text{ px}$ |
| **`stageC_upsample_2x`** | `UpSampling2D` | $[2, 2]$ | — | — | 16 | $11 \text{ px}$ ($2\times$ spatial scale) |
| **`stageC_refine_conv`** | `Conv2D` | $3 \times 3$ | 1 | `same` | 12 | $11 + (3-1)\times 0.5 = \mathbf{12 \text{ px}}$ |
| **`residual_detail_map`** | `Conv2D` | $3 \times 3$ | 1 | `same` | 3 | $12 + (3-1)\times 0.5 = \mathbf{13 \text{ px}}$ |
| **`output_restored_frame`** | `Add` | — | — | — | 3 | $\mathbf{13 \text{ px}}$ |

### 2.2 Receptive Field Finding
- **Reported in Phase 13.3.1:** 17 pixels (based on an approximate estimation assuming 8 consecutive input-domain convolutions).
- **Exact Verified Receptive Field:** **13 input pixels** (corresponds to $26\text{ pixels}$ in the $2\times$ upscaled output coordinate space).

### 2.3 Padding Attenuation & Overlap Sufficiency
- With `padding: 'same'`, zeros bleed inwards from the tile boundary:
  $$\text{Boundary Bleed Margin} = \frac{\text{RF}_{\text{input}} - 1}{2} = \frac{13 - 1}{2} = \mathbf{6 \text{ input pixels}}$$
  (In the $2\times$ output space, this corresponds to $12\text{ output pixels}$).
- With the proposed tile overlap of $O = 32\text{ pixels}$, each tile contributes a valid boundary margin of $\frac{O}{2} = 16\text{ input pixels}$.
- **Safety Factor:**
  $$\text{Safety Factor} = \frac{16\text{ px}}{6\text{ px}} = \mathbf{2.67\times}$$
- **Conclusion:** An overlap of $32\text{ pixels}$ strictly and safely exceeds the $6\text{-pixel}$ padding attenuation boundary.

---

## 3. DYNAMIC RESOLUTION & TRAINING DISTRIBUTION (64×64 vs 256×256)

### 3.1 Translation Equivariance Verification
Because CINEFRAME contains zero fully-connected/dense layers and uses only spatial 2D convolutions and point-wise operations, its response is mathematically **translation equivariant**.

To prove this empirically, a synthetic test was executed comparing:
1. Direct full-frame inference on a $256 \times 256$ input tensor.
2. Inference on a cropped $64 \times 64$ patch extracted from the exact center $[96\dots 160, 96\dots 160]$ of the same input tensor.

**Result:**
- Beyond the $6\text{-pixel}$ receptive field boundary margin, the maximum feature deviation between the $256 \times 256$ inference output and the cropped $64 \times 64$ inference output was:
  $$\text{Max Deviation} = \mathbf{0.0000\text{e}+0}$$
- This confirms exact mathematical consistency.

### 3.2 Output Range and Stability
Evaluating the restored weights (`storage_data/checkpoints/cineframe/best`) across resolutions:
- **$64 \times 64$ Input:** Output shape $[1, 128, 128, 3]$; Range $[-0.0865, 1.0764]$; Mean $0.4965$.
- **$256 \times 256$ Input:** Output shape $[1, 512, 512, 3]$; Range $[-0.1030, 1.1007]$; Mean $0.4925$.
- Output distributions are virtually identical, confirming numerical stability across spatial scales.

### 3.3 Training Distribution Limitations
- While the architecture accepts $256 \times 256$ dynamically, the current checkpoint was trained on $24 \times 24 \to 48 \times 48$ synthetic patches.
- Synthesized degradations only modeled Gaussian noise and box blur.
- The model has not learned features for non-uniform projector defocus, theatre lens distortion, or camera shutter flicker.
- Synthetic mathematical stability must **not** be confused with real-world cinema restoration performance.

---

## 4. GPU FEASIBILITY & ENVIRONMENT HARDWARE AUDIT

### 4.1 Host Hardware Environment Inspection
A direct inspection of the host runtime environment was conducted:
1. **Physical GPU Availability:**
   - Host CPU: AMD Ryzen 5 7430U with Radeon Graphics.
   - Command `nvidia-smi` exited with `CommandNotFoundException`.
   - No discrete NVIDIA CUDA GPU is installed on the host.
2. **TensorFlow.js Backend Registry:**
   - Evaluated `Object.keys(tf.engine().registryFactory)`:
     $$\text{Available Backends: } [\text{'cpu'}]$$
   - `@tensorflow/tfjs-node` (C++ libtensorflow), `@tensorflow/tfjs-node-gpu` (CUDA), and `@tensorflow/tfjs-backend-webgpu` are **not installed** in `package.json`.
3. **Explicit Disclosure:**
   In compliance with the audit protocol, **all GPU figures below are explicitly marked as UNVERIFIED THEORETICAL ESTIMATES based on cuDNN tensor modeling, because no compatible physical GPU exists in the current environment.**

### 4.2 Conservative Hardware Requirements Matrix

| Target Resolution | Input Size ($H \times W$) | Tiles / Frame ($256\times 256$, 32px overlap) | Peak GPU Memory per Frame ($B=1$) | Recommended Minimum VRAM | Fallback Trigger Condition |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **720p** | $720 \times 1280$ | 20 | ~0.85 GB | **2.0 GB** | GPU unavailable OR VRAM $< 2\text{ GB}$ |
| **1080p** | $1080 \times 1920$ | 45 | ~1.65 GB | **4.0 GB** | GPU unavailable OR VRAM $< 4\text{ GB}$ |
| **1440p** | $1440 \times 2560$ | 77 | ~2.70 GB | **6.0 GB** | GPU unavailable OR VRAM $< 6\text{ GB}$ |
| **4K** | $2160 \times 3840$ | 165 | ~5.20 GB | **8.0 – 12.0 GB** | GPU unavailable OR VRAM $< 8\text{ GB}$ |

**Conclusion on GPU Feasibility:**
A 4GB GPU is sufficient for up to 1080p video, but **cannot support 1440p or 4K batched processing** without severe memory thrashing or out-of-memory crashes. Production deployment must enforce resolution-tiered VRAM checks.

---

## 5. TEMPORAL OVERLAP & AUDIO SYNCHRONIZATION VERIFICATION

### 5.1 Radius-1 Sliding Window Verification
CINEFRAME requires $R=1$ temporal context ($I_{t-1}, I_t, I_{t+1}$).
Across chunk boundaries, the indexing was verified through a deterministic 240-frame multi-chunk test:
- Video frames: $0$ to $239$ ($10\text{ seconds}$ at $24\text{ fps}$).
- Chunks: 4 chunks of 72, 72, 72, and 24 frames.

### 5.2 Deterministic Frame Indexing Rules
1. **Extraction Range for Chunk $k$ ($[t_{\text{start}}, t_{\text{end}}]$):**
   $$\text{Extracted Frames} = [\max(0, t_{\text{start}} - 1), \dots, \min(T - 1, t_{\text{end}} + 1)]$$
2. **Boundary Padding (First / Last Video Frames):**
   - At $t=0$: replicate initial frame $I_0$ as temporal prefix ($[0, 0, 1]$).
   - At $t=T-1$: replicate final frame $I_{T-1}$ as temporal suffix ($[T-2, T-1, T-1]$).
3. **Scene-Cut Transition Handling:**
   - When a scene cut occurs at $t_{\text{cut}}$, clamp context:
     $$\text{For } t = t_{\text{cut}} - 1: I_{t+1} \leftarrow I_t, \quad \text{For } t = t_{\text{cut}}: I_{t-1} \leftarrow I_t$$
4. **Mandatory Post-Inference Boundary Trimming:**
   - Neural inference produces enhanced frames for all valid triplets.
   - The first frame and last frame of the chunk output are **discarded**:
     $$\text{Chunk Output Frames} = [\hat{I}_{t_{\text{start}}}, \dots, \hat{I}_{t_{\text{end}}}]$$
   - Nominal frame count is strictly preserved:
     $$\Delta N = N_{\text{out}} - N_{\text{nominal}} \equiv \mathbf{0 \text{ frames}}$$
   - Audio-video synchronization error = **$0.000\text{ ms}$**.

---

## 6. TRAINING READINESS PLAN (128×128 / 256×256 PATCHES)

To transition CINEFRAME from a structural prototype into a production-grade cinema restoration model, the following training protocol is defined:

### 6.1 Dataset Requirements
- **Source Footage:** Minimum 50 distinct film sequences (diverse lighting, high motion, dialogue, static shots).
- **Ground Truth:** Pristine master high-resolution scans ($1080\text{p} / 4\text{K}$).
- **Degradation Simulation Pipeline:**
  1. *Optical Defocus:* Non-uniform Gaussian/defocus kernel ($\sigma \in [1.2, 2.8]$).
  2. *Projector Shutter Flicker:* Sinusoidal temporal luminance oscillation ($\pm 3\text{--}7\%$).
  3. *Sensor Grain / Noise:* Poisson-Gaussian shot noise ($\sigma_s \in [0.01, 0.04], \sigma_c \in [0.005, 0.02]$).
  4. *Perspective Jitter:* Subtle random homography perturbation ($\Delta \text{corner} \le 1.5\text{ px}$).

### 6.2 Data Partitioning (Strict Video-Disjoint Splits)
- **Training Set (70%):** 35 film sequences.
- **Validation Set (15%):** 8 film sequences (strictly unseen titles).
- **Test Set (15%):** 7 film sequences (strictly unseen titles, including real theatre samples `RW-02` and `RW-03`).
- **Constraint:** Frames from the same film must never cross splits.

### 6.3 Patch Extraction & Batching
- Patch size: $128 \times 128 \to 256 \times 256$ target (or $256 \times 256 \to 512 \times 512$).
- Random crop with spatial augmentations (horizontal flip, $90^\circ$ rotation).
- Batch size: $B = 8$ or $16$.

### 6.4 Loss Function Formulation
$$\mathcal{L}_{\text{total}} = \mathcal{L}_{\text{char}} + \lambda_1 \mathcal{L}_{\text{edge}} + \lambda_2 \mathcal{L}_{\text{temp}}$$
1. **Charbonnier Spatial Loss ($\epsilon = 10^{-3}$):**
   $$\mathcal{L}_{\text{char}} = \sqrt{||\hat{I}_t - I_t^{\text{GT}}||^2 + \epsilon^2}$$
2. **Edge Contrast Loss (Sobel Gradients, $\lambda_1 = 0.2$):**
   $$\mathcal{L}_{\text{edge}} = ||\nabla \hat{I}_t - \nabla I_t^{\text{GT}}||_1$$
3. **Temporal Consistency Loss ($\lambda_2 = 0.4$):**
   $$\mathcal{L}_{\text{temp}} = ||(\hat{I}_t - \hat{I}_{t-1}) - (I_t^{\text{GT}} - I_{t-1}^{\text{GT}})||_1$$

### 6.5 Measurable Acceptance Criteria over FFmpeg Lanczos Baseline
1. **$\Delta \text{PSNR}$:** $\ge \mathbf{+1.5\text{ dB}}$ improvement over native FFmpeg Lanczos.
2. **$\Delta \text{SSIM}$:** $\ge \mathbf{+0.04}$ improvement over native FFmpeg Lanczos ($\ge 0.88$ absolute).
3. **Temporal Warping Error ($t\text{OF}$):** $\le \mathbf{0.015}$ (no temporal flickering).
4. **Visual Verification:** Zero boundary seam artifacts when evaluated with the normalized tiling engine.

---

## 7. RECOMMENDED FINAL ARCHITECTURE FOR PHASE 13.3

```
                               ┌───────────────────────────┐
                               │   Input Video Chunk       │
                               └─────────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │   FFmpeg Context Decode   │
                               │   [t_start - 1, ..., + 1] │
                               │   + Phase 13.2 Homography │
                               └─────────────┬─────────────┘
                                             │
                                             ▼
                       ┌───────────────────────────────────────────┐
                       │   Hardware & VRAM Capability Check        │
                       │   GPU Available && VRAM >= Threshold?     │
                       └─────────────┬───────────────┬─────────────┘
                                     │ YES           │ NO
                                     ▼               ▼
        ┌────────────────────────────────────┐ ┌────────────────────────────────────┐
        │   CINEFRAME Neural Path            │ │   FFmpeg Lanczos Path              │
        │   1. Divide into 256x256 tiles     │ │   1. High-throughput libswscale    │
        │   2. Ingest 3-frame sliding window │ │   2. 100% stable, zero pulsing     │
        │   3. Normalized Hann Accumulation  │ │   3. CPU baseline default          │
        │      I_out = sum(W*I) / sum(W)     │ │   4. No GPU memory required        │
        │   4. Discard +-1 boundary frames   │ └─────────────────┬──────────────────┘
        └─────────────────┬──────────────────┘                   │
                          │                                      │
                          └──────────────────┬───────────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │   Chunk Assembly          │
                               │   - Frame count exact     │
                               │   - Audio drift = 0.0 ms  │
                               │   - H.264 / NVENC encode  │
                               └───────────────────────────┘
```

---

## 8. SUMMARY CONCLUSION

1. The Phase 13.3.1 architecture proposal has been validated and hardened with a critical mathematical fix: **Explicit Weight Accumulation Normalization** replaces naive piecewise weighting, eliminating brightness seams and edge vignetting.
2. The exact receptive field is confirmed as **13 input pixels**, validating the $32\text{px}$ tile overlap with a $2.67\times$ safety margin.
3. GPU benchmarks are explicitly marked unverified because the host environment lacks discrete CUDA hardware.
4. The pipeline integration blueprint is mathematically sound, preserves microsecond-level audio synchronization, and is ready for Phase 13.3 implementation upon explicit approval.
