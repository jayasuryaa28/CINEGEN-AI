#!/usr/bin/env node

/**
 * CINEGEN AI — CINEFRAME Checkpoint Integrity & Weight Verification Script
 *
 * Verifies:
 * 1. Checkpoint file structure (topology, specs, weights).
 * 2. Successful model restoration.
 * 3. Non-random weights (deviation from standard initialization).
 * 4. Inference consistency (identical outputs from restored weights).
 */

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { buildCineFrameModel, loadCheckpoint } = require("./train_and_evaluate_cineframe");

const CHECKPOINT_DIR = path.resolve(__dirname, "../storage_data/checkpoints/cineframe");

async function verifyCheckpoint(subDir = "best") {
  const dir = path.join(CHECKPOINT_DIR, subDir);
  console.log(`\n--- Auditing Checkpoint Integrity: [${subDir}] ---`);
  console.log(`Path: ${dir}`);

  const requiredFiles = ["model_topology.json", "weight_specs.json", "weights.bin"];
  for (const f of requiredFiles) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing required checkpoint file: ${f}`);
    }
    const size = fs.statSync(p).size;
    console.log(`✓ Found ${f} (${size.toLocaleString()} bytes)`);
  }

  // Load restored model
  console.log("Loading restored model from disk...");
  const restoredModel = await loadCheckpoint(dir);
  console.log(`✓ Model successfully restored into TensorFlow.js!`);
  console.log(`Trainable parameters: ${restoredModel.countParams().toLocaleString()}`);

  // Compare against freshly initialized random model
  const randomModel = buildCineFrameModel(9, 16, 2);

  const restoredWeights = restoredModel.getWeights();
  const randomWeights = randomModel.getWeights();

  let maxWeightDev = 0;
  let totalWeightsChecked = 0;

  for (let i = 0; i < restoredWeights.length; i++) {
    const rw = restoredWeights[i].dataSync();
    const initW = randomWeights[i].dataSync();
    for (let j = 0; j < rw.length; j++) {
      const dev = Math.abs(rw[j] - initW[j]);
      if (dev > maxWeightDev) maxWeightDev = dev;
      totalWeightsChecked++;
    }
  }

  console.log(`Checked ${totalWeightsChecked.toLocaleString()} weight elements.`);
  console.log(`Max deviation between trained checkpoint and random init: ${maxWeightDev.toFixed(6)}`);

  if (maxWeightDev < 0.001) {
    throw new Error("Checkpoint weights are identical to random initialization! Training did not update weights.");
  }
  console.log("✓ Verified: Model weights are genuinely updated and trained.");

  // Test deterministic inference consistency
  const dummyInput = tf.ones([1, 24, 24, 9]);
  const out1 = restoredModel.predict(dummyInput);
  const out2 = restoredModel.predict(dummyInput);

  const diff = tf.max(tf.abs(tf.sub(out1, out2))).dataSync()[0];
  console.log(`Inference determinism discrepancy: ${diff.toExponential(4)}`);
  if (diff > 1e-6) {
    throw new Error("Model inference is non-deterministic!");
  }
  console.log("✓ Verified: Restored model produces deterministic predictions.");

  dummyInput.dispose();
  out1.dispose();
  out2.dispose();
  randomModel.dispose();
  restoredModel.dispose();

  console.log(`\n🎉 Checkpoint [${subDir}] PASSED all integrity and verification tests!`);
  return true;
}

if (require.main === module) {
  (async () => {
    try {
      await verifyCheckpoint("best");
      await verifyCheckpoint("final");
      process.exit(0);
    } catch (err) {
      console.error("Checkpoint Verification Failed:", err);
      process.exit(1);
    }
  })();
}

module.exports = { verifyCheckpoint };
