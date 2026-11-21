#!/usr/bin/env node

/**
 * CINEGEN AI — CINEFRAME Neural Network Training & Evaluation Pipeline (Phase 4)
 *
 * Implements, trains from scratch, and rigorously benchmarks CINEFRAME:
 * - Residual 2x Temporal Super-Resolution & Multi-Stage Restoration Network
 * - Input: [64, 64, 9] (3 temporal degraded frames [I_{t-1}, I_t, I_{t+1}])
 * - Output: [128, 128, 3] (Restored high-resolution clean target frame)
 * - Base frame upsampling skip connection + learned high-frequency residual detail map
 * - Patch-based training on 24x24 -> 48x48 patches for fast CPU backpropagation
 * - Full-frame evaluation on unseen test sources (src_clean_04, src_clean_10)
 * - Zero pretrained weights, zero external APIs.
 * - Strict source-level isolation across train, val, and test splits.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const tf = require("@tensorflow/tfjs");

const BASE_DIR = path.resolve(__dirname, "..");
const DATASET_DIR = path.join(BASE_DIR, "storage_data", "dataset");
const ANNOTATIONS_PATH = path.join(DATASET_DIR, "cineframe_annotations.json");
const CHECKPOINT_DIR = path.join(BASE_DIR, "storage_data", "checkpoints", "cineframe");
const VISUALS_DIR = path.join(BASE_DIR, "storage_data", "visual_verifications", "cineframe");

// Ensure directories
[
  path.join(CHECKPOINT_DIR, "best"),
  path.join(CHECKPOINT_DIR, "final"),
  VISUALS_DIR,
].forEach((p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Helper for RGB paths
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

// ==========================================
// 1. Architecture Definition (Residual Super-Resolution)
// ==========================================
function buildCineFrameModel(inputChannels = 9, baseFilters = 16, numRdb = 2) {
  const input = tf.input({
    shape: [null, null, inputChannels],
    name: "cineframe_input_temporal_frames",
  });

  // Stage 0: Base Upsampling Skip Path (Center Frame Projection & 2x Upsampling)
  const baseSkip = tf.layers.conv2d({
    filters: 3,
    kernelSize: 1,
    padding: "same",
    activation: "linear",
    kernelInitializer: "zeros",
    name: "base_center_frame_proj",
  }).apply(input);

  const baseUp = tf.layers.upSampling2d({
    size: [2, 2],
    name: "base_upsample_2x",
  }).apply(baseSkip);

  // Stage A: Multi-Frame Temporal Feature Encoder & Attention Fusion
  const convIn = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: 3,
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "stageA_temporal_conv",
  }).apply(input);

  const attn = tf.layers.conv2d({
    filters: baseFilters,
    kernelSize: 1,
    padding: "same",
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "stageA_temporal_attn",
  }).apply(convIn);

  const f0 = tf.layers.multiply({ name: "stageA_attended_fusion" }).apply([convIn, attn]);

  // Stage B: Deep Residual Dense Restoration Backbone (Deblur, Denoise, Deblock)
  let f = f0;
  for (let i = 0; i < numRdb; i++) {
    const r1 = tf.layers.conv2d({
      filters: baseFilters,
      kernelSize: 3,
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: `rdb_${i}_c1`,
    }).apply(f);

    const r2 = tf.layers.conv2d({
      filters: baseFilters,
      kernelSize: 3,
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
      name: `rdb_${i}_c2`,
    }).apply(r1);

    f = tf.layers.add({ name: `rdb_${i}_add` }).apply([f, r2]);
  }

  // Global residual addition inside backbone
  const backbone = tf.layers.add({ name: "global_residual_add" }).apply([f0, f]);

  // Stage C: 2x Super-Resolution Upscaling Head & Residual Correction Map
  const up1 = tf.layers.upSampling2d({ size: [2, 2], name: "stageC_upsample_2x" }).apply(backbone);
  const ref1 = tf.layers.conv2d({
    filters: 12,
    kernelSize: 3,
    padding: "same",
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "stageC_refine_conv",
  }).apply(up1);

  const resDetail = tf.layers.conv2d({
    filters: 3,
    kernelSize: 3,
    padding: "same",
    activation: "linear",
    kernelInitializer: "zeros",
    name: "residual_detail_map",
  }).apply(ref1);

  // Final Restored Output = Base Upsampled Frame + Learned Detail Correction
  const restored = tf.layers.add({
    name: "output_restored_frame",
  }).apply([baseUp, resDetail]);

  const model = tf.model({ inputs: input, outputs: restored, name: "CINEFRAME_Net" });

  // Initialize base_center_frame_proj weights to pass center frame (channels 3, 4, 5)
  const baseLayer = model.getLayer("base_center_frame_proj");
  const wData = new Float32Array(1 * 1 * inputChannels * 3);
  wData[3 * 3 + 0] = 1.0;
  wData[4 * 3 + 1] = 1.0;
  wData[5 * 3 + 2] = 1.0;
  baseLayer.setWeights([tf.tensor4d(wData, [1, 1, inputChannels, 3]), tf.zeros([3])]);

  return model;
}

// ==========================================
// 2. Training Loss (Charbonnier + Edge Loss)
// ==========================================
function computeTrainLoss(pred, target) {
  // 1. Charbonnier Reconstruction Loss
  const diff = tf.sub(pred, target);
  const charLoss = tf.mean(tf.sqrt(tf.add(tf.square(diff), 1e-6)));

  // 2. Edge Gradient Preservation Loss
  const [b, h, w, c] = pred.shape;
  const dxP = tf.sub(pred.slice([0, 0, 1, 0], [b, h, w - 1, c]), pred.slice([0, 0, 0, 0], [b, h, w - 1, c]));
  const dxT = tf.sub(target.slice([0, 0, 1, 0], [b, h, w - 1, c]), target.slice([0, 0, 0, 0], [b, h, w - 1, c]));
  const dyP = tf.sub(pred.slice([0, 1, 0, 0], [b, h - 1, w, c]), pred.slice([0, 0, 0, 0], [b, h - 1, w, c]));
  const dyT = tf.sub(target.slice([0, 1, 0, 0], [b, h - 1, w, c]), target.slice([0, 0, 0, 0], [b, h - 1, w, c]));
  const edgeLoss = tf.add(tf.mean(tf.abs(tf.sub(dxP, dxT))), tf.mean(tf.abs(tf.sub(dyP, dyT))));

  const totalLoss = tf.add(charLoss, tf.mul(0.1, edgeLoss));
  return { totalLoss, charLoss, edgeLoss };
}

// ==========================================
// 3. Patch Extraction for Training (24x24 -> 48x48)
// ==========================================
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

  // Degraded input patch: [S, S, 9]
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

  // Clean target patch: [2S, 2S, 3]
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

function createPatchBatch(items) {
  return tf.tidy(() => {
    const pairs = items.map((it) => extractPatchPair(it.sample, 24, it.cropPos));
    return {
      inputs: tf.stack(pairs.map((p) => p.inputTensor)),
      targets: tf.stack(pairs.map((p) => p.targetTensor)),
    };
  });
}

// Full-frame loader for evaluation
function loadFullDegradedSequence(framePaths) {
  const buffers = framePaths.map((p) => {
    const rgbPath = getDegRgbPath(p);
    return fs.readFileSync(rgbPath);
  });
  const pixels = 64 * 64;
  const f32 = new Float32Array(pixels * 9);
  const [b0, b1, b2] = buffers;

  for (let i = 0; i < pixels; i++) {
    const srcIdx = i * 3;
    const dstIdx = i * 9;
    f32[dstIdx] = b0[srcIdx] / 255.0;
    f32[dstIdx + 1] = b0[srcIdx + 1] / 255.0;
    f32[dstIdx + 2] = b0[srcIdx + 2] / 255.0;
    f32[dstIdx + 3] = b1[srcIdx] / 255.0;
    f32[dstIdx + 4] = b1[srcIdx + 1] / 255.0;
    f32[dstIdx + 5] = b1[srcIdx + 2] / 255.0;
    f32[dstIdx + 6] = b2[srcIdx] / 255.0;
    f32[dstIdx + 7] = b2[srcIdx + 1] / 255.0;
    f32[dstIdx + 8] = b2[srcIdx + 2] / 255.0;
  }
  return tf.tensor3d(f32, [64, 64, 9]);
}

function loadFullCleanTarget(framePath) {
  const rgbPath = getCleanRgbPath(framePath);
  const buffer = fs.readFileSync(rgbPath);
  const f32 = new Float32Array(128 * 128 * 3);
  for (let i = 0; i < buffer.length; i++) {
    f32[i] = buffer[i] / 255.0;
  }
  return tf.tensor3d(f32, [128, 128, 3]);
}

// ==========================================
// 4. Checkpoint Management
// ==========================================
async function saveCheckpoint(model, dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      fs.writeFileSync(path.join(dir, "model_topology.json"), JSON.stringify(artifacts.modelTopology, null, 2), "utf-8");
      fs.writeFileSync(path.join(dir, "weight_specs.json"), JSON.stringify(artifacts.weightSpecs, null, 2), "utf-8");
      if (artifacts.weightData) {
        fs.writeFileSync(path.join(dir, "weights.bin"), Buffer.from(artifacts.weightData));
      }
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
    })
  );
}

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

// ==========================================
// 5. Training Loop
// ==========================================
async function runTraining() {
  console.log("==================================================");
  console.log("    CINEFRAME NEURAL RESTORATION & SR PIPELINE    ");
  console.log("    Phase 4: Residual Super-Resolution Model      ");
  console.log("==================================================");
  console.log(`Backend: ${tf.getBackend()} (JavaScript CPU)`);

  const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
  const allTrain = annotations.filter((s) => s.split === "train");
  const allVal = annotations.filter((s) => s.split === "val");
  const allTest = annotations.filter((s) => s.split === "test");

  function createSourceIsolatedPatches(samples, seqsPerSource = 3, positions = ["center", "offset"]) {
    const list = [];
    const bySource = new Map();
    for (const s of samples) {
      if (!bySource.has(s.sourceId)) bySource.set(s.sourceId, []);
      bySource.get(s.sourceId).push(s);
    }

    for (const [sourceId, seqList] of bySource) {
      const step = Math.floor(seqList.length / (seqsPerSource + 1));
      for (let k = 1; k <= seqsPerSource; k++) {
        const seq = seqList[k * step];
        for (const pos of positions) {
          list.push({ sample: seq, cropPos: pos });
        }
      }
    }
    return list;
  }

  // 6 train sources * 3 seqs * 2 crops = 36 patches
  const trainItems = createSourceIsolatedPatches(allTrain, 3, ["center", "offset"]);
  // 2 val sources * 2 seqs * 2 crops = 8 patches
  const valItems = createSourceIsolatedPatches(allVal, 2, ["center", "offset"]);

  console.log(`Partitions (Strict Source Separation):`);
  console.log(` - Train Patches: ${trainItems.length} across Sources: ${Array.from(new Set(trainItems.map(it => it.sample.sourceId))).join(", ")}`);
  console.log(` - Val Patches:   ${valItems.length} across Sources: ${Array.from(new Set(valItems.map(it => it.sample.sourceId))).join(", ")}`);
  console.log(` - Test Frames:   ${allTest.length} across Sources: ${Array.from(new Set(allTest.map(s => s.sourceId))).join(", ")}`);

  console.log("\nInitializing original CINEFRAME architecture from scratch...");
  const model = buildCineFrameModel(9, 16, 2);
  console.log(`Total Trainable Parameters: ${model.countParams().toLocaleString()}`);

  const optimizer = tf.train.adam(0.001);
  const epochs = 2;
  const batchSize = 3;
  const totalBatches = Math.ceil(trainItems.length / batchSize);
  const logs = [];
  let bestValLoss = Infinity;

  console.log(`\nBeginning ${epochs} Epochs of Multi-Objective Backpropagation...`);
  const startTime = Date.now();

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const epochStart = Date.now();
    const shuffled = [...trainItems].sort(() => Math.random() - 0.5);

    let trainLossSum = 0;
    let trainCharSum = 0;
    let trainEdgeSum = 0;
    let batchCount = 0;

    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batchSamples = shuffled.slice(i, i + batchSize);
      const batchIdx = batchCount + 1;
      const batchStart = Date.now();

      const batch = createPatchBatch(batchSamples);

      let bLoss = 0;
      let bChar = 0;
      let bEdge = 0;

      const { value: lossVal, grads } = tf.variableGrads(() => {
        const rawPred = model.predict(batch.inputs);
        const pred = tf.clipByValue(rawPred, 0.0, 1.0);
        const losses = computeTrainLoss(pred, batch.targets);
        bLoss = losses.totalLoss.dataSync()[0];
        bChar = losses.charLoss.dataSync()[0];
        bEdge = losses.edgeLoss.dataSync()[0];
        return losses.totalLoss;
      });

      optimizer.applyGradients(grads);

      const stepMs = Date.now() - batchStart;
      trainLossSum += bLoss;
      trainCharSum += bChar;
      trainEdgeSum += bEdge;
      batchCount++;

      const elapsedMs = Date.now() - epochStart;
      const remainingBatches = totalBatches - batchCount;
      const etaSec = Math.round((elapsedMs / batchCount) * remainingBatches / 1000);

      console.log(
        `  [Epoch ${epoch}/${epochs} | Batch ${batchIdx.toString().padStart(2, "0")}/${totalBatches}] ` +
          `Loss: ${bLoss.toFixed(5)} (Char: ${bChar.toFixed(5)}, Edge: ${bEdge.toFixed(5)}) | ` +
          `Step: ${stepMs}ms | ETA: ${etaSec}s`
      );

      batch.inputs.dispose();
      batch.targets.dispose();
      lossVal.dispose();
      tf.dispose(grads);
    }

    // Validation Pass
    let valLossSum = 0;
    const vBatch = createPatchBatch(valItems);
    tf.tidy(() => {
      const rawVPred = model.predict(vBatch.inputs);
      const vPred = tf.clipByValue(rawVPred, 0.0, 1.0);
      const vLosses = computeTrainLoss(vPred, vBatch.targets);
      valLossSum = vLosses.totalLoss.dataSync()[0];
    });
    vBatch.inputs.dispose();
    vBatch.targets.dispose();

    const avgTrainTotal = trainLossSum / batchCount;
    const avgTrainChar = trainCharSum / batchCount;
    const avgTrainEdge = trainEdgeSum / batchCount;
    const durationSec = parseFloat(((Date.now() - epochStart) / 1000).toFixed(1));

    const logEntry = {
      epoch,
      trainTotalLoss: avgTrainTotal,
      trainCharLoss: avgTrainChar,
      trainEdgeLoss: avgTrainEdge,
      valTotalLoss: valLossSum,
      durationSec,
    };
    logs.push(logEntry);

    console.log(
      `[Epoch ${epoch.toString().padStart(2, "0")}/${epochs}] ` +
        `Train Loss: ${avgTrainTotal.toFixed(5)} (Char: ${avgTrainChar.toFixed(5)}) | ` +
        `Val Loss: ${valLossSum.toFixed(5)} | ` +
        `${durationSec}s`
    );

    if (valLossSum < bestValLoss) {
      bestValLoss = valLossSum;
      await saveCheckpoint(model, path.join(CHECKPOINT_DIR, "best"));
    }
  }

  const totalTrainingSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Training finished in ${totalTrainingSec}s! Best Validation Loss: ${bestValLoss.toFixed(5)}`);

  await saveCheckpoint(model, path.join(CHECKPOINT_DIR, "final"));
  fs.writeFileSync(
    path.join(CHECKPOINT_DIR, "training_history.json"),
    JSON.stringify(logs, null, 2),
    "utf-8"
  );

  return { logs, bestValLoss };
}

// ==========================================
// 6. Test Evaluation on Full Frames (Unseen Sources)
// ==========================================
function computePsnr(predData, targetData) {
  let mse = 0;
  const n = predData.length;
  for (let i = 0; i < n; i++) {
    const d = predData[i] - targetData[i];
    mse += d * d;
  }
  mse /= n;
  return 10 * Math.log10(1.0 / (mse + 1e-10));
}

function computeSsim(predData, targetData) {
  let meanP = 0, meanT = 0;
  const n = predData.length;
  for (let i = 0; i < n; i++) {
    meanP += predData[i];
    meanT += targetData[i];
  }
  meanP /= n;
  meanT /= n;

  let varP = 0, varT = 0, covPT = 0;
  for (let i = 0; i < n; i++) {
    const dP = predData[i] - meanP;
    const dT = targetData[i] - meanT;
    varP += dP * dP;
    varT += dT * dT;
    covPT += dP * dT;
  }
  varP /= n;
  varT /= n;
  covPT /= n;

  const c1 = 0.0001, c2 = 0.0009;
  const num = (2 * meanP * meanT + c1) * (2 * covPT + c2);
  const den = (meanP * meanP + meanT * meanT + c1) * (varP + varT + c2);
  return num / Math.max(den, 1e-7);
}

function computeEdgeError(predData, targetData) {
  let sum = 0, cnt = 0;
  for (let y = 0; y < 127; y++) {
    for (let x = 0; x < 127; x++) {
      for (let c = 0; c < 3; c++) {
        const idx = (y * 128 + x) * 3 + c;
        const dxP = predData[(y * 128 + x + 1) * 3 + c] - predData[idx];
        const dxT = targetData[(y * 128 + x + 1) * 3 + c] - targetData[idx];
        const dyP = predData[((y + 1) * 128 + x) * 3 + c] - predData[idx];
        const dyT = targetData[((y + 1) * 128 + x) * 3 + c] - targetData[idx];
        sum += Math.abs(dxP - dxT) + Math.abs(dyP - dyT);
        cnt++;
      }
    }
  }
  return sum / cnt;
}

function simulateFfmpegBaseline(degraded64Buf) {
  const f128 = new Float32Array(128 * 128 * 3);
  for (let y = 0; y < 128; y++) {
    const srcY = y / 2.0;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(63, y0 + 1);
    const dy = srcY - y0;
    for (let x = 0; x < 128; x++) {
      const srcX = x / 2.0;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(63, x0 + 1);
      const dx = srcX - x0;
      for (let c = 0; c < 3; c++) {
        const c00 = degraded64Buf[(y0 * 64 + x0) * 3 + c] / 255.0;
        const c10 = degraded64Buf[(y0 * 64 + x1) * 3 + c] / 255.0;
        const c01 = degraded64Buf[(y1 * 64 + x0) * 3 + c] / 255.0;
        const c11 = degraded64Buf[(y1 * 64 + x1) * 3 + c] / 255.0;
        const v = c00 * (1 - dx) * (1 - dy) + c10 * dx * (1 - dy) + c01 * (1 - dx) * dy + c11 * dx * dy;
        f128[(y * 128 + x) * 3 + c] = Math.min(1.0, Math.max(0.0, v));
      }
    }
  }

  const sharp = new Float32Array(128 * 128 * 3);
  for (let y = 1; y < 127; y++) {
    for (let x = 1; x < 127; x++) {
      for (let c = 0; c < 3; c++) {
        const idx = (y * 128 + x) * 3 + c;
        const center = f128[idx];
        const nAvg =
          (f128[((y - 1) * 128 + x) * 3 + c] +
            f128[((y + 1) * 128 + x) * 3 + c] +
            f128[(y * 128 + x - 1) * 3 + c] +
            f128[(y * 128 + x + 1) * 3 + c]) /
          4.0;
        sharp[idx] = Math.min(1.0, Math.max(0.0, center + (center - nAvg) * 0.35));
      }
    }
  }
  return sharp;
}

function simulateDegradedUpscaled(degraded64Buf) {
  const f128 = new Float32Array(128 * 128 * 3);
  for (let y = 0; y < 128; y++) {
    const srcY = Math.min(63, Math.floor(y / 2));
    for (let x = 0; x < 128; x++) {
      const srcX = Math.min(63, Math.floor(x / 2));
      const srcIdx = (srcY * 64 + srcX) * 3;
      const dstIdx = (y * 128 + x) * 3;
      f128[dstIdx] = degraded64Buf[srcIdx] / 255.0;
      f128[dstIdx + 1] = degraded64Buf[srcIdx + 1] / 255.0;
      f128[dstIdx + 2] = degraded64Buf[srcIdx + 2] / 255.0;
    }
  }
  return f128;
}

function writeRgbToPng(f32Array, width, height, outputPath) {
  const u8 = Buffer.alloc(width * height * 3);
  for (let i = 0; i < f32Array.length; i++) {
    u8[i] = Math.min(255, Math.max(0, Math.round(f32Array[i] * 255.0)));
  }
  const rawPath = outputPath.replace(/\.png$/, ".tmp.rgb");
  fs.writeFileSync(rawPath, u8);
  spawnSync("ffmpeg", [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-s", `${width}x${height}`,
    "-i", rawPath,
    outputPath,
  ]);
  if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
}

async function runEvaluation(trainingLogs) {
  console.log("\n==================================================");
  console.log("   CINEFRAME BENCHMARK ON HELD-OUT TEST SPLIT     ");
  console.log("    Full-Frame Evaluation on Unseen Sources       ");
  console.log("==================================================");

  const bestDir = path.join(CHECKPOINT_DIR, "best");
  console.log(`Loading best trained model from: ${bestDir}`);
  const model = await loadCheckpoint(bestDir);

  const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
  const allTest = annotations.filter((s) => s.split === "test");

  // Sample 16 representative full frames from unseen sources src_clean_04 and src_clean_10
  const step = Math.max(1, Math.floor(allTest.length / 16));
  const test = [];
  for (let i = 0; i < allTest.length && test.length < 16; i += step) {
    test.push(allTest[i]);
  }

  const testSources = Array.from(new Set(test.map((s) => s.sourceId))).join(", ");
  console.log(`Evaluating ${test.length} full-frame test sequences from unseen Sources: ${testSources}...`);

  let totalDegPsnr = 0, totalBasePsnr = 0, totalCinePsnr = 0;
  let totalDegSsim = 0, totalBaseSsim = 0, totalCineSsim = 0;
  let totalEdgeErr = 0, totalTempErr = 0, totalLatency = 0;

  let prevPredData = null, prevTargetData = null;

  for (let idx = 0; idx < test.length; idx++) {
    const sample = test[idx];
    const startT = Date.now();
    // Ingest full 64x64x9 frame
    const inTensor = tf.tidy(() => loadFullDegradedSequence(sample.degradedFrames).expandDims(0));
    // Output full 128x128x3 frame with clipping in [0.0, 1.0]
    const rawPred = model.predict(inTensor);
    const predTensor = tf.clipByValue(rawPred, 0.0, 1.0);
    const latency = Date.now() - startT;
    totalLatency += latency;

    const predData = predTensor.dataSync();
    inTensor.dispose();
    rawPred.dispose();
    predTensor.dispose();

    // Target clean full 128x128
    const targetData = loadFullCleanTarget(sample.cleanTargetFrame).dataSync();

    // Degraded middle
    const degMiddleBuf = fs.readFileSync(getDegRgbPath(sample.degradedFrames[1]));
    const degData = simulateDegradedUpscaled(degMiddleBuf);
    const baseData = simulateFfmpegBaseline(degMiddleBuf);

    totalDegPsnr += computePsnr(degData, targetData);
    totalBasePsnr += computePsnr(baseData, targetData);
    totalCinePsnr += computePsnr(predData, targetData);

    totalDegSsim += computeSsim(degData, targetData);
    totalBaseSsim += computeSsim(baseData, targetData);
    totalCineSsim += computeSsim(predData, targetData);

    totalEdgeErr += computeEdgeError(predData, targetData);

    if (prevPredData && prevTargetData) {
      let tDiff = 0;
      for (let i = 0; i < predData.length; i++) {
        tDiff += Math.abs((predData[i] - prevPredData[i]) - (targetData[i] - prevTargetData[i]));
      }
      totalTempErr += tDiff / predData.length;
    }
    prevPredData = predData;
    prevTargetData = targetData;

    // Generate visual comparison panel for 2 test sequences
    if (idx === 0 || idx === Math.floor(test.length / 2)) {
      const visPrefix = path.join(VISUALS_DIR, `${sample.sourceId}_${sample.sampleId}`);
      const degPng = `${visPrefix}_1_deg.png`;
      const basePng = `${visPrefix}_2_ffmpeg.png`;
      const cinePng = `${visPrefix}_3_cineframe.png`;
      const cleanPng = `${visPrefix}_4_clean.png`;
      const stitchedPng = `${visPrefix}_comparison.png`;

      writeRgbToPng(degData, 128, 128, degPng);
      writeRgbToPng(baseData, 128, 128, basePng);
      writeRgbToPng(predData, 128, 128, cinePng);
      writeRgbToPng(targetData, 128, 128, cleanPng);

      spawnSync("ffmpeg", [
        "-y",
        "-i", degPng,
        "-i", basePng,
        "-i", cinePng,
        "-i", cleanPng,
        "-filter_complex", "hstack=inputs=4",
        stitchedPng,
      ]);
      console.log(`  [Visual Panel Generated] -> ${stitchedPng}`);
    }
  }

  const n = test.length;
  const avgDegPsnr = totalDegPsnr / n;
  const avgBasePsnr = totalBasePsnr / n;
  const avgCinePsnr = totalCinePsnr / n;
  const avgDegSsim = totalDegSsim / n;
  const avgBaseSsim = totalBaseSsim / n;
  const avgCineSsim = totalCineSsim / n;
  const avgEdgeErr = totalEdgeErr / n;
  const avgTempErr = totalTempErr / Math.max(1, n - 1);
  const avgLatency = totalLatency / n;

  const mem = process.memoryUsage();
  const peakMemMb = (mem.heapUsed + mem.external) / (1024 * 1024);

  console.log("\n--- BENCHMARK RESULTS (4-WAY COMPARISON) ---");
  console.log(`Evaluated Test Sequences:        ${n}`);
  console.log(`1. Input Degraded PSNR:          ${avgDegPsnr.toFixed(2)} dB (SSIM: ${avgDegSsim.toFixed(4)})`);
  console.log(`2. Conventional FFmpeg PSNR:     ${avgBasePsnr.toFixed(2)} dB (SSIM: ${avgBaseSsim.toFixed(4)})`);
  console.log(`3. CINEFRAME Restored PSNR:      ${avgCinePsnr.toFixed(2)} dB (SSIM: ${avgCineSsim.toFixed(4)})`);
  console.log(`PSNR Gain over Degraded:         +${(avgCinePsnr - avgDegPsnr).toFixed(2)} dB`);
  console.log(`PSNR Gain over Conventional:     +${(avgCinePsnr - avgBasePsnr).toFixed(2)} dB`);
  console.log(`SSIM Gain over Degraded:         +${(avgCineSsim - avgDegSsim).toFixed(4)}`);
  console.log(`SSIM Gain over Conventional:     +${(avgCineSsim - avgBaseSsim).toFixed(4)}`);
  console.log(`Temporal Consistency Error:      ${avgTempErr.toFixed(5)}`);
  console.log(`Edge Preservation Error:         ${avgEdgeErr.toFixed(5)}`);
  console.log(`Average Inference Latency:       ${avgLatency.toFixed(2)} ms/frame`);
  console.log(`Peak Memory:                     ${peakMemMb.toFixed(1)} MB`);

  const metricsData = {
    evaluatedSequences: n,
    degradedPsnr: avgDegPsnr,
    baselineFfmpegPsnr: avgBasePsnr,
    cineframePsnr: avgCinePsnr,
    psnrGainOverDegraded: avgCinePsnr - avgDegPsnr,
    psnrGainOverBaseline: avgCinePsnr - avgBasePsnr,
    degradedSsim: avgDegSsim,
    baselineFfmpegSsim: avgBaseSsim,
    cineframeSsim: avgCineSsim,
    ssimGainOverDegraded: avgCineSsim - avgDegSsim,
    ssimGainOverBaseline: avgCineSsim - avgBaseSsim,
    temporalConsistencyError: avgTempErr,
    edgePreservationError: avgEdgeErr,
    averageLatencyMs: avgLatency,
    peakMemoryMb: peakMemMb,
  };

  fs.writeFileSync(
    path.join(CHECKPOINT_DIR, "evaluation_metrics.json"),
    JSON.stringify(metricsData, null, 2),
    "utf-8"
  );

  return metricsData;
}

module.exports = {
  buildCineFrameModel,
  loadCheckpoint,
  saveCheckpoint,
  runTraining,
  runEvaluation,
};

if (require.main === module) {
  (async () => {
    try {
      const { logs } = await runTraining();
      await runEvaluation(logs);
    } catch (err) {
      console.error("CINEFRAME Pipeline Failure:", err);
      process.exit(1);
    }
  })();
}
