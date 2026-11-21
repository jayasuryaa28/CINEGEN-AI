const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { loadCheckpoint } = require("./train_and_evaluate_cineframe");

const ANNOTATIONS_PATH = "./storage_data/dataset/cineframe_annotations.json";
const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
const allVal = annotations.filter(s => s.split === "val");

function getDegRgbPath(p) {
  const p1 = p.replace(/\.png$/, ".rgb");
  if (fs.existsSync(p1)) return p1;
  const p2 = p.replace(/\.png$/, "_64.rgb");
  if (fs.existsSync(p2)) return p2;
  return p1;
}

function getCleanRgbPath(p) {
  return p.replace(/\.png$/, ".rgb");
}

function extractPatchPair(sample, S = 24, cropPos = "center") {
  const degBuffers = sample.degradedFrames.map((p) => {
    const rgbPath = getDegRgbPath(p);
    return fs.readFileSync(rgbPath);
  });
  const cleanBuf = fs.readFileSync(getCleanRgbPath(sample.cleanTargetFrame));

  let x0 = 20, y0 = 20;
  if (cropPos === "top_left") { x0 = 8; y0 = 8; }
  else if (cropPos === "offset") { x0 = 12; y0 = 28; }
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
    inputTensor: tf.tensor3d(degF32, [S, S, 9]),
    targetTensor: tf.tensor3d(cleanF32, [cleanS, cleanS, 3]),
  };
}

(async () => {
  const model = await loadCheckpoint("./storage_data/checkpoints/cineframe/best");
  const p = extractPatchPair(allVal[0], 24, "center");
  console.log("Val target mean:", p.targetTensor.mean().dataSync()[0]);

  const pred = model.predict(p.inputTensor.expandDims(0));
  console.log("Val pred mean:", pred.mean().dataSync()[0], "min:", pred.min().dataSync()[0], "max:", pred.max().dataSync()[0]);

  const diff = tf.sub(pred, p.targetTensor.expandDims(0));
  const char = tf.mean(tf.sqrt(tf.add(tf.square(diff), 1e-6))).dataSync()[0];
  console.log("Val patch Char loss:", char);
})();
