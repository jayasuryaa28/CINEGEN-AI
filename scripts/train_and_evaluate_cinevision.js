#!/usr/bin/env node

/**
 * CINEGEN AI — CineVision Model Training & Test Evaluation Pipeline (Phase 3.1 Hardened)
 *
 * Trains CINEVISION neural network from randomly initialized weights
 * and benchmarks the trained checkpoint against held-out test splits.
 *
 * Upgrades:
 * - 64x64x3 input resolution (4x pixel density over 32x32)
 * - 8x8 spatial pixel occlusion segmentation mask output branch
 * - Combined BCE + Soft Dice loss on spatial occlusion mask
 * - Expanded 10-source dataset across 30 pairs with strict source isolation
 */

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { solveHomography } = require("./homography");

const DATASET_DIR = path.resolve("./storage_data/dataset");
const ANNOTATIONS_PATH = path.join(DATASET_DIR, "cinevision_annotations.json");
const CHECKPOINT_DIR = path.resolve("./storage_data/checkpoints/cinevision");

// Ensure checkpoint directories
["best", "final"].forEach((sub) => {
  const p = path.join(CHECKPOINT_DIR, sub);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ==========================================
// 1. Model Architecture Definition (64x64 with Spatial Mask Head)
// ==========================================
function buildCineVisionModel(inputShape = [64, 64, 3]) {
  const input = tf.input({ shape: inputShape, name: "cinevision_input_frame" });

  // Visual Feature Encoder (Random weights initialized)
  // Level 1: 64x64x3 -> 32x32x16
  const conv1 = tf.layers.conv2d({
    filters: 16,
    kernelSize: 3,
    strides: 2,
    padding: "same",
    kernelInitializer: "heNormal",
    activation: "relu",
    name: "encoder_conv1",
  }).apply(input);

  // Level 2: 32x32x16 -> 16x16x24
  const conv2 = tf.layers.conv2d({
    filters: 24,
    kernelSize: 3,
    strides: 2,
    padding: "same",
    kernelInitializer: "heNormal",
    activation: "relu",
    name: "encoder_conv2",
  }).apply(conv1);

  // Level 3: 16x16x24 -> 8x8x32
  const conv3 = tf.layers.conv2d({
    filters: 32,
    kernelSize: 3,
    strides: 2,
    padding: "same",
    kernelInitializer: "heNormal",
    activation: "relu",
    name: "encoder_conv3",
  }).apply(conv2);

  // Spatial Attention Core
  const spatialAttn = tf.layers.conv2d({
    filters: 1,
    kernelSize: 1,
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "spatial_attention",
  }).apply(conv3);

  const attended = tf.layers.multiply({ name: "attended_features" }).apply([conv3, spatialAttn]);

  // Spatial Occlusion Segmentation Mask Head (8x8 spatial grid = 64 pixels)
  const maskConv = tf.layers.conv2d({
    filters: 1,
    kernelSize: 3,
    padding: "same",
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "mask_conv",
  }).apply(attended);

  const outMask = tf.layers.reshape({
    targetShape: [64],
    name: "output_occlusion_mask",
  }).apply(maskConv);

  // Global Representation
  const gap = tf.layers.globalAveragePooling2d({ name: "gap" }).apply(attended);

  const denseShared = tf.layers.dense({
    units: 48,
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "dense_shared",
  }).apply(gap);

  // Head 1: Screen Corners (8 values in [0, 1])
  const headCornersDense = tf.layers.dense({
    units: 32,
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "head_corners_dense",
  }).apply(denseShared);
  const outCorners = tf.layers.dense({
    units: 8,
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "output_corners",
  }).apply(headCornersDense);

  // Head 2: Homography Matrix (8 values linear)
  const headHomoDense = tf.layers.dense({
    units: 32,
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "head_homo_dense",
  }).apply(denseShared);
  const outHomo = tf.layers.dense({
    units: 8,
    activation: "linear",
    kernelInitializer: "glorotUniform",
    name: "output_homography",
  }).apply(headHomoDense);

  // Head 3: Motion Displacement (2 values in [-1, 1])
  const headMotionDense = tf.layers.dense({
    units: 16,
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "head_motion_dense",
  }).apply(denseShared);
  const outMotion = tf.layers.dense({
    units: 2,
    activation: "tanh",
    kernelInitializer: "glorotUniform",
    name: "output_motion",
  }).apply(headMotionDense);

  // Head 4: Occlusion Summary (2 values in [0, 1])
  const headOccDense = tf.layers.dense({
    units: 16,
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "head_occ_dense",
  }).apply(denseShared);
  const outOcc = tf.layers.dense({
    units: 2,
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "output_occlusion",
  }).apply(headOccDense);

  // Head 5: Frame Quality (4 values in [0, 1])
  const headQualDense = tf.layers.dense({
    units: 32,
    activation: "relu",
    kernelInitializer: "heNormal",
    name: "head_qual_dense",
  }).apply(denseShared);
  const outQual = tf.layers.dense({
    units: 4,
    activation: "sigmoid",
    kernelInitializer: "glorotUniform",
    name: "output_quality",
  }).apply(headQualDense);

  return tf.model({
    inputs: input,
    outputs: [outCorners, outHomo, outMotion, outOcc, outQual, outMask],
    name: "CINEVISION_Net",
  });
}

// ==========================================
// 2. Multi-Task Losses (with BCE + Soft Dice Mask Loss)
// ==========================================
function computeLosses(preds, targets, weights = { corners: 2.0, homo: 0.5, motion: 1.0, occ: 1.0, qual: 1.0, mask: 1.5 }) {
  const [predCorners, predHomo, predMotion, predOcc, predQual, predMask] = preds;

  // 1. Corner Smooth L1 (Huber with delta = 0.05)
  const cornerLoss = tf.losses.huberLoss(targets.corners, predCorners, undefined, 0.05);

  // 2. Homography MSE
  const homoLoss = tf.losses.meanSquaredError(targets.homography, predHomo);

  // 3. Motion MSE
  const motionLoss = tf.losses.meanSquaredError(targets.motion, predMotion);

  // 4. Occlusion BCE + Area L1
  const occBce = tf.losses.sigmoidCrossEntropy(
    targets.occlusion.slice([0, 0], [-1, 1]),
    predOcc.slice([0, 0], [-1, 1])
  );
  const occAreaL1 = tf.mean(
    tf.abs(tf.sub(predOcc.slice([0, 1], [-1, 1]), targets.occlusion.slice([0, 1], [-1, 1])))
  );
  const occLoss = tf.add(occBce, occAreaL1);

  // 5. Quality MAE
  const qualLoss = tf.mean(tf.abs(tf.sub(predQual, targets.quality)));

  // 6. Spatial Occlusion Segmentation Mask Loss (BCE + Soft Dice)
  const maskBce = tf.losses.sigmoidCrossEntropy(targets.occlusionMask, predMask);
  const intersection = tf.sum(tf.mul(predMask, targets.occlusionMask));
  const union = tf.add(tf.sum(predMask), tf.sum(targets.occlusionMask));
  const diceLoss = tf.sub(1.0, tf.div(tf.mul(2.0, intersection), tf.add(union, 1e-5)));
  const maskLoss = tf.add(maskBce, diceLoss);

  // Total weighted loss
  const totalLoss = tf.add(
    tf.mul(weights.corners, cornerLoss),
    tf.add(
      tf.mul(weights.homo, homoLoss),
      tf.add(
        tf.mul(weights.motion, motionLoss),
        tf.add(
          tf.mul(weights.occ, occLoss),
          tf.add(
            tf.mul(weights.qual, qualLoss),
            tf.mul(weights.mask, maskLoss)
          )
        )
      )
    )
  );

  return { totalLoss, cornerLoss, homoLoss, motionLoss, occLoss, qualLoss, maskLoss };
}

// ==========================================
// 3. Dataset Loading (Direct 64x64 Native Buffers)
// ==========================================
function loadFrameTensor(framePath) {
  const rgb64Path = framePath.replace(/\.png$/, "_64.rgb");
  const rgb128Path = framePath.replace(/\.png$/, ".rgb");

  if (fs.existsSync(rgb64Path)) {
    const buffer = fs.readFileSync(rgb64Path);
    const f32 = new Float32Array(64 * 64 * 3);
    for (let i = 0; i < f32.length; i++) {
      f32[i] = buffer[i] / 255.0;
    }
    return tf.tensor3d(f32, [64, 64, 3]);
  }

  const buffer = fs.readFileSync(rgb128Path);
  const f32 = new Float32Array(64 * 64 * 3);
  let idx = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const srcIdx = (y * 2 * 128 + x * 2) * 3;
      f32[idx++] = buffer[srcIdx] / 255.0;
      f32[idx++] = buffer[srcIdx + 1] / 255.0;
      f32[idx++] = buffer[srcIdx + 2] / 255.0;
    }
  }
  return tf.tensor3d(f32, [64, 64, 3]);
}

function createBatch(samples) {
  return tf.tidy(() => {
    const frameTensors = [];
    const cornerArr = [];
    const homoArr = [];
    const motionArr = [];
    const occArr = [];
    const qualArr = [];
    const maskArr = [];

    for (const s of samples) {
      frameTensors.push(loadFrameTensor(s.framePath));
      cornerArr.push(s.groundTruth.corners);
      homoArr.push(s.groundTruth.homography);
      motionArr.push(s.groundTruth.displacement);
      occArr.push(s.groundTruth.occlusion);
      qualArr.push(s.groundTruth.quality);
      maskArr.push(s.groundTruth.occlusionMask || new Array(64).fill(0));
    }

    return {
      inputs: tf.stack(frameTensors),
      targets: {
        corners: tf.tensor2d(cornerArr, [samples.length, 8]),
        homography: tf.tensor2d(homoArr, [samples.length, 8]),
        motion: tf.tensor2d(motionArr, [samples.length, 2]),
        occlusion: tf.tensor2d(occArr, [samples.length, 2]),
        quality: tf.tensor2d(qualArr, [samples.length, 4]),
        occlusionMask: tf.tensor2d(maskArr, [samples.length, 64]),
      },
    };
  });
}

// ==========================================
// 4. Checkpoint Saving / Loading
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
  console.log("   CINEVISION NEURAL NETWORK TRAINING PIPELINE    ");
  console.log("   Phase 3.1 Hardened 64x64 Spatial Mask Architecture ");
  console.log("==================================================");
  console.log(`Backend: ${tf.getBackend()} (JavaScript CPU)`);

  const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
  const allTrain = annotations.filter((s) => s.split === "train");
  const allVal = annotations.filter((s) => s.split === "val");
  const allTest = annotations.filter((s) => s.split === "test");

  // Sample 6 representative frames per pair (across all 30 pairs) for fast CPU convergence
  // 18 train pairs * 6 frames = 108 train frames
  // 6 val pairs * 6 frames = 36 val frames
  // 6 test pairs * 6 frames = 36 test frames
  function samplePairs(samples, framesPerPair = 6) {
    const pairMap = new Map();
    for (const s of samples) {
      const pairId = s.sampleId.split("_f")[0];
      if (!pairMap.has(pairId)) pairMap.set(pairId, []);
      pairMap.get(pairId).push(s);
    }
    const result = [];
    for (const [_, list] of pairMap) {
      const step = Math.max(1, Math.floor(list.length / framesPerPair));
      for (let i = 0; i < list.length && result.filter(r => r.sampleId.startsWith(_)).length < framesPerPair; i += step) {
        result.push(list[i]);
      }
    }
    return result;
  }

  const train = samplePairs(allTrain, 6);
  const val = samplePairs(allVal, 6);
  const test = samplePairs(allTest, 6);

  console.log(`Partitions (Strict Source Separation):`);
  console.log(` - Train: ${train.length} frames (Total available: ${allTrain.length}) across Sources: ${Array.from(new Set(train.map(s => s.sourceId))).join(", ")}`);
  console.log(` - Val:   ${val.length} frames (Total available: ${allVal.length}) across Sources: ${Array.from(new Set(val.map(s => s.sourceId))).join(", ")}`);
  console.log(` - Test:  ${test.length} frames (Total available: ${allTest.length}) across Sources: ${Array.from(new Set(test.map(s => s.sourceId))).join(", ")}`);

  console.log("\nInitializing original CINEVISION 64x64 architecture from scratch...");
  const model = buildCineVisionModel([64, 64, 3]);
  console.log(`Total Trainable Parameters: ${model.countParams().toLocaleString()}`);

  const optimizer = tf.train.adam(0.003);

  const epochs = 4;
  const batchSize = 12;
  const logs = [];
  let bestValLoss = Infinity;

  console.log(`\nBeginning ${epochs} Epochs of Multi-Task Backpropagation with Spatial Mask Head...`);
  const trainingStartTime = Date.now();

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const epochStart = Date.now();
    const shuffled = [...train].sort(() => Math.random() - 0.5);

    let trainLossSum = 0;
    let cornerLossSum = 0;
    let homoLossSum = 0;
    let maskLossSum = 0;
    let batchCount = 0;

    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batchSamples = shuffled.slice(i, i + batchSize);
      if (batchSamples.length === 0) continue;

      const batch = createBatch(batchSamples);

      let bLoss = 0;
      let bCorner = 0;
      let bHomo = 0;
      let bMask = 0;

      // Forward pass + gradients via tf.variableGrads
      const { value: lossVal, grads } = tf.variableGrads(() => {
        const preds = model.predict(batch.inputs);
        const losses = computeLosses(preds, batch.targets);
        bLoss = losses.totalLoss.dataSync()[0];
        bCorner = losses.cornerLoss.dataSync()[0];
        bHomo = losses.homoLoss.dataSync()[0];
        bMask = losses.maskLoss.dataSync()[0];
        return losses.totalLoss;
      });

      // Backpropagation step
      optimizer.applyGradients(grads);

      trainLossSum += bLoss;
      cornerLossSum += bCorner;
      homoLossSum += bHomo;
      maskLossSum += bMask;
      batchCount++;

      // Cleanup batch tensors
      batch.inputs.dispose();
      batch.targets.corners.dispose();
      batch.targets.homography.dispose();
      batch.targets.motion.dispose();
      batch.targets.occlusion.dispose();
      batch.targets.quality.dispose();
      batch.targets.occlusionMask.dispose();
      lossVal.dispose();
      tf.dispose(grads);
    }

    // Validation pass
    let valLossSum = 0;
    let valCornerSum = 0;
    let valMaskSum = 0;
    let valBatchCount = 0;

    for (let i = 0; i < val.length; i += batchSize) {
      const valSamples = val.slice(i, i + batchSize);
      if (valSamples.length === 0) continue;
      const vBatch = createBatch(valSamples);

      tf.tidy(() => {
        const vPreds = model.predict(vBatch.inputs);
        const vLosses = computeLosses(vPreds, vBatch.targets);
        valLossSum += vLosses.totalLoss.dataSync()[0];
        valCornerSum += vLosses.cornerLoss.dataSync()[0];
        valMaskSum += vLosses.maskLoss.dataSync()[0];
        valBatchCount++;
      });

      vBatch.inputs.dispose();
      vBatch.targets.corners.dispose();
      vBatch.targets.homography.dispose();
      vBatch.targets.motion.dispose();
      vBatch.targets.occlusion.dispose();
      vBatch.targets.quality.dispose();
      vBatch.targets.occlusionMask.dispose();
    }

    const avgTrainTotal = trainLossSum / batchCount;
    const avgTrainCorner = cornerLossSum / batchCount;
    const avgTrainHomo = homoLossSum / batchCount;
    const avgTrainMask = maskLossSum / batchCount;
    const avgValTotal = valLossSum / valBatchCount;
    const avgValCorner = valCornerSum / valBatchCount;
    const avgValMask = valMaskSum / valBatchCount;
    const epochSec = ((Date.now() - epochStart) / 1000).toFixed(1);

    const logEntry = {
      epoch,
      trainTotalLoss: avgTrainTotal,
      trainCornerLoss: avgTrainCorner,
      trainHomoLoss: avgTrainHomo,
      trainMaskLoss: avgTrainMask,
      valTotalLoss: avgValTotal,
      valCornerLoss: avgValCorner,
      valMaskLoss: avgValMask,
      durationSec: parseFloat(epochSec),
    };
    logs.push(logEntry);

    console.log(
      `[Epoch ${epoch.toString().padStart(2, "0")}/${epochs}] ` +
        `Train Loss: ${avgTrainTotal.toFixed(4)} (Corner: ${avgTrainCorner.toFixed(4)}, Mask: ${avgTrainMask.toFixed(4)}) | ` +
        `Val Loss: ${avgValTotal.toFixed(4)} (Corner: ${avgValCorner.toFixed(4)}, Mask: ${avgValMask.toFixed(4)}) | ` +
        `${epochSec}s`
    );

    if (avgValTotal < bestValLoss) {
      bestValLoss = avgValTotal;
      await saveCheckpoint(model, path.join(CHECKPOINT_DIR, "best"));
    }
  }

  const totalTrainingSec = ((Date.now() - trainingStartTime) / 1000).toFixed(1);
  console.log(`\n✓ Training finished in ${totalTrainingSec}s! Best Validation Loss: ${bestValLoss.toFixed(4)}`);

  // Save final checkpoint and training history
  await saveCheckpoint(model, path.join(CHECKPOINT_DIR, "final"));
  fs.writeFileSync(
    path.join(CHECKPOINT_DIR, "training_history.json"),
    JSON.stringify(logs, null, 2),
    "utf-8"
  );

  return { logs, bestValLoss, testSamples: test };
}

// ==========================================
// 6. Test Evaluation
// ==========================================
function computeBoxIoU(boxA, boxB) {
  const yA = Math.max(boxA[0], boxB[0]);
  const xA = Math.max(boxA[1], boxB[1]);
  const yB = Math.min(boxA[2], boxB[2]);
  const xB = Math.min(boxA[3], boxB[3]);

  const interArea = Math.max(0, yB - yA) * Math.max(0, xB - xA);
  const boxAArea = Math.max(0, boxA[2] - boxA[0]) * Math.max(0, boxA[3] - boxA[1]);
  const boxBArea = Math.max(0, boxB[2] - boxB[0]) * Math.max(0, boxB[3] - boxB[1]);

  const unionArea = boxAArea + boxBArea - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

function computeHomographyReprojectionError(hPred, hGt) {
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  let totalDist = 0;
  for (const [x, y] of corners) {
    const denomP = hPred[6] * x + hPred[7] * y + 1;
    const xP = (hPred[0] * x + hPred[1] * y + hPred[2]) / (Math.abs(denomP) > 1e-6 ? denomP : 1e-6);
    const yP = (hPred[3] * x + hPred[4] * y + hPred[5]) / (Math.abs(denomP) > 1e-6 ? denomP : 1e-6);

    const denomG = hGt[6] * x + hGt[7] * y + 1;
    const xG = (hGt[0] * x + hGt[1] * y + hGt[2]) / (Math.abs(denomG) > 1e-6 ? denomG : 1e-6);
    const yG = (hGt[3] * x + hGt[4] * y + hGt[5]) / (Math.abs(denomG) > 1e-6 ? denomG : 1e-6);

    const dx = xP - xG;
    const dy = yP - yG;
    totalDist += Math.sqrt(dx * dx + dy * dy);
  }

  return totalDist / corners.length;
}

async function runEvaluation(trainingLogs, testSamples) {
  console.log("\n==================================================");
  console.log("   CINEVISION BENCHMARK ON HELD-OUT TEST SPLIT    ");
  console.log("==================================================");

  const bestDir = path.join(CHECKPOINT_DIR, "best");
  console.log(`Loading best trained model from: ${bestDir}`);
  const model = await loadCheckpoint(bestDir);

  const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
  const test = testSamples || annotations.filter((s) => s.split === "test");
  const testSources = Array.from(new Set(test.map((s) => s.sourceId))).join(", ");
  console.log(`Evaluating ${test.length} held-out test frames across independent Sources: ${testSources}...`);

  let totalCornerError = 0;
  let totalIoU = 0;
  let totalHomoError = 0;
  let totalMotionError = 0;
  let correctOcclusionCount = 0;
  let totalOcclusionAreaError = 0;
  let totalQualityError = 0;
  let totalLatency = 0;

  let maskTp = 0;
  let maskFp = 0;
  let maskFn = 0;
  let maskIntersection = 0;
  let maskUnion = 0;

  for (const sample of test) {
    const startT = Date.now();
    const inputTensor = tf.tidy(() => {
      const frame3d = loadFrameTensor(sample.framePath);
      return frame3d.expandDims(0);
    });

    const preds = model.predict(inputTensor);
    const latency = Date.now() - startT;
    totalLatency += latency;

    const [predCornersT, predHomoT, predMotionT, predOccT, predQualT, predMaskT] = preds;

    const predCorners = Array.from(predCornersT.dataSync());
    const predHomo = Array.from(predHomoT.dataSync());
    const predMotion = Array.from(predMotionT.dataSync());
    const predOcc = Array.from(predOccT.dataSync());
    const predQual = Array.from(predQualT.dataSync());
    const predMask = predMaskT ? Array.from(predMaskT.dataSync()) : [];

    inputTensor.dispose();
    preds.forEach((t) => t.dispose());

    // 1. Corner Error
    let sampleCornerErr = 0;
    for (let i = 0; i < 8; i++) {
      sampleCornerErr += Math.abs(predCorners[i] - sample.groundTruth.corners[i]);
    }
    totalCornerError += sampleCornerErr / 8;

    // 2. Screen Bounding Box IoU
    const predXs = [predCorners[0], predCorners[2], predCorners[4], predCorners[6]];
    const predYs = [predCorners[1], predCorners[3], predCorners[5], predCorners[7]];
    const predBox = [
      Math.min(...predYs),
      Math.min(...predXs),
      Math.max(...predYs),
      Math.max(...predXs),
    ];
    totalIoU += computeBoxIoU(predBox, sample.groundTruth.screenBox);

    // 3. Homography Reprojection Error
    totalHomoError += computeHomographyReprojectionError(predHomo, sample.groundTruth.homography);

    // 4. Motion Error
    const mDx = predMotion[0] - sample.groundTruth.displacement[0];
    const mDy = predMotion[1] - sample.groundTruth.displacement[1];
    totalMotionError += Math.sqrt(mDx * mDx + mDy * mDy);

    // 5. Occlusion Summary Accuracy & Area
    const predHasOcc = predOcc[0] >= 0.5 ? 1 : 0;
    const gtHasOcc = sample.groundTruth.occlusion[0] >= 0.5 ? 1 : 0;
    if (predHasOcc === gtHasOcc) correctOcclusionCount++;
    totalOcclusionAreaError += Math.abs(predOcc[1] - sample.groundTruth.occlusion[1]);

    // 5b. Spatial Occlusion Segmentation Mask Metrics (8x8 = 64 pixels)
    if (predMask.length > 0 && sample.groundTruth.occlusionMask) {
      const gtMask = sample.groundTruth.occlusionMask;
      for (let j = 0; j < 64; j++) {
        const p = predMask[j] >= 0.5 ? 1 : 0;
        const y = gtMask[j] >= 0.5 ? 1 : 0;
        if (p === 1 && y === 1) {
          maskTp++;
          maskIntersection++;
          maskUnion++;
        } else if (p === 1 && y === 0) {
          maskFp++;
          maskUnion++;
        } else if (p === 0 && y === 1) {
          maskFn++;
          maskUnion++;
        }
      }
    }

    // 6. Quality Error
    let qErr = 0;
    for (let i = 0; i < 4; i++) {
      qErr += Math.abs(predQual[i] - sample.groundTruth.quality[i]);
    }
    totalQualityError += qErr / 4;
  }

  const n = test.length;
  const cornerMaeNorm = totalCornerError / n;
  const cornerPixel1080p = cornerMaeNorm * 1080;
  const meanIoU = totalIoU / n;
  const meanHomoErr = totalHomoError / n;
  const meanMotionErr = totalMotionError / n;
  const occAccuracy = (correctOcclusionCount / n) * 100;
  const occAreaMae = totalOcclusionAreaError / n;
  const qualityMae = totalQualityError / n;
  const avgLatency = totalLatency / n;

  const maskPrecision = maskTp + maskFp > 0 ? (maskTp / (maskTp + maskFp)) * 100 : 100;
  const maskRecall = maskTp + maskFn > 0 ? (maskTp / (maskTp + maskFn)) * 100 : 100;
  const maskIoU = maskUnion > 0 ? (maskIntersection / maskUnion) * 100 : 100;

  console.log("\n--- BENCHMARK RESULTS ---");
  console.log(`Evaluated Test Frames:           ${n}`);
  console.log(`Corner Coordinate Error:         ${cornerMaeNorm.toFixed(4)} normalized (${cornerPixel1080p.toFixed(1)} px at 1080p)`);
  console.log(`Screen Boundary IoU:             ${(meanIoU * 100).toFixed(2)}%`);
  console.log(`Homography Reprojection Error:   ${meanHomoErr.toFixed(4)} normalized units`);
  console.log(`Camera Shake Error:              ${meanMotionErr.toFixed(4)} normalized`);
  console.log(`Occlusion Detection Accuracy:    ${occAccuracy.toFixed(1)}% (Area MAE: ${occAreaMae.toFixed(4)})`);
  console.log(`Occlusion Mask Pixel Precision:  ${maskPrecision.toFixed(1)}%`);
  console.log(`Occlusion Mask Pixel Recall:     ${maskRecall.toFixed(1)}%`);
  console.log(`Occlusion Mask Pixel IoU:        ${maskIoU.toFixed(1)}%`);
  console.log(`Quality Estimation MAE:          ${qualityMae.toFixed(4)}`);
  console.log(`Average Inference Latency:       ${avgLatency.toFixed(2)} ms/frame`);

  const metricsData = {
    evaluatedFrames: n,
    cornerMaeNormalized: cornerMaeNorm,
    cornerPixel1080p,
    meanScreenIoU: meanIoU,
    homographyReprojectionError: meanHomoErr,
    motionError: meanMotionErr,
    occlusionAccuracy: occAccuracy,
    occlusionAreaMae: occAreaMae,
    occlusionMaskPrecision: maskPrecision,
    occlusionMaskRecall: maskRecall,
    occlusionMaskIoU: maskIoU,
    qualityMae,
    averageLatencyMs: avgLatency,
  };

  fs.writeFileSync(
    path.join(CHECKPOINT_DIR, "evaluation_metrics.json"),
    JSON.stringify(metricsData, null, 2),
    "utf-8"
  );

  return metricsData;
}

module.exports = {
  buildCineVisionModel,
  loadCheckpoint,
  saveCheckpoint,
  runTraining,
  runEvaluation,
};

// ==========================================
// 7. Execution Entrypoint
// ==========================================
if (require.main === module) {
  (async () => {
    try {
      const { logs, bestValLoss, testSamples } = await runTraining();
      await runEvaluation(logs, testSamples);
    } catch (err) {
      console.error("Pipeline failure:", err);
      process.exit(1);
    }
  })();
}
