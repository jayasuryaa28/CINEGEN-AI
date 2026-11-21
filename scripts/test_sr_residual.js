const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");

function buildResidualCineFrame(inputChannels = 9, baseFilters = 16, numRdb = 2) {
  const input = tf.input({
    shape: [null, null, inputChannels],
    name: "cineframe_input",
  });

  // Base path: 1x1 conv to extract/project center frame, followed by 2x upsampling
  const baseSkip = tf.layers.conv2d({
    filters: 3,
    kernelSize: 1,
    padding: "same",
    activation: "linear",
    kernelInitializer: "glorotUniform",
    name: "base_center_frame",
  }).apply(input);
  const baseUp = tf.layers.upSampling2d({ size: [2, 2], name: "base_upsample" }).apply(baseSkip);

  // Stage A: Multi-Frame Temporal Feature Encoder & Attention
  const convIn = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: 3,
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "stageA_conv",
  }).apply(input);

  const attn = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: 1,
    padding: "same",
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "stageA_attn",
  }).apply(convIn);

  const f0 = tf.layers.multiply({ name: "stageA_fusion" }).apply([convIn, attn]);

  // Stage B: Residual Dense Blocks
  let f = f0;
  for (let i = 0; i < numRdb; i++) {
    const r1 = tf.layers.conv2d({
      filters: baseFilters,
      kernelSize: 3,
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: `rdb_${i}_1`,
    }).apply(f);

    const r2 = tf.layers.conv2d({
      filters: baseFilters,
      kernelSize: 3,
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: `rdb_${i}_2`,
    }).apply(r1);

    f = tf.layers.add({ name: `rdb_${i}_add` }).apply([f, r2]);
  }

  const backbone = tf.layers.add({ name: "backbone_add" }).apply([f0, f]);

  // Stage C: Upsample + Refine + Residual Detail Map
  const up1 = tf.layers.upSampling2d({ size: [2, 2], name: "stageC_up" }).apply(backbone);
  const ref1 = tf.layers.conv2d({
    filters: 12,
    kernelSize: 3,
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "stageC_ref",
  }).apply(up1);

  // High-frequency residual correction map
  const resDetail = tf.layers.conv2d({
    filters: 3,
    kernelSize: 3,
    padding: "same",
    activation: "linear",
    kernelInitializer: "zeros", // Initialize to 0 so base upsampled frame is identity at start!
    name: "residual_detail_map",
  }).apply(ref1);

  // Final Restored Output: Base Upsampled + Learned Detail Correction
  const restored = tf.layers.add({ name: "restored_output" }).apply([baseUp, resDetail]);

  return tf.model({ inputs: input, outputs: restored, name: "CINEFRAME_Residual_Net" });
}

// Test model initialization and identity
const model = buildResidualCineFrame(9, 16, 2);

// Set base_center_frame weights to cleanly project center frame (channels 3, 4, 5)
const baseLayer = model.getLayer("base_center_frame");
const wShape = [1, 1, 9, 3];
const wData = new Float32Array(1 * 1 * 9 * 3);
// Channel 3 -> 0, Channel 4 -> 1, Channel 5 -> 2
wData[3 * 3 + 0] = 1.0;
wData[4 * 3 + 1] = 1.0;
wData[5 * 3 + 2] = 1.0;
baseLayer.setWeights([tf.tensor4d(wData, wShape), tf.zeros([3])]);

console.log("Model parameters:", model.countParams().toLocaleString());

// Check identity on dummy frame
const dummy = tf.randomUniform([1, 24, 24, 9]);
const centerFrame = dummy.slice([0, 0, 0, 3], [1, 24, 24, 3]);
const upsampledCenter = tf.image.resizeBilinear(centerFrame, [48, 48]);
const pred = model.predict(dummy);

const diff = tf.max(tf.abs(tf.sub(pred, upsampledCenter))).dataSync()[0];
console.log("Initial identity discrepancy vs bilinear upsampling:", diff.toExponential(4));

// Now run 3 steps of training on dummy batch
const optimizer = tf.train.adam(0.002);
const x = tf.randomUniform([3, 24, 24, 9], 0.2, 0.8);
const y = tf.randomUniform([3, 48, 48, 3], 0.2, 0.8);

for (let s = 0; s < 3; s++) {
  const { value, grads } = tf.variableGrads(() => {
    const p = model.predict(x);
    return tf.losses.meanSquaredError(y, p);
  });
  console.log(`Step ${s} MSE: ${value.dataSync()[0].toFixed(5)}`);
  optimizer.applyGradients(grads);
  value.dispose();
  tf.dispose(grads);
}
