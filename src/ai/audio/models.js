const tf = require("@tensorflow/tfjs");

// 1. NOISENET
function buildNoiseNetModel(baseFilters = 8) {
  const input = tf.input({
    shape: [null, null, 1],
    name: "noisenet_input_magnitude_spectrogram",
  });

  const conv1 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "noisenet_conv1",
  }).apply(input);

  const d1 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "noisenet_dilated_c1",
  }).apply(conv1);

  const d2 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "noisenet_dilated_c2",
  }).apply(d1);

  const res1 = tf.layers.add({ name: "noisenet_res_add" }).apply([conv1, d2]);

  const attn = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [1, 1],
    padding: "same",
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "noisenet_attn",
  }).apply(res1);

  const fused = tf.layers.multiply({ name: "noisenet_attn_fusion" }).apply([res1, attn]);

  const mask = tf.layers.conv2d({
    filters: 1,
    kernelSize: [3, 3],
    padding: "same",
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "noisenet_mask_output",
  }).apply(fused);

  const filtered = tf.layers.multiply({ name: "noisenet_filtered_output" }).apply([input, mask]);

  return tf.model({
    inputs: input,
    outputs: filtered,
    name: "NOISENET_Model",
  });
}

// 2. ECHONET
function buildEchoNetModel(baseFilters = 8) {
  const input = tf.input({
    shape: [null, null, 1],
    name: "echonet_input_reverberant_spectrogram",
  });

  const conv1 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "echonet_conv1",
  }).apply(input);

  const tap1 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "echonet_tap1",
  }).apply(conv1);

  const tap2 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "echonet_tap2",
  }).apply(tap1);

  const fused = tf.layers.add({ name: "echonet_tap_add" }).apply([conv1, tap2]);

  const mask = tf.layers.conv2d({
    filters: 1,
    kernelSize: [3, 3],
    padding: "same",
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "echonet_mask_output",
  }).apply(fused);

  const dereverbed = tf.layers.multiply({ name: "echonet_dereverbed_output" }).apply([input, mask]);

  return tf.model({
    inputs: input,
    outputs: dereverbed,
    name: "ECHONET_Model",
  });
}

// 3. STEMNET
function buildStemNetModel(baseFilters = 8) {
  const input = tf.input({
    shape: [null, null, 1],
    name: "stemnet_input_mixture_spectrogram",
  });

  const c1 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "stemnet_shared_c1",
  }).apply(input);

  const c2 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "stemnet_shared_c2",
  }).apply(c1);

  const shared = tf.layers.add({ name: "stemnet_shared_add" }).apply([c1, c2]);

  // 3-Channel Softmax Mask Head (Guarantees M_D + M_M + M_F == 1.0 for Lossless Recombination)
  const masks = tf.layers.conv2d({
    filters: 3,
    kernelSize: [3, 3],
    padding: "same",
    activation: "softmax",
    kernelInitializer: "glorotUniform",
    name: "stemnet_softmax_masks",
  }).apply(shared);

  const in3 = tf.layers.concatenate({ axis: -1, name: "stemnet_in3" }).apply([input, input, input]);
  const stems = tf.layers.multiply({ name: "output_stems_3ch" }).apply([in3, masks]);

  return tf.model({
    inputs: input,
    outputs: stems,
    name: "STEMNET_Model",
  });
}

// 4. VOICENET
function buildVoiceNetModel(baseFilters = 8) {
  const input = tf.input({
    shape: [null, null, 1],
    name: "voicenet_input_dialogue_spectrogram",
  });

  const conv1 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "voicenet_conv1",
  }).apply(input);

  const conv2 = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: [3, 3],
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "voicenet_conv2",
  }).apply(conv1);

  const fused = tf.layers.add({ name: "voicenet_res_add" }).apply([conv1, conv2]);

  const gainCorrection = tf.layers.conv2d({
    filters: 1,
    kernelSize: [3, 3],
    padding: "same",
    activation: "tanh",
    kernelInitializer: "zeros",
    name: "voicenet_gain_correction",
  }).apply(fused);

  const scaledGain = tf.layers.multiply({ name: "voicenet_scaled_gain" }).apply([input, gainCorrection]);
  const enhanced = tf.layers.add({ name: "voicenet_enhanced_output" }).apply([input, scaledGain]);
  const finalOut = tf.layers.activation({ activation: "relu", name: "voicenet_relu_output" }).apply(enhanced);

  return tf.model({
    inputs: input,
    outputs: finalOut,
    name: "VOICENET_Model",
  });
}

module.exports = {
  buildNoiseNetModel,
  buildEchoNetModel,
  buildStemNetModel,
  buildVoiceNetModel,
};
