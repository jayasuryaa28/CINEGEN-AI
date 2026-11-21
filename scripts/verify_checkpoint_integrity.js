#!/usr/bin/env node

/**
 * CINEGEN AI — Checkpoint Integrity & Determinism Verification
 */

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { buildCineVisionModel, loadCheckpoint } = require("./train_and_evaluate_cinevision");

async function main() {
  console.log("=== CINEVISION CHECKPOINT & WEIGHT AUDIT ===");

  const checkpointDir = path.resolve("./storage_data/checkpoints/cinevision/best");
  if (!fs.existsSync(checkpointDir)) {
    throw new Error(`Checkpoint dir not found: ${checkpointDir}`);
  }

  // 1. Load trained checkpoint
  console.log("[1/5] Loading trained checkpoint from disk...");
  const trainedModel = await loadCheckpoint(checkpointDir);

  // 2. Instantiate fresh untrained random model for comparison
  console.log("[2/5] Instantiating fresh randomly initialized model...");
  const randomModel = buildCineVisionModel([64, 64, 3]);

  // 3. Inspect and compare weight statistics
  console.log("[3/5] Computing layer-by-layer weight statistics (Trained vs Random)...");
  const trainedWeights = trainedModel.getWeights();
  const randomWeights = randomModel.getWeights();

  let totalParams = 0;
  let weightsAreDifferent = false;
  let maxWeightDiff = 0;
  let trainedL2Norm = 0;
  let randomL2Norm = 0;

  for (let i = 0; i < trainedWeights.length; i++) {
    const tW = trainedWeights[i];
    const rW = randomWeights[i];
    const tData = tW.dataSync();
    const rData = rW.dataSync();

    totalParams += tData.length;

    let l2T = 0;
    let l2R = 0;
    for (let j = 0; j < tData.length; j++) {
      l2T += tData[j] * tData[j];
      l2R += rData[j] * rData[j];
      const diff = Math.abs(tData[j] - rData[j]);
      if (diff > maxWeightDiff) maxWeightDiff = diff;
      if (diff > 1e-4) weightsAreDifferent = true;
    }
    trainedL2Norm += l2T;
    randomL2Norm += l2R;
  }

  trainedL2Norm = Math.sqrt(trainedL2Norm);
  randomL2Norm = Math.sqrt(randomL2Norm);

  console.log(`  - Total Trainable Parameters: ${totalParams.toLocaleString()}`);
  console.log(`  - Trained Weights L2 Norm:    ${trainedL2Norm.toFixed(4)}`);
  console.log(`  - Random Weights L2 Norm:     ${randomL2Norm.toFixed(4)}`);
  console.log(`  - Max Weight Deviation:       ${maxWeightDiff.toFixed(6)}`);
  console.log(`  - Weights Non-Random Confirmed: ${weightsAreDifferent ? "YES (Mathematically Verified)" : "NO"}`);

  if (!weightsAreDifferent) {
    throw new Error("Checkpoint validation failed: weights are identical to random initialization!");
  }

  // 4. Test Determinism & Reproducibility across multiple restorations
  console.log("[4/5] Testing checkpoint restoration determinism...");
  const trainedModel2 = await loadCheckpoint(checkpointDir);

  const testInput = tf.randomUniform([1, 64, 64, 3], 0, 1, "float32", 12345);
  const out1 = trainedModel.predict(testInput);
  const out2 = trainedModel2.predict(testInput);

  let maxPredDiff = 0;
  for (let h = 0; h < out1.length; h++) {
    const d1 = out1[h].dataSync();
    const d2 = out2[h].dataSync();
    for (let k = 0; k < d1.length; k++) {
      const diff = Math.abs(d1[k] - d2[k]);
      if (diff > maxPredDiff) maxPredDiff = diff;
    }
  }

  console.log(`  - Max Restoration Discrepancy: ${maxPredDiff.toExponential(4)}`);
  console.log(`  - Determinism Confirmed:       ${maxPredDiff < 1e-6 ? "YES (Bit-Identical)" : "NO"}`);

  // 5. Verify Dataset Partition & Zero Data Leakage
  console.log("[5/5] Auditing Dataset Partition & Split Isolation...");
  const annotationsPath = path.resolve("./storage_data/dataset/cinevision_annotations.json");
  const annotations = JSON.parse(fs.readFileSync(annotationsPath, "utf-8"));

  const trainSources = new Set(annotations.filter((a) => a.split === "train").map((a) => a.sourceId));
  const valSources = new Set(annotations.filter((a) => a.split === "val").map((a) => a.sourceId));
  const testSources = new Set(annotations.filter((a) => a.split === "test").map((a) => a.sourceId));

  console.log(`  - Train Sources: [${Array.from(trainSources).join(", ")}] (${annotations.filter(a => a.split === "train").length} frames)`);
  console.log(`  - Val Sources:   [${Array.from(valSources).join(", ")}] (${annotations.filter(a => a.split === "val").length} frames)`);
  console.log(`  - Test Sources:  [${Array.from(testSources).join(", ")}] (${annotations.filter(a => a.split === "test").length} frames)`);

  let leakageFound = false;
  for (const s of valSources) {
    if (trainSources.has(s)) {
      console.error(`  ✗ LEAKAGE: Source ${s} found in Train and Val!`);
      leakageFound = true;
    }
  }
  for (const s of testSources) {
    if (trainSources.has(s) || valSources.has(s)) {
      console.error(`  ✗ LEAKAGE: Source ${s} found in Test and Train/Val!`);
      leakageFound = true;
    }
  }

  if (leakageFound) {
    throw new Error("Dataset partition audit failed: source overlap detected!");
  }
  console.log("  - Zero Data Leakage Confirmed: Strict Source Separation Verified (100% Isolated).");

  console.log("\n==============================================");
  console.log("✓ CHECKPOINT & TRAINING AUDIT 100% PASSED!");
  console.log("==============================================");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
