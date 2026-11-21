import * as tf from "@tensorflow/tfjs";

/**
 * CINEGEN AI — Audio Neural Network Architectures (Phase 5)
 *
 * Implements 4 original neural network architectures:
 * 1. NOISENET: Audio Noise Reduction Network (Audience noise, hum, hiss suppression)
 * 2. ECHONET:  Acoustic Dereverberation & Reflection Suppression Network
 * 3. STEMNET:  Multi-Stem Audio Source Separation Network (Dialogue, Music, Effects)
 * 4. VOICENET: Dialogue Enhancement & Vocal Presence Network
 */

// ==========================================
// 1. NOISENET Architecture
// ==========================================
export function buildNoiseNetModel(baseFilters = 8): tf.LayersModel {
  const input = tf.input({
    shape: [null, null, 1],
    name: "noisenet_input_magnitude_spectrogram",
  });

  // Stage A: Multi-Scale Spectral Feature Encoder
  const conv1 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "noisenet_conv1",
    })
    .apply(input) as tf.SymbolicTensor;

  // Stage B: Multi-Frame Temporal Residual Block (captures stationary hum & noise harmonics)
  const d1 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "noisenet_dilated_c1",
    })
    .apply(conv1) as tf.SymbolicTensor;

  const d2 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "noisenet_dilated_c2",
    })
    .apply(d1) as tf.SymbolicTensor;

  const res1 = tf.layers.add({ name: "noisenet_res_add" }).apply([conv1, d2]) as tf.SymbolicTensor;

  // Stage C: Temporal Attention Weighting
  const attn = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [1, 1],
      padding: "same",
      activation: "sigmoid",
      kernelInitializer: "glorotUniform",
      name: "noisenet_attn",
    })
    .apply(res1) as tf.SymbolicTensor;

  const fused = tf.layers.multiply({ name: "noisenet_attn_fusion" }).apply([res1, attn]) as tf.SymbolicTensor;

  // Stage D: Ratio Mask Estimation Head
  const mask = tf.layers
    .conv2d({
      filters: 1,
      kernelSize: [3, 3],
      padding: "same",
      activation: "sigmoid",
      kernelInitializer: "glorotUniform",
      name: "noisenet_mask_output",
    })
    .apply(fused) as tf.SymbolicTensor;

  // Multiplicative spectral suppression
  const filtered = tf.layers
    .multiply({ name: "noisenet_filtered_output" })
    .apply([input, mask]) as tf.SymbolicTensor;

  return tf.model({
    inputs: input,
    outputs: filtered,
    name: "NOISENET_Model",
  });
}

// ==========================================
// 2. ECHONET Architecture
// ==========================================
export function buildEchoNetModel(baseFilters = 8): tf.LayersModel {
  const input = tf.input({
    shape: [null, null, 1],
    name: "echonet_input_reverberant_spectrogram",
  });

  // Stage A: Reverberation Feature Extractor
  const conv1 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "echonet_conv1",
    })
    .apply(input) as tf.SymbolicTensor;

  // Stage B: Multi-Tap Delay Line Convolutions (captures reflections across time frames)
  const tap1 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "echonet_tap1",
    })
    .apply(conv1) as tf.SymbolicTensor;

  const tap2 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "echonet_tap2",
    })
    .apply(tap1) as tf.SymbolicTensor;

  const fused = tf.layers.add({ name: "echonet_tap_add" }).apply([conv1, tap2]) as tf.SymbolicTensor;

  // Stage C: Direct-to-Reverberant Ratio Mask Head
  const mask = tf.layers
    .conv2d({
      filters: 1,
      kernelSize: [3, 3],
      padding: "same",
      activation: "sigmoid",
      kernelInitializer: "glorotUniform",
      name: "echonet_mask_output",
    })
    .apply(fused) as tf.SymbolicTensor;

  const dereverbed = tf.layers
    .multiply({ name: "echonet_dereverbed_output" })
    .apply([input, mask]) as tf.SymbolicTensor;

  return tf.model({
    inputs: input,
    outputs: dereverbed,
    name: "ECHONET_Model",
  });
}

// ==========================================
// 3. STEMNET Architecture
// ==========================================
export function buildStemNetModel(baseFilters = 8): tf.LayersModel {
  const input = tf.input({
    shape: [null, null, 1],
    name: "stemnet_input_mixture_spectrogram",
  });

  // Stage A: Shared Mixture Feature Encoder
  const c1 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "stemnet_shared_c1",
    })
    .apply(input) as tf.SymbolicTensor;

  const c2 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "stemnet_shared_c2",
    })
    .apply(c1) as tf.SymbolicTensor;

  const shared = tf.layers.add({ name: "stemnet_shared_add" }).apply([c1, c2]) as tf.SymbolicTensor;

  // Stage B: 3-Channel Softmax Mask Head (Guarantees M_D + M_M + M_F == 1.0 for Lossless Recombination)
  const masks = tf.layers
    .conv2d({
      filters: 3,
      kernelSize: [3, 3],
      padding: "same",
      activation: "softmax",
      kernelInitializer: "glorotUniform",
      name: "stemnet_softmax_masks",
    })
    .apply(shared) as tf.SymbolicTensor;

  const in3 = tf.layers.concatenate({ axis: -1, name: "stemnet_in3" }).apply([input, input, input]) as tf.SymbolicTensor;
  const stems = tf.layers.multiply({ name: "output_stems_3ch" }).apply([in3, masks]) as tf.SymbolicTensor;

  return tf.model({
    inputs: input,
    outputs: stems,
    name: "STEMNET_Model",
  });
}

// ==========================================
// 4. VOICENET Architecture
// ==========================================
export function buildVoiceNetModel(baseFilters = 8): tf.LayersModel {
  const input = tf.input({
    shape: [null, null, 1],
    name: "voicenet_input_dialogue_spectrogram",
  });

  // Stage A: Vocal Formant & Clarity Feature Extractor
  const conv1 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "voicenet_conv1",
    })
    .apply(input) as tf.SymbolicTensor;

  const conv2 = tf.layers
    .conv2d({
      filters: baseFilters,
      kernelSize: [3, 3],
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "voicenet_conv2",
    })
    .apply(conv1) as tf.SymbolicTensor;

  const fused = tf.layers.add({ name: "voicenet_res_add" }).apply([conv1, conv2]) as tf.SymbolicTensor;

  // Stage B: Spectral Clarity Gain Correction (Additive residual gain in [-1, +1])
  const gainCorrection = tf.layers
    .conv2d({
      filters: 1,
      kernelSize: [3, 3],
      padding: "same",
      activation: "tanh",
      kernelInitializer: "zeros", // Starts as identity (gain = 0)
      name: "voicenet_gain_correction",
    })
    .apply(fused) as tf.SymbolicTensor;

  // Enhanced = Input + Input * (Gain * 0.5)
  const scaledGain = tf.layers
    .multiply({ name: "voicenet_scaled_gain" })
    .apply([input, gainCorrection]) as tf.SymbolicTensor;

  const enhanced = tf.layers
    .add({ name: "voicenet_enhanced_output" })
    .apply([input, scaledGain]) as tf.SymbolicTensor;

  const finalOut = tf.layers
    .activation({ activation: "relu", name: "voicenet_relu_output" })
    .apply(enhanced) as tf.SymbolicTensor;

  return tf.model({
    inputs: input,
    outputs: finalOut,
    name: "VOICENET_Model",
  });
}
