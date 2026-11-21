# CINEVISION — Original Computer Vision Neural Network

**CINEGEN AI Architectural & Neural Network Specification**  
*JavaScript-First AI Video and Audio Processing Platform*

---

## 1. System Vision & Purpose

**CINEVISION** is the primary visual analysis neural network in **CINEGEN AI**. When an unauthorized or raw theatre-style video recording is uploaded, CINEVISION inspects the visual frames to understand the movie screen and capture conditions.

It performs five simultaneous perceptual tasks in a single unified forward pass:
1. **Screen Corner & Boundary Localization:** Predicts the 4 normalized coordinates $[(x_{tl}, y_{tl}), (x_{tr}, y_{tr}), (x_{br}, y_{br}), (x_{bl}, y_{bl})]$ of the projection screen.
2. **Planar Geometry & Homography Estimation:** Predicts the 8 non-linear projective parameters of the homography transformation matrix $H$ mapping canonical rectangular coordinates to distorted screen space.
3. **Camera Tremor & Motion Analysis:** Predicts normalized temporal displacement vectors $[\Delta x, \Delta y]$ representing involuntary handheld camera shake.
4. **Foreground Occlusion Detection:** Detects silhouettes of theater audiences (heads/shoulders) along the bottom edge, predicting obstruction presence and area fraction.
5. **Frame-Level Quality Assessment:** Estimates continuous perceptual degradation scores for defocus blur, sensor noise, projector shutter flicker, and brightness shifting.

---

## 2. Neural Architecture Design

CINEVISION is designed from scratch and built using TensorFlow.js (`@tensorflow/tfjs`). It uses zero external AI inference APIs and zero pretrained model weights. All layers are initialized with random weights (`heNormal` for feature extraction and `glorotUniform` for output heads).

```
                      +-----------------------------+
                      |   Input Frame (32x32x3)     |
                      +-----------------------------+
                                     |
                [Conv2D (16, 3x3, stride 2, relu)]
                                     |  (16x16x16)
                [Conv2D (32, 3x3, stride 2, relu)]
                                     |  (8x8x32)
                [Conv2D (64, 3x3, stride 2, relu)]
                                     |  (4x4x64)
                                     +--------------------------+
                                     |                          |
                     [Conv2D (1, 1x1, sigmoid)]                 |
                                     | (Spatial Attention Mask) |
                                     +------------+-------------+
                                                  |
                                       [Elementwise Multiply]
                                                  |
                                      [Global Average Pooling]
                                                  |
                                      [Dense (64, relu)] (Shared Core)
                                                  |
        +------------------+----------------------+--------------------+------------------+
        |                  |                      |                    |                  |
   [Head 1: Corners]  [Head 2: Homography]  [Head 3: Motion]     [Head 4: Occlusion]  [Head 5: Quality]
    Dense(32) ->       Dense(32) ->          Dense(16) ->         Dense(16) ->         Dense(32) ->
    Dense(8, Sigmoid)  Dense(8, Linear)      Dense(2, Tanh)       Dense(2, Sigmoid)    Dense(4, Sigmoid)
```

### Architectural Components:
- **Visual Feature Encoder:** Multi-scale 2D convolutions with strided downsampling, capturing low-level optical gradients, edges, and spatial screen geometry.
- **Spatial Attention Core:** Self-attention 1x1 convolution generating a soft spatial mask $[4 \times 4 \times 1]$ that highlights luminous screen regions while suppressing dark auditorium surroundings.
- **Global Average Pooling:** Condenses attended feature maps into an invariant representation vector.
- **Shared Feature Core:** A 64-dimensional dense representation serving as the latent representation for all downstream tasks.
- **Multi-Task Decoupled Heads:**
  - `output_corners`: 8 outputs bounded in $[0, 1]$ via Sigmoid activation.
  - `output_homography`: 8 linear outputs representing projective matrix parameters around canonical identity.
  - `output_motion`: 2 outputs bounded in $[-1, 1]$ via Tanh activation.
  - `output_occlusion`: 2 outputs $[p_{\text{occ}}, \text{fraction}]$ bounded in $[0, 1]$ via Sigmoid.
  - `output_quality`: 4 outputs $[\text{blur}, \text{noise}, \text{flicker}, \text{brightness}]$ bounded in $[0, 1]$ via Sigmoid.

---

## 3. Loss Formulations & Multi-Task Objective

The network optimizes a unified multi-task objective:

$$\mathcal{L}_{\text{total}} = w_1 \mathcal{L}_{\text{corners}} + w_2 \mathcal{L}_{\text{homography}} + w_3 \mathcal{L}_{\text{motion}} + w_4 \mathcal{L}_{\text{occlusion}} + w_5 \mathcal{L}_{\text{quality}}$$

### Mathematical Components:
1. **Corner Loss (Smooth L1 / Huber):**
   $$\mathcal{L}_{\text{corners}} = \text{Huber}(P_{\text{corners}}, Y_{\text{corners}}, \delta = 0.05)$$
   Smooth L1 prevents gradient explosion from extreme keystone angles while maintaining tight sub-pixel precision near convergence.
2. **Homography Loss (Mean Squared Error):**
   $$\mathcal{L}_{\text{homography}} = \frac{1}{8} \sum_{i=1}^8 \left( H_{\text{pred}, i} - H_{\text{gt}, i} \right)^2$$
3. **Motion Displacement Loss (MSE):**
   $$\mathcal{L}_{\text{motion}} = \|\Delta \mathbf{x}_{\text{pred}} - \Delta \mathbf{x}_{\text{gt}}\|^2$$
4. **Occlusion Loss (Sigmoid Cross-Entropy + Area L1):**
   $$\mathcal{L}_{\text{occlusion}} = \text{BCE}(p_{\text{pred}}, p_{\text{gt}}) + |\text{area}_{\text{pred}} - \text{area}_{\text{gt}}|$$
5. **Quality Estimation Loss (Mean Absolute Error):**
   $$\mathcal{L}_{\text{quality}} = \frac{1}{4} \sum_{k=1}^4 |Q_{\text{pred}, k} - Q_{\text{gt}, k}|$$

---

## 4. Dataset Partitioning & Leakage Prevention

The model trains exclusively on synthetic degradation data generated from Phase 2:
- **Total Frames:** 144 annotated pairs.
- **Train Split (72 frames):** Partitioned strictly from `src_clean_01` (testsrc2) and `src_clean_02` (smptebars).
- **Validation Split (36 frames):** Partitioned strictly from `src_clean_03` (navy color screen).
- **Held-Out Test Split (36 frames):** Partitioned strictly from `src_clean_04` (dynamic testsrc grid).

Splits are strictly segregated at the **source video** level. No source video appears across multiple splits, ensuring true generalization on unseen content.

---

## 5. Checkpoint & Weight Artifacts

Model weights are saved in standard, portable TensorFlow.js JSON/binary formats:
- `storage_data/checkpoints/cinevision/best/`:
  - `model_topology.json`: Full layer topology, activations, and parameter graphs.
  - `weight_specs.json`: Tensor names, dimensions, and datatypes.
  - `weights.bin`: Raw Float32 weight buffers.
- `storage_data/checkpoints/cinevision/training_history.json`: Epoch-by-epoch loss tracking.

---

## 6. Inference Adapter Contract

In Phase 3, `CineVisionTrainedModel` (`TrainedCineVision` in `src/ai/models.ts`) is registered with `status: "active"`.

```ts
import { aiRegistry } from "@/ai/models";

// Inspect visual recording conditions
const analysis = await aiRegistry.cinevision.analyzeFrame(frameBuffer);
console.log(analysis.hasScreenPerspective); // true / false
console.log(analysis.corners);             // [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
console.log(analysis.blurScore);           // 0.0 - 1.0
console.log(analysis.noiseScore);          // 0.0 - 1.0
```
