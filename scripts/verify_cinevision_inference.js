const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { loadCheckpoint } = require("./train_and_evaluate_cinevision");

async function verifyInference() {
  console.log("=== VERIFYING CINEVISION INFERENCE ADAPTER ===");
  const checkpointDir = path.resolve("./storage_data/checkpoints/cinevision/best");
  console.log("Loading trained checkpoint from:", checkpointDir);

  const model = await loadCheckpoint(checkpointDir);

  // Load a test frame from storage
  const testFramePath = path.resolve("./storage_data/dataset/cinevision_frames/pair_src_clean_04_auditorium_rear_center_f001.rgb");
  if (!fs.existsSync(testFramePath)) {
    throw new Error(`Test frame not found: ${testFramePath}`);
  }

  const buf = fs.readFileSync(testFramePath);
  const f32 = new Float32Array(32 * 32 * 3);
  let idx = 0;
  for (let y = 0; y < 128; y += 4) {
    for (let x = 0; x < 128; x += 4) {
      const srcIdx = (y * 128 + x) * 3;
      f32[idx++] = buf[srcIdx] / 255.0;
      f32[idx++] = buf[srcIdx + 1] / 255.0;
      f32[idx++] = buf[srcIdx + 2] / 255.0;
    }
  }

  const inputTensor = tf.tensor3d(f32, [32, 32, 3]).expandDims(0);
  const start = Date.now();
  const preds = model.predict(inputTensor);
  const latencyMs = Date.now() - start;

  const [predCornersT, predHomoT, predMotionT, predOccT, predQualT] = preds;

  const cornersRaw = Array.from(predCornersT.dataSync());
  const homoRaw = Array.from(predHomoT.dataSync());
  const motionRaw = Array.from(predMotionT.dataSync());
  const occRaw = Array.from(predOccT.dataSync());
  const qualRaw = Array.from(predQualT.dataSync());

  console.log("\n✓ Real Neural Inference Executed in", latencyMs, "ms!");
  console.log("\n[CINEVISION Predictions on Test Frame]:");
  console.log(" - Screen Corners:", [
    [cornersRaw[0].toFixed(3), cornersRaw[1].toFixed(3)],
    [cornersRaw[2].toFixed(3), cornersRaw[3].toFixed(3)],
    [cornersRaw[4].toFixed(3), cornersRaw[5].toFixed(3)],
    [cornersRaw[6].toFixed(3), cornersRaw[7].toFixed(3)],
  ]);
  console.log(" - Homography Matrix (8 DOF):", homoRaw.map(v => v.toFixed(3)));
  console.log(" - Camera Shake Displacement [dx, dy]:", [motionRaw[0].toFixed(3), motionRaw[1].toFixed(3)]);
  console.log(" - Occlusion [p_occ, fraction]:", [occRaw[0].toFixed(3), occRaw[1].toFixed(3)]);
  console.log(" - Quality Vector [blur, noise, flicker, brightness]:", qualRaw.map(v => v.toFixed(3)));

  inputTensor.dispose();
  preds.forEach(t => t.dispose());
}

verifyInference().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
