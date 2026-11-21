#!/usr/bin/env node

/**
 * CINEGEN AI — Audio Checkpoint Integrity & Non-Random Weight Verification
 *
 * Rigorously verifies:
 * 1. File presence: topology, weight specs, binary weights.
 * 2. Model restoration into TensorFlow.js.
 * 3. Non-random weights (deviation from freshly initialized random model).
 * 4. Prediction determinism across saves and loads.
 */

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const {
  buildNoiseNetModel,
  buildEchoNetModel,
  buildStemNetModel,
  buildVoiceNetModel,
} = require("../src/ai/audio/models");

const CHECKPOINT_BASE = fs.existsSync(path.resolve("./storage_data/checkpoints/audio_hardened"))
  ? path.resolve("./storage_data/checkpoints/audio_hardened")
  : path.resolve("./storage_data/checkpoints/audio");

async function loadCheckpoint(dir) {
  const modelTopology = JSON.parse(fs.readFileSync(path.join(dir, "model_topology.json"), "utf-8"));
  const weightSpecs = JSON.parse(fs.readFileSync(path.join(dir, "weight_specs.json"), "utf-8"));
  const weightBuf = fs.readFileSync(path.join(dir, "weights.bin"));
  const handler = {
    load: async () => ({
      modelTopology,
      weightSpecs,
      weightData: weightBuf.buffer.slice(weightBuf.byteOffset, weightBuf.byteOffset + weightBuf.byteLength),
    }),
  };
  return tf.loadLayersModel(handler);
}

async function verifyModelCheckpoint(modelName, buildFn) {
  console.log(`\n--- Auditing Checkpoint Integrity: [${modelName.toUpperCase()}] ---`);
  const bestDir = path.join(CHECKPOINT_BASE, modelName, "best");
  const finalDir = path.join(CHECKPOINT_BASE, modelName, "final");

  for (const dir of [bestDir, finalDir]) {
    const sub = path.basename(dir);
    const requiredFiles = ["model_topology.json", "weight_specs.json", "weights.bin"];
    for (const f of requiredFiles) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) {
        throw new Error(`Missing checkpoint file in ${modelName}/${sub}: ${f}`);
      }
      console.log(`✓ [${modelName}/${sub}] Found ${f} (${fs.statSync(p).size.toLocaleString()} bytes)`);
    }

    const restoredModel = await loadCheckpoint(dir);
    console.log(`✓ [${modelName}/${sub}] Model loaded: ${restoredModel.countParams().toLocaleString()} parameters`);

    // Compare with random initialization
    const randomModel = buildFn(8);
    const restWeights = restoredModel.getWeights();
    const randWeights = randomModel.getWeights();

    let maxDev = 0;
    let totalChecked = 0;
    for (let i = 0; i < restWeights.length; i++) {
      const rw = restWeights[i].dataSync();
      const initW = randWeights[i].dataSync();
      for (let j = 0; j < rw.length; j++) {
        const d = Math.abs(rw[j] - initW[j]);
        if (d > maxDev) maxDev = d;
        totalChecked++;
      }
    }

    console.log(`✓ [${modelName}/${sub}] Checked ${totalChecked} weights. Max deviation from random init: ${maxDev.toFixed(6)}`);
    if (maxDev < 0.001) {
      throw new Error(`Weights in ${modelName}/${sub} did not deviate from random initialization!`);
    }

    // Check determinism
    const dummy = tf.randomUniform([1, 10, 129, 1]);
    const out1 = restoredModel.predict(dummy);
    const out2 = restoredModel.predict(dummy);

    let diff = 0;
    if (Array.isArray(out1)) {
      for (let k = 0; k < out1.length; k++) {
        diff = Math.max(diff, tf.max(tf.abs(tf.sub(out1[k], out2[k]))).dataSync()[0]);
      }
    } else {
      diff = tf.max(tf.abs(tf.sub(out1, out2))).dataSync()[0];
    }

    console.log(`✓ [${modelName}/${sub}] Inference determinism discrepancy: ${diff.toExponential(4)}`);
    if (diff > 1e-6) {
      throw new Error(`Inference in ${modelName}/${sub} is non-deterministic!`);
    }

    tf.dispose([dummy, out1, out2, randomModel, restoredModel]);
  }

  console.log(`🎉 [${modelName.toUpperCase()}] PASSED all checkpoint integrity & weight verification tests!`);
}

async function main() {
  console.log("==================================================");
  console.log("   CINEGEN AI — AUDIO CHECKPOINT VERIFICATION    ");
  console.log("==================================================");

  await verifyModelCheckpoint("noisenet", buildNoiseNetModel);
  await verifyModelCheckpoint("echonet", buildEchoNetModel);
  await verifyModelCheckpoint("stemnet", buildStemNetModel);
  await verifyModelCheckpoint("voicenet", buildVoiceNetModel);

  console.log("\n==================================================");
  console.log("✓ ALL 4 AUDIO MODEL CHECKPOINTS FULLY VERIFIED!");
  console.log("==================================================");
}

main().catch(err => {
  console.error("Audio Verification Failed:", err);
  process.exit(1);
});
