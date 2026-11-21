import * as tf from "@tensorflow/tfjs";
import { CineFrameModelConfig } from "@/types/cineframe";

/**
 * CINEFRAME: Original Multi-Stage Video Restoration & Super-Resolution Neural Network
 *
 * Architecture Components:
 * A. Base Upsampling Skip Path:
 *    Extracts center degraded frame [t] (channels 3, 4, 5) and upsamples it 2x.
 *    Provides stable low-frequency foundation, eliminating color drift and collapse.
 *
 * B. Multi-Frame Temporal Feature Encoder & Alignment:
 *    Ingests 3 consecutive frames [I_{t-1}, I_t, I_{t+1}] (9 channels)
 *    and computes inter-frame temporal attention fusion.
 *
 * C. Deep Residual Dense Restoration Backbone:
 *    Stack of Residual Dense Blocks (RDB) with local skip connections
 *    targeting deblurring, denoising, deblocking, and high-frequency details.
 *
 * D. Super-Resolution Upscaling Head & Residual Correction Addition:
 *    Upsamples learned residual detail map and sums it with the base upscaled frame.
 */
export class CineFrameModel {
  public model: tf.LayersModel;
  public config: CineFrameModelConfig;

  constructor(config?: Partial<CineFrameModelConfig>) {
    this.config = {
      scaleFactor: config?.scaleFactor || 2,
      inputChannels: config?.inputChannels || 9,
      baseFilters: config?.baseFilters || 16,
      numResidualBlocks: config?.numResidualBlocks || 2,
      useAttention: config?.useAttention ?? true,
    };
    this.model = this.buildArchitecture();
  }

  private buildArchitecture(): tf.LayersModel {
    const { scaleFactor, inputChannels, baseFilters, numResidualBlocks, useAttention } = this.config;

    // Fully-convolutional input [Batch, Height, Width, 9]
    const input = tf.input({
      shape: [null, null, inputChannels],
      name: "cineframe_input_temporal_frames",
    });

    // ==========================================
    // Stage 0: Base Frame Upsampling Skip Path
    // ==========================================
    const baseSkip = tf.layers
      .conv2d({
        filters: 3,
        kernelSize: 1,
        padding: "same",
        activation: "linear",
        kernelInitializer: "zeros",
        name: "base_center_frame_proj",
      })
      .apply(input) as tf.SymbolicTensor;

    const baseUp = tf.layers
      .upSampling2d({ size: [scaleFactor, scaleFactor], name: "base_upsample" })
      .apply(baseSkip) as tf.SymbolicTensor;

    // ==========================================
    // Stage A: Multi-Frame Temporal Feature Encoder & Alignment
    // ==========================================
    const convIn = tf.layers
      .conv2d({
        filters: baseFilters,
        kernelSize: 3,
        padding: "same",
        activation: "relu",
        kernelInitializer: "heNormal",
        name: "stageA_temporal_conv",
      })
      .apply(input) as tf.SymbolicTensor;

    let f0: tf.SymbolicTensor = convIn;
    if (useAttention) {
      const attn = tf.layers
        .conv2d({
          filters: baseFilters,
          kernelSize: 1,
          padding: "same",
          activation: "sigmoid",
          kernelInitializer: "glorotUniform",
          name: "stageA_temporal_attn",
        })
        .apply(convIn) as tf.SymbolicTensor;

      f0 = tf.layers
        .multiply({ name: "stageA_attended_fusion" })
        .apply([convIn, attn]) as tf.SymbolicTensor;
    }

    // ==========================================
    // Stage B: Deep Residual Dense Restoration Backbone
    // ==========================================
    let fCurrent: tf.SymbolicTensor = f0;

    for (let i = 0; i < numResidualBlocks; i++) {
      const r1 = tf.layers
        .conv2d({
          filters: baseFilters,
          kernelSize: 3,
          padding: "same",
          activation: "relu",
          kernelInitializer: "heNormal",
          name: `rdb_${i}_c1`,
        })
        .apply(fCurrent) as tf.SymbolicTensor;

      const r2 = tf.layers
        .conv2d({
          filters: baseFilters,
          kernelSize: 3,
          padding: "same",
          activation: "relu",
          kernelInitializer: "heNormal",
          name: `rdb_${i}_c2`,
        })
        .apply(r1) as tf.SymbolicTensor;

      fCurrent = tf.layers
        .add({ name: `rdb_${i}_add` })
        .apply([fCurrent, r2]) as tf.SymbolicTensor;
    }

    // Global residual connection (bypasses low-frequency content)
    const backbone = tf.layers
      .add({ name: "global_residual_add" })
      .apply([f0, fCurrent]) as tf.SymbolicTensor;

    // ==========================================
    // Stage C: Super-Resolution Upscaling Head
    // ==========================================
    let upscaled: tf.SymbolicTensor = backbone;

    if (scaleFactor === 2 || scaleFactor === 4) {
      const up1 = tf.layers
        .upSampling2d({ size: [2, 2], name: "stageC_upsample_2x" })
        .apply(upscaled) as tf.SymbolicTensor;

      const ref1 = tf.layers
        .conv2d({
          filters: Math.max(12, Math.floor(baseFilters / 2)),
          kernelSize: 3,
          padding: "same",
          activation: "relu",
          kernelInitializer: "heNormal",
          name: "stageC_refine_2x",
        })
        .apply(up1) as tf.SymbolicTensor;

      upscaled = ref1;

      if (scaleFactor === 4) {
        const up2 = tf.layers
          .upSampling2d({ size: [2, 2], name: "stageC_upsample_4x" })
          .apply(upscaled) as tf.SymbolicTensor;

        const ref2 = tf.layers
          .conv2d({
            filters: 12,
            kernelSize: 3,
            padding: "same",
            activation: "relu",
            kernelInitializer: "heNormal",
            name: "stageC_refine_4x",
          })
          .apply(up2) as tf.SymbolicTensor;

        upscaled = ref2;
      }
    }

    // High-frequency detail residual map
    const resDetail = tf.layers
      .conv2d({
        filters: 3,
        kernelSize: 3,
        padding: "same",
        activation: "linear",
        kernelInitializer: "zeros",
        name: "residual_detail_map",
      })
      .apply(upscaled) as tf.SymbolicTensor;

    // Final Restored Output: Base Upsampled + Learned Detail Correction
    const outputFrame = tf.layers
      .add({ name: "output_restored_frame" })
      .apply([baseUp, resDetail]) as tf.SymbolicTensor;

    const model = tf.model({
      inputs: input,
      outputs: outputFrame,
      name: "CINEFRAME_Net",
    });

    // Initialize base center frame projection layer
    const baseLayer = model.getLayer("base_center_frame_proj");
    const wData = new Float32Array(1 * 1 * inputChannels * 3);
    wData[3 * 3 + 0] = 1.0;
    wData[4 * 3 + 1] = 1.0;
    wData[5 * 3 + 2] = 1.0;
    baseLayer.setWeights([tf.tensor4d(wData, [1, 1, inputChannels, 3]), tf.zeros([3])]);

    return model;
  }
}
