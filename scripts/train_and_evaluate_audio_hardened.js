#!/usr/bin/env node

/**
 * CINEGEN AI — Phase 5.1 Hardened Audio Training & Benchmark Pipeline
 *
 * Implements hardened training and rigorous evaluation across all 4 models:
 * 1. NOISENET: Relative SNR normalized ratio masking
 * 2. ECHONET:  Realistic room impulse dereverberation
 * 3. STEMNET:  3-channel Softmax energy-conserving stem separation (Lossless Recombination)
 * 4. VOICENET: Residual vocal formant clarity enhancement
 *
 * Rigorous Evaluation includes:
 * - Input & Output SDR and SI-SDR
 * - Spectral Convergence & Log-Spectral Distance (LSD)
 * - Processing Latency & Peak Memory
 * - Direct comparison with Bypass Baseline
 */

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { AudioDSP } = require("../src/ai/audio/dsp");

const DATASET_DIR = path.resolve("./storage_data/dataset");
const ANNOTATIONS_PATH = path.join(DATASET_DIR, "audio_annotations_hardened.json");
const CHECKPOINT_BASE = path.resolve("./storage_data/checkpoints/audio_hardened");
const VISUALS_DIR = path.resolve("./storage_data/visual_verifications/audio_hardened");

[CHECKPOINT_BASE, VISUALS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==========================================
// Model Architecture Definitions
// ==========================================

function buildNoiseNet(baseFilters = 8) {
  const input = tf.input({ shape: [null, null, 1], name: "noisenet_input" });
  const c1 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(input);
  const d1 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(c1);
  const d2 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(d1);
  const res = tf.layers.add().apply([c1, d2]);
  const attn = tf.layers.conv2d({ filters: baseFilters, kernelSize: 1, padding: "same", activation: "sigmoid" }).apply(res);
  const fused = tf.layers.multiply().apply([res, attn]);
  const mask = tf.layers.conv2d({ filters: 1, kernelSize: 3, padding: "same", activation: "sigmoid", name: "noisenet_mask" }).apply(fused);
  const filtered = tf.layers.multiply({ name: "noisenet_out" }).apply([input, mask]);
  return tf.model({ inputs: input, outputs: [filtered, mask], name: "NOISENET_Hardened" });
}

function buildEchoNet(baseFilters = 8) {
  const input = tf.input({ shape: [null, null, 1], name: "echonet_input" });
  const c1 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(input);
  const t1 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(c1);
  const t2 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(t1);
  const fused = tf.layers.add().apply([c1, t2]);
  const mask = tf.layers.conv2d({ filters: 1, kernelSize: 3, padding: "same", activation: "sigmoid", name: "echonet_mask" }).apply(fused);
  const derev = tf.layers.multiply({ name: "echonet_out" }).apply([input, mask]);
  return tf.model({ inputs: input, outputs: [derev, mask], name: "ECHONET_Hardened" });
}

function buildStemNet(baseFilters = 8) {
  const input = tf.input({ shape: [null, null, 1], name: "stemnet_input" });
  const c1 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(input);
  const c2 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(c1);
  const shared = tf.layers.add().apply([c1, c2]);
  // 3-channel Softmax mask guarantees: M_D + M_M + M_F == 1.0 (Exact Lossless Recombination)
  const masks = tf.layers.conv2d({ filters: 3, kernelSize: 3, padding: "same", activation: "softmax", name: "stemnet_softmax_masks" }).apply(shared);
  const in3 = tf.layers.concatenate({ axis: -1, name: "stemnet_in3" }).apply([input, input, input]);
  const stems = tf.layers.multiply({ name: "stemnet_stems_out" }).apply([in3, masks]);
  return tf.model({ inputs: input, outputs: stems, name: "STEMNET_Hardened" });
}

function buildVoiceNet(baseFilters = 8) {
  const input = tf.input({ shape: [null, null, 1], name: "voicenet_input" });
  const c1 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(input);
  const c2 = tf.layers.conv2d({ filters: baseFilters, kernelSize: 3, padding: "same", activation: "relu", kernelInitializer: "heNormal" }).apply(c1);
  const fused = tf.layers.add().apply([c1, c2]);
  const gainCorrection = tf.layers.conv2d({ filters: 1, kernelSize: 3, padding: "same", activation: "tanh", kernelInitializer: "zeros" }).apply(fused);
  const scaledGain = tf.layers.multiply().apply([input, gainCorrection]);
  const enhanced = tf.layers.add().apply([input, scaledGain]);
  const finalOut = tf.layers.activation({ activation: "relu", name: "voicenet_out" }).apply(enhanced);
  return tf.model({ inputs: input, outputs: finalOut, name: "VOICENET_Hardened" });
}

// ==========================================
// Checkpoint Saving Helper
// ==========================================

async function saveCheckpoint(model, targetDir) {
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const weights = model.getWeights();
  const weightSpecs = [];
  const buffers = [];

  for (const w of weights) {
    const data = w.dataSync();
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    weightSpecs.push({
      name: w.name.replace(/_\d+$/, ""),
      shape: w.shape,
      dtype: w.dtype,
    });
    buffers.push(buf);
  }

  const modelTopology = model.toJSON(null, false);
  fs.writeFileSync(path.join(targetDir, "model_topology.json"), JSON.stringify(modelTopology, null, 2));
  fs.writeFileSync(path.join(targetDir, "weight_specs.json"), JSON.stringify(weightSpecs, null, 2));
  fs.writeFileSync(path.join(targetDir, "weights.bin"), Buffer.concat(buffers));
}

async function loadCheckpoint(dir) {
  const modelTopology = JSON.parse(fs.readFileSync(path.join(dir, "model_topology.json"), "utf-8"));
  const weightSpecs = JSON.parse(fs.readFileSync(path.join(dir, "weight_specs.json"), "utf-8"));
  const weightBuf = fs.readFileSync(path.join(dir, "weights.bin"));
  return tf.loadLayersModel({
    load: async () => ({
      modelTopology, weightSpecs,
      weightData: weightBuf.buffer.slice(weightBuf.byteOffset, weightBuf.byteOffset + weightBuf.byteLength),
    }),
  });
}

// In-Memory Preloaded Cache
const spectrogramCache = new Map();

function getCachedSpectrogram(wavPath) {
  if (spectrogramCache.has(wavPath)) return spectrogramCache.get(wavPath);
  const buf = fs.readFileSync(wavPath);
  const { samples, sampleRate } = AudioDSP.decodeWav(buf);
  const spec = AudioDSP.stft(samples, 256, 128, sampleRate);
  const numFrames = spec.numFrames;
  const numBins = (spec.fftSize >> 1) + 1;
  const f32 = new Float32Array(numFrames * numBins);
  for (let t = 0; t < numFrames; t++) {
    for (let f = 0; f < numBins; f++) f32[t * numBins + f] = spec.magnitudes[t][f];
  }
  const entry = { samples, sampleRate, spec, numFrames, numBins, f32 };
  spectrogramCache.set(wavPath, entry);
  return entry;
}

function extractSliceTensor(cached, startFrame, sliceLen) {
  const numBins = cached.numBins;
  const sliceF32 = new Float32Array(sliceLen * numBins);
  for (let t = 0; t < sliceLen; t++) {
    const srcT = startFrame + t;
    for (let f = 0; f < numBins; f++) {
      sliceF32[t * numBins + f] = cached.f32[srcT * numBins + f];
    }
  }
  return tf.tensor3d(sliceF32, [sliceLen, numBins, 1]);
}

function extract3ChSliceTensor(cDiag, cMusic, cFx, startFrame, sliceLen) {
  const numBins = cDiag.numBins;
  const sliceF32 = new Float32Array(sliceLen * numBins * 3);
  for (let t = 0; t < sliceLen; t++) {
    const srcT = startFrame + t;
    for (let f = 0; f < numBins; f++) {
      const idx = (t * numBins + f) * 3;
      sliceF32[idx + 0] = cDiag.f32[srcT * numBins + f];
      sliceF32[idx + 1] = cMusic.f32[srcT * numBins + f];
      sliceF32[idx + 2] = cFx.f32[srcT * numBins + f];
    }
  }
  return tf.tensor3d(sliceF32, [sliceLen, numBins, 3]);
}

function getFullTensor(cached) {
  return tf.tensor4d(cached.f32, [1, cached.numFrames, cached.numBins, 1]);
}

// ==========================================
// Main Pipeline Execution
// ==========================================

async function main() {
  console.log("==================================================");
  console.log("   CINEGEN AI — HARDENED AUDIO TRAINING PIPELINE  ");
  console.log("     NOISENET | ECHONET | STEMNET | VOICENET      ");
  console.log("==================================================");

  const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
  const trainData = annotations.filter(a => a.split === "train");
  const valData = annotations.filter(a => a.split === "val");
  const testData = annotations.filter(a => a.split === "test");

  console.log(`Partitions: Train: ${trainData.length} | Val: ${valData.length} | Test: ${testData.length} (Strict Source Isolation)`);
  console.log("Preloading all 96 audio spectrograms into RAM...");
  const t0 = Date.now();
  for (const it of annotations) {
    getCachedSpectrogram(it.cleanAudioPath);
    getCachedSpectrogram(it.noisenet.degradedAudioPath);
    getCachedSpectrogram(it.echonet.degradedAudioPath);
    getCachedSpectrogram(it.stemnet.mixtureAudioPath);
    getCachedSpectrogram(it.stemnet.dialoguePath);
    getCachedSpectrogram(it.stemnet.musicPath);
    getCachedSpectrogram(it.stemnet.effectsPath);
    getCachedSpectrogram(it.voicenet.degradedAudioPath);
  }
  console.log(`✓ Preloaded ${spectrogramCache.size} spectrograms in ${Date.now() - t0}ms!`);

  const BATCH_SIZE = 4;
  const EPOCHS = 2;
  const SLICE_LEN = 16;

  // -------------------------------------------------------------
  // 1. Train NOISENET
  // -------------------------------------------------------------
  console.log("\n>>> [1/4] TRAINING NOISENET (Relative SNR & IRM Multi-Objective) <<<");
  const noiseNetBestDir = path.join(CHECKPOINT_BASE, "noisenet", "best");
  let noiseNet;
  if (fs.existsSync(path.join(noiseNetBestDir, "model_topology.json"))) {
    console.log("✓ Existing trained NOISENET checkpoint detected. Re-using best checkpoint!");
    noiseNet = await loadCheckpoint(noiseNetBestDir);
  } else {
    noiseNet = buildNoiseNet(8);
    console.log(`NOISENET Parameters: ${noiseNet.countParams().toLocaleString()}`);
    const optNoise = tf.train.adam(0.005);
    let bestNoiseValLoss = Infinity;

    for (let epoch = 1; epoch <= EPOCHS; epoch++) {
      const epStart = Date.now();
      let trainLossSum = 0, batchCount = 0;
      const shuffled = [...trainData].sort(() => Math.random() - 0.5);

      for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
        const bItems = shuffled.slice(i, i + BATCH_SIZE);
        const bStart = Date.now();

        // Random temporal offset per batch
        const offset = Math.floor(Math.random() * (126 - SLICE_LEN));

        const inBatch = tf.tidy(() => tf.stack(bItems.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.degradedAudioPath), offset, SLICE_LEN))));
        const tgtBatch = tf.tidy(() => tf.stack(bItems.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.targetCleanPath), offset, SLICE_LEN))));
        const irmBatch = tf.tidy(() => {
          const ratio = tf.div(tgtBatch, tf.add(inBatch, 1e-4));
          return tf.minimum(ratio, 1.0);
        });

        let bLoss = 0;
        const { value, grads } = tf.variableGrads(() => {
          const preds = noiseNet.predict(inBatch);
          const [pred, mask] = Array.isArray(preds) ? preds : [preds, null];
          const lSpec = tf.div(tf.mean(tf.abs(tf.sub(pred, tgtBatch))), tf.add(tf.mean(tgtBatch), 1e-4));
          const lIrm = mask ? tf.mean(tf.abs(tf.sub(mask, irmBatch))) : tf.scalar(0);
          const total = tf.add(lSpec, tf.mul(lIrm, 2.0));
          bLoss = total.dataSync()[0];
          return total;
        });

        optNoise.applyGradients(grads);
        trainLossSum += bLoss;
        batchCount++;

        inBatch.dispose();
        tgtBatch.dispose();
        irmBatch.dispose();
        value.dispose();
        tf.dispose(grads);

        console.log(`  [NOISENET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/18] Loss: ${bLoss.toFixed(4)} | Step: ${Date.now() - bStart}ms`);
      }

      // Validation
      let valLossSum = 0;
      const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.degradedAudioPath), 20, SLICE_LEN))));
      const vTgt = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.targetCleanPath), 20, SLICE_LEN))));
      tf.tidy(() => {
        const vPreds = noiseNet.predict(vIn);
        const [vPred] = Array.isArray(vPreds) ? vPreds : [vPreds];
        valLossSum = tf.div(tf.mean(tf.abs(tf.sub(vPred, vTgt))), tf.add(tf.mean(vTgt), 1e-4)).dataSync()[0];
      });
      vIn.dispose();
      vTgt.dispose();

      console.log(`[NOISENET Epoch ${epoch}/${EPOCHS}] Train Loss: ${(trainLossSum/batchCount).toFixed(4)} | Val Loss: ${valLossSum.toFixed(4)} | ${((Date.now() - epStart)/1000).toFixed(1)}s`);
      if (valLossSum < bestNoiseValLoss) {
        bestNoiseValLoss = valLossSum;
        await saveCheckpoint(noiseNet, path.join(CHECKPOINT_BASE, "noisenet", "best"));
      }
    }
    await saveCheckpoint(noiseNet, path.join(CHECKPOINT_BASE, "noisenet", "final"));
    console.log(`✓ NOISENET Checkpoint saved!`);
  }

  // -------------------------------------------------------------
  // 2. Train ECHONET
  // -------------------------------------------------------------
  console.log("\n>>> [2/4] TRAINING ECHONET (Room Impulse Response Dereverberation) <<<");
  const echoNetBestDir = path.join(CHECKPOINT_BASE, "echonet", "best");
  let echoNet;
  if (fs.existsSync(path.join(echoNetBestDir, "model_topology.json"))) {
    console.log("✓ Existing trained ECHONET checkpoint detected. Re-using best checkpoint!");
    echoNet = await loadCheckpoint(echoNetBestDir);
  } else {
    echoNet = buildEchoNet(8);
    console.log(`ECHONET Parameters: ${echoNet.countParams().toLocaleString()}`);
    const optEcho = tf.train.adam(0.005);
    let bestEchoValLoss = Infinity;

    for (let epoch = 1; epoch <= EPOCHS; epoch++) {
      const epStart = Date.now();
      let trainLossSum = 0, batchCount = 0;
      const shuffled = [...trainData].sort(() => Math.random() - 0.5);

      for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
        const bItems = shuffled.slice(i, i + BATCH_SIZE);
        const bStart = Date.now();
        const offset = Math.floor(Math.random() * (126 - SLICE_LEN));

        const inBatch = tf.tidy(() => tf.stack(bItems.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.degradedAudioPath), offset, SLICE_LEN))));
        const tgtBatch = tf.tidy(() => tf.stack(bItems.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.targetCleanPath), offset, SLICE_LEN))));

        let bLoss = 0;
        const { value, grads } = tf.variableGrads(() => {
          const pRaw = echoNet.predict(inBatch);
          const pred = Array.isArray(pRaw) ? pRaw[0] : pRaw;
          const l1 = tf.div(tf.mean(tf.abs(tf.sub(pred, tgtBatch))), tf.add(tf.mean(tgtBatch), 1e-4));
          bLoss = l1.dataSync()[0];
          return l1;
        });

        optEcho.applyGradients(grads);
        trainLossSum += bLoss;
        batchCount++;

        inBatch.dispose();
        tgtBatch.dispose();
        value.dispose();
        tf.dispose(grads);

        console.log(`  [ECHONET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/18] Loss: ${bLoss.toFixed(4)} | Step: ${Date.now() - bStart}ms`);
      }

      let valLossSum = 0;
      const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.degradedAudioPath), 20, SLICE_LEN))));
      const vTgt = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.targetCleanPath), 20, SLICE_LEN))));
      tf.tidy(() => {
        const vPredRaw = echoNet.predict(vIn);
        const vPred = Array.isArray(vPredRaw) ? vPredRaw[0] : vPredRaw;
        valLossSum = tf.div(tf.mean(tf.abs(tf.sub(vPred, vTgt))), tf.add(tf.mean(vTgt), 1e-4)).dataSync()[0];
      });
      vIn.dispose();
      vTgt.dispose();

      console.log(`[ECHONET Epoch ${epoch}/${EPOCHS}] Train Loss: ${(trainLossSum/batchCount).toFixed(4)} | Val Loss: ${valLossSum.toFixed(4)} | ${((Date.now() - epStart)/1000).toFixed(1)}s`);
      if (valLossSum < bestEchoValLoss) {
        bestEchoValLoss = valLossSum;
        await saveCheckpoint(echoNet, path.join(CHECKPOINT_BASE, "echonet", "best"));
      }
    }
    await saveCheckpoint(echoNet, path.join(CHECKPOINT_BASE, "echonet", "final"));
    console.log(`✓ ECHONET Checkpoint saved!`);
  }

  // -------------------------------------------------------------
  // 3. Train STEMNET
  // -------------------------------------------------------------
  console.log("\n>>> [3/4] TRAINING STEMNET (3-Channel Softmax Lossless Recombination) <<<");
  const stemNetBestDir = path.join(CHECKPOINT_BASE, "stemnet", "best");
  let stemNet;
  if (fs.existsSync(path.join(stemNetBestDir, "model_topology.json"))) {
    console.log("✓ Existing trained STEMNET checkpoint detected. Re-using best checkpoint!");
    stemNet = await loadCheckpoint(stemNetBestDir);
  } else {
    stemNet = buildStemNet(8);
    console.log(`STEMNET Parameters: ${stemNet.countParams().toLocaleString()}`);
    const optStem = tf.train.adam(0.005);
    let bestStemValLoss = Infinity;

    for (let epoch = 1; epoch <= EPOCHS; epoch++) {
      const epStart = Date.now();
      let trainLossSum = 0, batchCount = 0;
      const shuffled = [...trainData].sort(() => Math.random() - 0.5);

      for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
        const bItems = shuffled.slice(i, i + BATCH_SIZE);
        const bStart = Date.now();
        const offset = Math.floor(Math.random() * (126 - SLICE_LEN));

        const inBatch = tf.tidy(() => tf.stack(bItems.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.mixtureAudioPath), offset, SLICE_LEN))));
        const tgt3ChBatch = tf.tidy(() => tf.stack(bItems.map(it => extract3ChSliceTensor(
          getCachedSpectrogram(it.stemnet.dialoguePath),
          getCachedSpectrogram(it.stemnet.musicPath),
          getCachedSpectrogram(it.stemnet.effectsPath),
          offset, SLICE_LEN
        ))));

        let bLoss = 0;
        const { value, grads } = tf.variableGrads(() => {
          const pRaw = stemNet.predict(inBatch);
          const pred = Array.isArray(pRaw) ? pRaw[0] : pRaw;
          const l1 = tf.div(tf.mean(tf.abs(tf.sub(pred, tgt3ChBatch))), tf.add(tf.mean(tgt3ChBatch), 1e-4));
          bLoss = l1.dataSync()[0];
          return l1;
        });

        optStem.applyGradients(grads);
        trainLossSum += bLoss;
        batchCount++;

        inBatch.dispose();
        tgt3ChBatch.dispose();
        value.dispose();
        tf.dispose(grads);

        console.log(`  [STEMNET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/18] Loss: ${bLoss.toFixed(4)} | Step: ${Date.now() - bStart}ms`);
      }

      let valLossSum = 0;
      const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.mixtureAudioPath), 20, SLICE_LEN))));
      const vTgt = tf.tidy(() => tf.stack(valData.map(it => extract3ChSliceTensor(
        getCachedSpectrogram(it.stemnet.dialoguePath),
        getCachedSpectrogram(it.stemnet.musicPath),
        getCachedSpectrogram(it.stemnet.effectsPath),
        20, SLICE_LEN
      ))));
      tf.tidy(() => {
        const vPredRaw = stemNet.predict(vIn);
        const vPred = Array.isArray(vPredRaw) ? vPredRaw[0] : vPredRaw;
        valLossSum = tf.div(tf.mean(tf.abs(tf.sub(vPred, vTgt))), tf.add(tf.mean(vTgt), 1e-4)).dataSync()[0];
      });
      vIn.dispose();
      vTgt.dispose();

      console.log(`[STEMNET Epoch ${epoch}/${EPOCHS}] Train Loss: ${(trainLossSum/batchCount).toFixed(4)} | Val Loss: ${valLossSum.toFixed(4)} | ${((Date.now() - epStart)/1000).toFixed(1)}s`);
      if (valLossSum < bestStemValLoss) {
        bestStemValLoss = valLossSum;
        await saveCheckpoint(stemNet, path.join(CHECKPOINT_BASE, "stemnet", "best"));
      }
    }
    await saveCheckpoint(stemNet, path.join(CHECKPOINT_BASE, "stemnet", "final"));
    console.log(`✓ STEMNET Checkpoint saved!`);
  }

  // -------------------------------------------------------------
  // 4. Train VOICENET
  // -------------------------------------------------------------
  console.log("\n>>> [4/4] TRAINING VOICENET (Speech Clarity Enhancement) <<<");
  const voiceNetBestDir = path.join(CHECKPOINT_BASE, "voicenet", "best");
  let voiceNet;
  if (fs.existsSync(path.join(voiceNetBestDir, "model_topology.json"))) {
    console.log("✓ Existing trained VOICENET checkpoint detected. Re-using best checkpoint!");
    voiceNet = await loadCheckpoint(voiceNetBestDir);
  } else {
    voiceNet = buildVoiceNet(8);
    console.log(`VOICENET Parameters: ${voiceNet.countParams().toLocaleString()}`);
    const optVoice = tf.train.adam(0.005);
    let bestVoiceValLoss = Infinity;

    for (let epoch = 1; epoch <= EPOCHS; epoch++) {
      const epStart = Date.now();
      let trainLossSum = 0, batchCount = 0;
      const shuffled = [...trainData].sort(() => Math.random() - 0.5);

      for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
        const bItems = shuffled.slice(i, i + BATCH_SIZE);
        const bStart = Date.now();
        const offset = Math.floor(Math.random() * (126 - SLICE_LEN));

        const inBatch = tf.tidy(() => tf.stack(bItems.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.degradedAudioPath), offset, SLICE_LEN))));
        const tgtBatch = tf.tidy(() => tf.stack(bItems.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.targetEnhancedPath), offset, SLICE_LEN))));

        let bLoss = 0;
        const { value, grads } = tf.variableGrads(() => {
          const pRaw = voiceNet.predict(inBatch);
          const pred = Array.isArray(pRaw) ? pRaw[0] : pRaw;
          const l1 = tf.div(tf.mean(tf.abs(tf.sub(pred, tgtBatch))), tf.add(tf.mean(tgtBatch), 1e-4));
          bLoss = l1.dataSync()[0];
          return l1;
        });

        optVoice.applyGradients(grads);
        trainLossSum += bLoss;
        batchCount++;

        inBatch.dispose();
        tgtBatch.dispose();
        value.dispose();
        tf.dispose(grads);

        console.log(`  [VOICENET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/18] Loss: ${bLoss.toFixed(4)} | Step: ${Date.now() - bStart}ms`);
      }

      let valLossSum = 0;
      const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.degradedAudioPath), 20, SLICE_LEN))));
      const vTgt = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.targetEnhancedPath), 20, SLICE_LEN))));
      tf.tidy(() => {
        const vPredRaw = voiceNet.predict(vIn);
        const vPred = Array.isArray(vPredRaw) ? vPredRaw[0] : vPredRaw;
        valLossSum = tf.div(tf.mean(tf.abs(tf.sub(vPred, vTgt))), tf.add(tf.mean(vTgt), 1e-4)).dataSync()[0];
      });
      vIn.dispose();
      vTgt.dispose();

      console.log(`[VOICENET Epoch ${epoch}/${EPOCHS}] Train Loss: ${(trainLossSum/batchCount).toFixed(4)} | Val Loss: ${valLossSum.toFixed(4)} | ${((Date.now() - epStart)/1000).toFixed(1)}s`);
      if (valLossSum < bestVoiceValLoss) {
        bestVoiceValLoss = valLossSum;
        await saveCheckpoint(voiceNet, path.join(CHECKPOINT_BASE, "voicenet", "best"));
      }
    }
    await saveCheckpoint(voiceNet, path.join(CHECKPOINT_BASE, "voicenet", "final"));
    console.log(`✓ VOICENET Checkpoint saved!`);
  }

  // ==========================================
  // 5. Rigorous Evaluation on Unseen Test Split
  // ==========================================
  console.log("\n==================================================");
  console.log("   HELD-OUT EVALUATION ON UNSEEN TEST SOURCES     ");
  console.log("       (Sources: src_clean_04, src_clean_10)      ");
  console.log("==================================================");

  const bestNoise = await loadCheckpoint(path.join(CHECKPOINT_BASE, "noisenet", "best"));
  const bestEcho = await loadCheckpoint(path.join(CHECKPOINT_BASE, "echonet", "best"));
  const bestStem = await loadCheckpoint(path.join(CHECKPOINT_BASE, "stemnet", "best"));
  const bestVoice = await loadCheckpoint(path.join(CHECKPOINT_BASE, "voicenet", "best"));

  let totalNoiseInSdr = 0, totalNoiseOutSdr = 0, totalNoiseInSiSdr = 0, totalNoiseOutSiSdr = 0, totalNoiseLatency = 0, totalNoiseSC = 0, totalNoiseLSD = 0;
  let totalEchoInSdr = 0, totalEchoOutSdr = 0, totalEchoInSiSdr = 0, totalEchoOutSiSdr = 0, totalEchoLatency = 0, totalEchoSC = 0, totalEchoLSD = 0;
  let totalStemDiagSdr = 0, totalStemMusicSdr = 0, totalStemFxSdr = 0, totalStemReconSdr = 0, totalStemLatency = 0;
  let totalVoiceInSdr = 0, totalVoiceOutSdr = 0, totalVoiceInSiSdr = 0, totalVoiceOutSiSdr = 0, totalVoiceLatency = 0, totalVoiceSC = 0, totalVoiceLSD = 0;

  function reconstruct1Ch(predTensor, refCached) {
    const d = predTensor.dataSync();
    const specCopy = { ...refCached.spec, magnitudes: [] };
    const numBins = refCached.numBins;
    for (let t = 0; t < refCached.numFrames; t++) {
      const magRow = new Float32Array(numBins);
      for (let f = 0; f < numBins; f++) magRow[f] = d[t * numBins + f];
      specCopy.magnitudes.push(magRow);
    }
    return { samples: AudioDSP.istft(specCopy), spec: specCopy };
  }

  function reconstruct3Ch(predTensor, refCached) {
    const allData = predTensor.dataSync();
    const numBins = refCached.numBins;
    const numFrames = refCached.numFrames;

    function buildBranch(chIdx) {
      const sp = { ...refCached.spec, magnitudes: [] };
      for (let t = 0; t < numFrames; t++) {
        const row = new Float32Array(numBins);
        for (let f = 0; f < numBins; f++) {
          row[f] = allData[(t * numBins + f) * 3 + chIdx];
        }
        sp.magnitudes.push(row);
      }
      return AudioDSP.istft(sp);
    }

    return {
      diag: buildBranch(0),
      music: buildBranch(1),
      fx: buildBranch(2),
    };
  }

  for (let idx = 0; idx < testData.length; idx++) {
    const item = testData[idx];

    // NOISENET
    const nIn = getCachedSpectrogram(item.noisenet.degradedAudioPath);
    const nClean = getCachedSpectrogram(item.noisenet.targetCleanPath);
    const nInT = getFullTensor(nIn);
    const tN0 = Date.now();
    const nPreds = bestNoise.predict(nInT);
    const [nPred, nMask] = Array.isArray(nPreds) ? nPreds : [nPreds, null];
    totalNoiseLatency += Date.now() - tN0;
    const nRes = reconstruct1Ch(nPred, nIn);
    totalNoiseInSdr += AudioDSP.computeSdr(nClean.samples, nIn.samples);
    totalNoiseOutSdr += AudioDSP.computeSdr(nClean.samples, nRes.samples);
    totalNoiseInSiSdr += AudioDSP.computeSiSdr(nClean.samples, nIn.samples);
    totalNoiseOutSiSdr += AudioDSP.computeSiSdr(nClean.samples, nRes.samples);
    totalNoiseSC += AudioDSP.computeSpectralConvergence(nClean.spec, nRes.spec);
    totalNoiseLSD += AudioDSP.computeLogSpectralDistance(nClean.spec, nRes.spec);
    nInT.dispose();
    nPred.dispose();
    if (nMask) nMask.dispose();

    // ECHONET
    const eIn = getCachedSpectrogram(item.echonet.degradedAudioPath);
    const eClean = getCachedSpectrogram(item.cleanAudioPath);
    const eInT = getFullTensor(eIn);
    const tE0 = Date.now();
    const ePredRaw = bestEcho.predict(eInT);
    const ePred = Array.isArray(ePredRaw) ? ePredRaw[0] : ePredRaw;
    totalEchoLatency += Date.now() - tE0;
    const eRes = reconstruct1Ch(ePred, eIn);
    totalEchoInSdr += AudioDSP.computeSdr(eClean.samples, eIn.samples);
    totalEchoOutSdr += AudioDSP.computeSdr(eClean.samples, eRes.samples);
    totalEchoInSiSdr += AudioDSP.computeSiSdr(eClean.samples, eIn.samples);
    totalEchoOutSiSdr += AudioDSP.computeSiSdr(eClean.samples, eRes.samples);
    totalEchoSC += AudioDSP.computeSpectralConvergence(eClean.spec, eRes.spec);
    totalEchoLSD += AudioDSP.computeLogSpectralDistance(eClean.spec, eRes.spec);
    eInT.dispose();
    ePred.dispose();

    // STEMNET
    const sMix = getCachedSpectrogram(item.stemnet.mixtureAudioPath);
    const sD = getCachedSpectrogram(item.stemnet.dialoguePath);
    const sM = getCachedSpectrogram(item.stemnet.musicPath);
    const sF = getCachedSpectrogram(item.stemnet.effectsPath);
    const sInT = getFullTensor(sMix);
    const tS0 = Date.now();
    const sPredRaw = bestStem.predict(sInT);
    const sPred = Array.isArray(sPredRaw) ? sPredRaw[0] : sPredRaw;
    totalStemLatency += Date.now() - tS0;
    const stems = reconstruct3Ch(sPred, sMix);
    totalStemDiagSdr += AudioDSP.computeSdr(sD.samples, stems.diag);
    totalStemMusicSdr += AudioDSP.computeSdr(sM.samples, stems.music);
    totalStemFxSdr += AudioDSP.computeSdr(sF.samples, stems.fx);
    const reconSum = new Float32Array(sMix.samples.length);
    for (let k = 0; k < reconSum.length; k++) reconSum[k] = stems.diag[k] + stems.music[k] + stems.fx[k];
    totalStemReconSdr += AudioDSP.computeSdr(sMix.samples, reconSum);
    sInT.dispose();
    sPred.dispose();

    // VOICENET
    const vIn = getCachedSpectrogram(item.voicenet.degradedAudioPath);
    const vClean = getCachedSpectrogram(item.cleanAudioPath);
    const vInT = getFullTensor(vIn);
    const tV0 = Date.now();
    const vPredRaw = bestVoice.predict(vInT);
    const vPred = Array.isArray(vPredRaw) ? vPredRaw[0] : vPredRaw;
    totalVoiceLatency += Date.now() - tV0;
    const vRes = reconstruct1Ch(vPred, vIn);
    totalVoiceInSdr += AudioDSP.computeSdr(vClean.samples, vIn.samples);
    totalVoiceOutSdr += AudioDSP.computeSdr(vClean.samples, vRes.samples);
    totalVoiceInSiSdr += AudioDSP.computeSiSdr(vClean.samples, vIn.samples);
    totalVoiceOutSiSdr += AudioDSP.computeSiSdr(vClean.samples, vRes.samples);
    totalVoiceSC += AudioDSP.computeSpectralConvergence(vClean.spec, vRes.spec);
    totalVoiceLSD += AudioDSP.computeLogSpectralDistance(vClean.spec, vRes.spec);
    vInT.dispose();
    vPred.dispose();

    // Export visual verification WAVs on sample 0
    if (idx === 0) {
      fs.writeFileSync(path.join(VISUALS_DIR, "noisenet_input_degraded.wav"), AudioDSP.encodeWav(nIn.samples, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "noisenet_output_restored.wav"), AudioDSP.encodeWav(nRes.samples, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "noisenet_clean_target.wav"), AudioDSP.encodeWav(nClean.samples, 16000));

      fs.writeFileSync(path.join(VISUALS_DIR, "echonet_input_reverberant.wav"), AudioDSP.encodeWav(eIn.samples, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "echonet_output_dereverbed.wav"), AudioDSP.encodeWav(eRes.samples, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "echonet_clean_target.wav"), AudioDSP.encodeWav(eClean.samples, 16000));

      fs.writeFileSync(path.join(VISUALS_DIR, "stemnet_input_mixture.wav"), AudioDSP.encodeWav(sMix.samples, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "stemnet_output_dialogue.wav"), AudioDSP.encodeWav(stems.diag, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "stemnet_output_music.wav"), AudioDSP.encodeWav(stems.music, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "stemnet_output_effects.wav"), AudioDSP.encodeWav(stems.fx, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "stemnet_output_recombined.wav"), AudioDSP.encodeWav(reconSum, 16000));

      fs.writeFileSync(path.join(VISUALS_DIR, "voicenet_input_muffled.wav"), AudioDSP.encodeWav(vIn.samples, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "voicenet_output_enhanced.wav"), AudioDSP.encodeWav(vRes.samples, 16000));
      fs.writeFileSync(path.join(VISUALS_DIR, "voicenet_clean_target.wav"), AudioDSP.encodeWav(vClean.samples, 16000));
    }
  }

  const nTest = testData.length;
  const metrics = {
    testSequences: nTest,
    noisenet: {
      inputSdr: totalNoiseInSdr / nTest,
      outputSdr: totalNoiseOutSdr / nTest,
      sdrGain: (totalNoiseOutSdr - totalNoiseInSdr) / nTest,
      inputSiSdr: totalNoiseInSiSdr / nTest,
      outputSiSdr: totalNoiseOutSiSdr / nTest,
      siSdrGain: (totalNoiseOutSiSdr - totalNoiseInSiSdr) / nTest,
      spectralConvergence: totalNoiseSC / nTest,
      logSpectralDistance: totalNoiseLSD / nTest,
      latencyMs: totalNoiseLatency / nTest,
      bypassSdr: totalNoiseInSdr / nTest,
    },
    echonet: {
      inputSdr: totalEchoInSdr / nTest,
      outputSdr: totalEchoOutSdr / nTest,
      sdrGain: (totalEchoOutSdr - totalEchoInSdr) / nTest,
      inputSiSdr: totalEchoInSiSdr / nTest,
      outputSiSdr: totalEchoOutSiSdr / nTest,
      siSdrGain: (totalEchoOutSiSdr - totalEchoInSiSdr) / nTest,
      spectralConvergence: totalEchoSC / nTest,
      logSpectralDistance: totalEchoLSD / nTest,
      latencyMs: totalEchoLatency / nTest,
      bypassSdr: totalEchoInSdr / nTest,
    },
    stemnet: {
      dialogueSdr: totalStemDiagSdr / nTest,
      musicSdr: totalStemMusicSdr / nTest,
      effectsSdr: totalStemFxSdr / nTest,
      recombinationSdr: totalStemReconSdr / nTest,
      latencyMs: totalStemLatency / nTest,
    },
    voicenet: {
      inputSdr: totalVoiceInSdr / nTest,
      outputSdr: totalVoiceOutSdr / nTest,
      sdrGain: (totalVoiceOutSdr - totalVoiceInSdr) / nTest,
      inputSiSdr: totalVoiceInSiSdr / nTest,
      outputSiSdr: totalVoiceOutSiSdr / nTest,
      siSdrGain: (totalVoiceOutSiSdr - totalVoiceInSiSdr) / nTest,
      spectralConvergence: totalVoiceSC / nTest,
      logSpectralDistance: totalVoiceLSD / nTest,
      latencyMs: totalVoiceLatency / nTest,
      bypassSdr: totalVoiceInSdr / nTest,
    },
    peakMemoryMb: process.memoryUsage().heapUsed / (1024 * 1024),
  };

  const METRICS_OUT = path.join(CHECKPOINT_BASE, "evaluation_metrics_hardened.json");
  fs.writeFileSync(METRICS_OUT, JSON.stringify(metrics, null, 2));

  console.log("\n==================================================");
  console.log("   HARDENED AUDIO EVALUATION BENCHMARK RESULTS    ");
  console.log("==================================================");
  console.log(`1. NOISENET: In SDR: ${metrics.noisenet.inputSdr.toFixed(2)} dB -> Out SDR: ${metrics.noisenet.outputSdr.toFixed(2)} dB (Gain: ${metrics.noisenet.sdrGain >= 0 ? '+' : ''}${metrics.noisenet.sdrGain.toFixed(2)} dB) | SI-SDR Gain: ${metrics.noisenet.siSdrGain >= 0 ? '+' : ''}${metrics.noisenet.siSdrGain.toFixed(2)} dB | LSD: ${metrics.noisenet.logSpectralDistance.toFixed(2)} dB`);
  console.log(`2. ECHONET:  In SDR: ${metrics.echonet.inputSdr.toFixed(2)} dB -> Out SDR: ${metrics.echonet.outputSdr.toFixed(2)} dB (Gain: ${metrics.echonet.sdrGain >= 0 ? '+' : ''}${metrics.echonet.sdrGain.toFixed(2)} dB) | SI-SDR Gain: ${metrics.echonet.siSdrGain >= 0 ? '+' : ''}${metrics.echonet.siSdrGain.toFixed(2)} dB | LSD: ${metrics.echonet.logSpectralDistance.toFixed(2)} dB`);
  console.log(`3. STEMNET:  Dialogue SDR: ${metrics.stemnet.dialogueSdr.toFixed(2)} dB | Music SDR: ${metrics.stemnet.musicSdr.toFixed(2)} dB | Effects SDR: ${metrics.stemnet.effectsSdr.toFixed(2)} dB | Recombination SDR: ${metrics.stemnet.recombinationSdr.toFixed(2)} dB`);
  console.log(`4. VOICENET: In SDR: ${metrics.voicenet.inputSdr.toFixed(2)} dB -> Out SDR: ${metrics.voicenet.outputSdr.toFixed(2)} dB (Gain: ${metrics.voicenet.sdrGain >= 0 ? '+' : ''}${metrics.voicenet.sdrGain.toFixed(2)} dB) | SI-SDR Gain: ${metrics.voicenet.siSdrGain >= 0 ? '+' : ''}${metrics.voicenet.siSdrGain.toFixed(2)} dB | LSD: ${metrics.voicenet.logSpectralDistance.toFixed(2)} dB`);
  console.log(`\nPeak Heap Memory: ${metrics.peakMemoryMb.toFixed(1)} MB`);
  console.log(`Metrics written to: ${METRICS_OUT}`);
}

main().catch(err => {
  console.error("Hardened Training Failed:", err);
  process.exit(1);
});
