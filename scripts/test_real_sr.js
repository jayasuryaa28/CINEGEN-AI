const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");

const ANNOTATIONS_PATH = "./storage_data/dataset/cineframe_annotations.json";
const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
const testSample = annotations.find(s => s.split === "test");

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
    kernelInitializer: "zeros",
    name: "residual_detail_map",
  }).apply(ref1);

  // Final Restored Output: Base Upsampled + Learned Detail Correction
  const restored = tf.layers.add({ name: "restored_output" }).apply([baseUp, resDetail]);

  const model = tf.model({ inputs: input, outputs: restored, name: "CINEFRAME_Residual_Net" });

  // Initialize base_center_frame to extract channels 3, 4, 5
  const baseLayer = model.getLayer("base_center_frame");
  const wData = new Float32Array(1 * 1 * 9 * 3);
  wData[3 * 3 + 0] = 1.0;
  wData[4 * 3 + 1] = 1.0;
  wData[5 * 3 + 2] = 1.0;
  baseLayer.setWeights([tf.tensor4d(wData, [1, 1, 9, 3]), tf.zeros([3])]);

  return model;
}

const model = buildResidualCineFrame(9, 16, 2);

// Load real test sample
const degBufs = testSample.degradedFrames.map(p => fs.readFileSync(p.replace(/\.png$/, ".rgb")));
const cleanBuf = fs.readFileSync(testSample.cleanTargetFrame.replace(/\.png$/, ".rgb"));

const pixels = 64 * 64;
const f32 = new Float32Array(pixels * 9);
for (let i = 0; i < pixels; i++) {
  for (let c = 0; c < 3; c++) {
    f32[i * 9 + c] = degBufs[0][i * 3 + c] / 255.0;
    f32[i * 9 + 3 + c] = degBufs[1][i * 3 + c] / 255.0;
    f32[i * 9 + 6 + c] = degBufs[2][i * 3 + c] / 255.0;
  }
}
const inT = tf.tensor4d(f32, [1, 64, 64, 9]);
const pred = tf.clipByValue(model.predict(inT), 0.0, 1.0);
const pData = pred.dataSync();

const targetF32 = new Float32Array(128 * 128 * 3);
for (let i = 0; i < cleanBuf.length; i++) targetF32[i] = cleanBuf[i] / 255.0;

let mse = 0;
for (let i = 0; i < pData.length; i++) {
  const d = pData[i] - targetF32[i];
  mse += d * d;
}
mse /= pData.length;
const psnr = 10 * Math.log10(1.0 / (mse + 1e-10));
console.log("Initial untaught Residual CINEFRAME PSNR on real test frame:", psnr.toFixed(2), "dB");
