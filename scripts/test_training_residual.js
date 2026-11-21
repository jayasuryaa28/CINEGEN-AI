const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");

const ANNOTATIONS_PATH = "./storage_data/dataset/cineframe_annotations.json";
const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
const allTrain = annotations.filter(s => s.split === "train");
const allTest = annotations.filter(s => s.split === "test");

function buildResidualCineFrame(inputChannels = 9, baseFilters = 16, numRdb = 2) {
  const input = tf.input({
    shape: [null, null, inputChannels],
    name: "cineframe_input",
  });

  const baseSkip = tf.layers.conv2d({
    filters: 3,
    kernelSize: 1,
    padding: "same",
    activation: "linear",
    kernelInitializer: "zeros",
    name: "base_center_frame_proj",
  }).apply(input);
  const baseUp = tf.layers.upSampling2d({ size: [2, 2], name: "base_upsample_2x" }).apply(baseSkip);

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

  const up1 = tf.layers.upSampling2d({ size: [2, 2], name: "stageC_up" }).apply(backbone);
  const ref1 = tf.layers.conv2d({
    filters: 12,
    kernelSize: 3,
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "stageC_ref",
  }).apply(up1);

  const resDetail = tf.layers.conv2d({
    filters: 3,
    kernelSize: 3,
    padding: "same",
    activation: "linear",
    kernelInitializer: "zeros",
    name: "residual_detail_map",
  }).apply(ref1);

  const restored = tf.layers.add({ name: "output_restored_frame" }).apply([baseUp, resDetail]);

  const model = tf.model({ inputs: input, outputs: restored, name: "CINEFRAME_Residual_Net" });

  const baseLayer = model.getLayer("base_center_frame_proj");
  const wData = new Float32Array(1 * 1 * inputChannels * 3);
  wData[3 * 3 + 0] = 1.0;
  wData[4 * 3 + 1] = 1.0;
  wData[5 * 3 + 2] = 1.0;
  baseLayer.setWeights([tf.tensor4d(wData, [1, 1, inputChannels, 3]), tf.zeros([3])]);

  return model;
}

function extractPatch(sample, S = 24, cropPos = "center") {
  const degBuffers = sample.degradedFrames.map(p => fs.readFileSync(p.replace(/\.png$/, ".rgb")));
  const cleanBuf = fs.readFileSync(sample.cleanTargetFrame.replace(/\.png$/, ".rgb"));

  let x0 = 20, y0 = 20;
  if (cropPos === "top_left") { x0 = 8; y0 = 8; }
  else if (cropPos === "bottom_right") { x0 = 32; y0 = 32; }

  const degF32 = new Float32Array(S * S * 9);
  const [b0, b1, b2] = degBuffers;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const srcIdx = ((y0 + y) * 64 + (x0 + x)) * 3;
      const dstIdx = (y * S + x) * 9;

      degF32[dstIdx] = b0[srcIdx] / 255.0;
      degF32[dstIdx + 1] = b0[srcIdx + 1] / 255.0;
      degF32[dstIdx + 2] = b0[srcIdx + 2] / 255.0;

      degF32[dstIdx + 3] = b1[srcIdx] / 255.0;
      degF32[dstIdx + 4] = b1[srcIdx + 1] / 255.0;
      degF32[dstIdx + 5] = b1[srcIdx + 2] / 255.0;

      degF32[dstIdx + 6] = b2[srcIdx] / 255.0;
      degF32[dstIdx + 7] = b2[srcIdx + 1] / 255.0;
      degF32[dstIdx + 8] = b2[srcIdx + 2] / 255.0;
    }
  }

  const cleanS = S * 2;
  const cleanX0 = x0 * 2;
  const cleanY0 = y0 * 2;
  const cleanF32 = new Float32Array(cleanS * cleanS * 3);

  for (let y = 0; y < cleanS; y++) {
    for (let x = 0; x < cleanS; x++) {
      const srcIdx = ((cleanY0 + y) * 128 + (cleanX0 + x)) * 3;
      const dstIdx = (y * cleanS + x) * 3;

      cleanF32[dstIdx] = cleanBuf[srcIdx] / 255.0;
      cleanF32[dstIdx + 1] = cleanBuf[srcIdx + 1] / 255.0;
      cleanF32[dstIdx + 2] = cleanBuf[srcIdx + 2] / 255.0;
    }
  }

  return {
    inT: tf.tensor3d(degF32, [S, S, 9]),
    tgtT: tf.tensor3d(cleanF32, [cleanS, cleanS, 3]),
  };
}

const model = buildResidualCineFrame(9, 16, 2);
const optimizer = tf.train.adam(0.001);

const patches = [
  extractPatch(allTrain[0], 24, "center"),
  extractPatch(allTrain[1], 24, "center"),
  extractPatch(allTrain[2], 24, "center"),
];
const inBatch = tf.stack(patches.map(p => p.inT));
const tgtBatch = tf.stack(patches.map(p => p.tgtT));

for (let step = 0; step < 3; step++) {
  const { value, grads } = tf.variableGrads(() => {
    const rawPred = model.predict(inBatch);
    const pred = tf.clipByValue(rawPred, 0.0, 1.0);
    const diff = tf.sub(pred, tgtBatch);
    const charLoss = tf.mean(tf.sqrt(tf.add(tf.square(diff), 1e-6)));

    const [b, h, w, c] = pred.shape;
    const dxP = tf.sub(pred.slice([0, 0, 1, 0], [b, h, w - 1, c]), pred.slice([0, 0, 0, 0], [b, h, w - 1, c]));
    const dxT = tf.sub(tgtBatch.slice([0, 0, 1, 0], [b, h, w - 1, c]), tgtBatch.slice([0, 0, 0, 0], [b, h, w - 1, c]));
    const dyP = tf.sub(pred.slice([0, 1, 0, 0], [b, h - 1, w, c]), pred.slice([0, 0, 0, 0], [b, h - 1, w, c]));
    const dyT = tf.sub(tgtBatch.slice([0, 1, 0, 0], [b, h - 1, w, c]), tgtBatch.slice([0, 0, 0, 0], [b, h - 1, w, c]));
    const edgeLoss = tf.add(tf.mean(tf.abs(tf.sub(dxP, dxT))), tf.mean(tf.abs(tf.sub(dyP, dyT))));

    return tf.add(charLoss, tf.mul(0.1, edgeLoss));
  });

  console.log(`Step ${step} Loss: ${value.dataSync()[0].toFixed(5)}`);
  optimizer.applyGradients(grads);
  value.dispose();
  tf.dispose(grads);
}

// Evaluate on full test frame
const testSample = allTest[0];
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
const fullIn = tf.tensor4d(f32, [1, 64, 64, 9]);
const fullPred = tf.clipByValue(model.predict(fullIn), 0.0, 1.0);
const pData = fullPred.dataSync();

const targetF32 = new Float32Array(128 * 128 * 3);
for (let i = 0; i < cleanBuf.length; i++) targetF32[i] = cleanBuf[i] / 255.0;

let mse = 0;
for (let i = 0; i < pData.length; i++) {
  const d = pData[i] - targetF32[i];
  mse += d * d;
}
mse /= pData.length;
const psnr = 10 * Math.log10(1.0 / (mse + 1e-10));
console.log("Full Test Frame PSNR after 3 steps:", psnr.toFixed(2), "dB");
