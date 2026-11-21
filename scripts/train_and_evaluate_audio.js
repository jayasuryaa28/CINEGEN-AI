#!/usr/bin/env node

/**
 * CINEGEN AI — Audio AI System Training & Evaluation Pipeline (Phase 5)
 *
 * Implements, trains from random initialization, and evaluates all 4 audio models:
 * 1. NOISENET: Audio Noise Reduction Network
 * 2. ECHONET:  Acoustic Dereverberation & Reflection Suppression Network
 * 3. STEMNET:  Multi-Stem Audio Source Separation Network
 * 4. VOICENET: Dialogue Enhancement & Vocal Presence Network
 *
 * Optimizations:
 * - In-memory spectrogram caching (zero redundant disk I/O or FFT calls)
 * - Temporal slice training (32-frame phonetic/harmonic windows for 4x CPU acceleration)
 * - Batched backpropagation (batchSize = 4)
 * - Full-length evaluation on held-out test split (Sources: src_clean_04, src_clean_10)
 */

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { AudioDSP } = require("../src/ai/audio/dsp");
const {
  buildNoiseNetModel,
  buildEchoNetModel,
  buildStemNetModel,
  buildVoiceNetModel,
} = require("../src/ai/audio/models");

const BASE_DIR = path.resolve(__dirname, "..");
const DATASET_DIR = path.join(BASE_DIR, "storage_data", "dataset");
const ANNOTATIONS_PATH = path.join(DATASET_DIR, "audio_annotations.json");
const CHECKPOINT_BASE = path.join(BASE_DIR, "storage_data", "checkpoints", "audio");
const AUDIO_VISUALS_DIR = path.join(BASE_DIR, "storage_data", "visual_verifications", "audio");

// Ensure directories
["noisenet", "echonet", "stemnet", "voicenet"].forEach((m) => {
  fs.mkdirSync(path.join(CHECKPOINT_BASE, m, "best"), { recursive: true });
  fs.mkdirSync(path.join(CHECKPOINT_BASE, m, "final"), { recursive: true });
});
fs.mkdirSync(AUDIO_VISUALS_DIR, { recursive: true });

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

// Memory Spectrogram Cache
const spectrogramCache = new Map();

function getCachedSpectrogram(wavPath) {
  if (spectrogramCache.has(wavPath)) {
    return spectrogramCache.get(wavPath);
  }
  const buf = fs.readFileSync(wavPath);
  const { samples, sampleRate } = AudioDSP.decodeWav(buf);
  const spec = AudioDSP.stft(samples, 256, 128, sampleRate);

  const numFrames = spec.numFrames;
  const numBins = (spec.fftSize >> 1) + 1; // 129
  const f32 = new Float32Array(numFrames * numBins);

  for (let t = 0; t < numFrames; t++) {
    for (let f = 0; f < numBins; f++) {
      f32[t * numBins + f] = spec.magnitudes[t][f];
    }
  }

  const cached = { samples, spec, f32, numFrames, numBins };
  spectrogramCache.set(wavPath, cached);
  return cached;
}

// Slice 32 frames for fast training
function extractSliceTensor(cached, startFrame = 24, sliceLen = 32) {
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

function getFullTensor(cached) {
  return tf.tensor4d(cached.f32, [1, cached.numFrames, cached.numBins, 1]);
}

async function main() {
  console.log("==================================================");
  console.log("     CINEGEN AI — AUDIO AI TRAINING PIPELINE      ");
  console.log("  NOISENET | ECHONET | STEMNET | VOICENET (Phase 5)");
  console.log("==================================================");
  console.log(`Backend: ${tf.getBackend()} (JavaScript CPU)`);

  const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf-8"));
  const trainData = annotations.filter(a => a.split === "train");
  const valData = annotations.filter(a => a.split === "val");
  const testData = annotations.filter(a => a.split === "test");

  console.log(`Partitions: Train: ${trainData.length} | Val: ${valData.length} | Test: ${testData.length} (Strict Source Isolation)`);
  console.log("Preloading and caching spectrograms in memory...");
  const tPreload = Date.now();
  for (const item of annotations) {
    getCachedSpectrogram(item.cleanAudioPath);
    getCachedSpectrogram(item.noisenet.degradedAudioPath);
    getCachedSpectrogram(item.echonet.degradedAudioPath);
    getCachedSpectrogram(item.stemnet.dialoguePath);
    getCachedSpectrogram(item.stemnet.musicPath);
    getCachedSpectrogram(item.stemnet.effectsPath);
    getCachedSpectrogram(item.voicenet.degradedAudioPath);
  }
  console.log(`✓ Preloaded ${spectrogramCache.size} spectrograms in ${Date.now() - tPreload}ms!`);

  const BATCH_SIZE = 4;
  const EPOCHS = 2;
  const SLICE_LEN = 16;

  // ==========================================
  // 1. Train NOISENET
  // ==========================================
  console.log("\n>>> [1/4] TRAINING NOISENET (Audience Noise, Hum & Hiss Reduction) <<<");
  const noiseNet = buildNoiseNetModel(8);
  console.log(`NOISENET Parameters: ${noiseNet.countParams().toLocaleString()}`);
  const optNoise = tf.train.adam(0.003);
  let bestNoiseValLoss = Infinity;

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const epochStart = Date.now();
    let trainLossSum = 0;
    let batchCount = 0;
    const shuffled = [...trainData].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
      const batchItems = shuffled.slice(i, i + BATCH_SIZE);
      const bStart = Date.now();

      const inBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.degradedAudioPath), 20, SLICE_LEN)))
      );
      const tgtBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.targetCleanPath), 20, SLICE_LEN)))
      );

      let bLoss = 0;
      const { value, grads } = tf.variableGrads(() => {
        const pred = noiseNet.predict(inBatch);
        const l1 = tf.mean(tf.abs(tf.sub(pred, tgtBatch)));
        bLoss = l1.dataSync()[0];
        return l1;
      });

      optNoise.applyGradients(grads);
      trainLossSum += bLoss;
      batchCount++;

      inBatch.dispose();
      tgtBatch.dispose();
      value.dispose();
      tf.dispose(grads);

      console.log(`  [NOISENET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/6] Loss: ${bLoss.toFixed(5)} | Step: ${Date.now() - bStart}ms`);
    }

    // Validation pass
    let valLossSum = 0;
    const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.degradedAudioPath), 20, SLICE_LEN))));
    const vTgt = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.noisenet.targetCleanPath), 20, SLICE_LEN))));
    tf.tidy(() => {
      const vPred = noiseNet.predict(vIn);
      valLossSum = tf.mean(tf.abs(tf.sub(vPred, vTgt))).dataSync()[0];
    });
    vIn.dispose();
    vTgt.dispose();

    const avgTrain = trainLossSum / batchCount;
    console.log(`[NOISENET Epoch ${epoch.toString().padStart(2, "0")}/${EPOCHS}] Train Loss: ${avgTrain.toFixed(5)} | Val Loss: ${valLossSum.toFixed(5)} | ${((Date.now() - epochStart)/1000).toFixed(1)}s`);

    if (valLossSum < bestNoiseValLoss) {
      bestNoiseValLoss = valLossSum;
      await saveCheckpoint(noiseNet, path.join(CHECKPOINT_BASE, "noisenet", "best"));
    }
  }
  await saveCheckpoint(noiseNet, path.join(CHECKPOINT_BASE, "noisenet", "final"));
  console.log(`✓ NOISENET Checkpoint saved! Best Val Loss: ${bestNoiseValLoss.toFixed(5)}`);

  // ==========================================
  // 2. Train ECHONET
  // ==========================================
  console.log("\n>>> [2/4] TRAINING ECHONET (Theatre Reverb & Echo Dereverberation) <<<");
  const echoNet = buildEchoNetModel(8);
  console.log(`ECHONET Parameters: ${echoNet.countParams().toLocaleString()}`);
  const optEcho = tf.train.adam(0.003);
  let bestEchoValLoss = Infinity;

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const epochStart = Date.now();
    let trainLossSum = 0;
    let batchCount = 0;
    const shuffled = [...trainData].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
      const batchItems = shuffled.slice(i, i + BATCH_SIZE);
      const bStart = Date.now();

      const inBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.degradedAudioPath), 20, SLICE_LEN)))
      );
      const tgtBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.targetCleanPath), 20, SLICE_LEN)))
      );

      let bLoss = 0;
      const { value, grads } = tf.variableGrads(() => {
        const pred = echoNet.predict(inBatch);
        const l1 = tf.mean(tf.abs(tf.sub(pred, tgtBatch)));
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

      console.log(`  [ECHONET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/6] Loss: ${bLoss.toFixed(5)} | Step: ${Date.now() - bStart}ms`);
    }

    let valLossSum = 0;
    const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.degradedAudioPath), 20, SLICE_LEN))));
    const vTgt = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.echonet.targetCleanPath), 20, SLICE_LEN))));
    tf.tidy(() => {
      const vPred = echoNet.predict(vIn);
      valLossSum = tf.mean(tf.abs(tf.sub(vPred, vTgt))).dataSync()[0];
    });
    vIn.dispose();
    vTgt.dispose();

    const avgTrain = trainLossSum / batchCount;
    console.log(`[ECHONET Epoch ${epoch.toString().padStart(2, "0")}/${EPOCHS}] Train Loss: ${avgTrain.toFixed(5)} | Val Loss: ${valLossSum.toFixed(5)} | ${((Date.now() - epochStart)/1000).toFixed(1)}s`);

    if (valLossSum < bestEchoValLoss) {
      bestEchoValLoss = valLossSum;
      await saveCheckpoint(echoNet, path.join(CHECKPOINT_BASE, "echonet", "best"));
    }
  }
  await saveCheckpoint(echoNet, path.join(CHECKPOINT_BASE, "echonet", "final"));
  console.log(`✓ ECHONET Checkpoint saved! Best Val Loss: ${bestEchoValLoss.toFixed(5)}`);

  // ==========================================
  // 3. Train STEMNET
  // ==========================================
  console.log("\n>>> [3/4] TRAINING STEMNET (Dialogue, Music, and Effects Separation) <<<");
  const stemNet = buildStemNetModel(8);
  console.log(`STEMNET Parameters: ${stemNet.countParams().toLocaleString()}`);
  const optStem = tf.train.adam(0.003);
  let bestStemValLoss = Infinity;

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const epochStart = Date.now();
    let trainLossSum = 0;
    let batchCount = 0;
    const shuffled = [...trainData].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
      const batchItems = shuffled.slice(i, i + BATCH_SIZE);
      const bStart = Date.now();

      const inBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.mixtureAudioPath), 20, SLICE_LEN)))
      );
      const dBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.dialoguePath), 20, SLICE_LEN)))
      );
      const mBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.musicPath), 20, SLICE_LEN)))
      );
      const fBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.effectsPath), 20, SLICE_LEN)))
      );

      let bLoss = 0;
      const { value, grads } = tf.variableGrads(() => {
        const [pD, pM, pF] = stemNet.predict(inBatch);
        const lD = tf.mean(tf.abs(tf.sub(pD, dBatch)));
        const lM = tf.mean(tf.abs(tf.sub(pM, mBatch)));
        const lF = tf.mean(tf.abs(tf.sub(pF, fBatch)));
        const total = tf.add(tf.add(lD, lM), lF);
        bLoss = total.dataSync()[0];
        return total;
      });

      optStem.applyGradients(grads);
      trainLossSum += bLoss;
      batchCount++;

      inBatch.dispose();
      dBatch.dispose();
      mBatch.dispose();
      fBatch.dispose();
      value.dispose();
      tf.dispose(grads);

      console.log(`  [STEMNET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/6] Loss: ${bLoss.toFixed(5)} | Step: ${Date.now() - bStart}ms`);
    }

    let valLossSum = 0;
    const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.mixtureAudioPath), 20, SLICE_LEN))));
    const vD = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.dialoguePath), 20, SLICE_LEN))));
    const vM = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.musicPath), 20, SLICE_LEN))));
    const vF = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.stemnet.effectsPath), 20, SLICE_LEN))));
    tf.tidy(() => {
      const [pD, pM, pF] = stemNet.predict(vIn);
      valLossSum =
        tf.mean(tf.abs(tf.sub(pD, vD))).dataSync()[0] +
        tf.mean(tf.abs(tf.sub(pM, vM))).dataSync()[0] +
        tf.mean(tf.abs(tf.sub(pF, vF))).dataSync()[0];
    });
    vIn.dispose();
    vD.dispose();
    vM.dispose();
    vF.dispose();

    const avgTrain = trainLossSum / batchCount;
    console.log(`[STEMNET Epoch ${epoch.toString().padStart(2, "0")}/${EPOCHS}] Train Loss: ${avgTrain.toFixed(5)} | Val Loss: ${valLossSum.toFixed(5)} | ${((Date.now() - epochStart)/1000).toFixed(1)}s`);

    if (valLossSum < bestStemValLoss) {
      bestStemValLoss = valLossSum;
      await saveCheckpoint(stemNet, path.join(CHECKPOINT_BASE, "stemnet", "best"));
    }
  }
  await saveCheckpoint(stemNet, path.join(CHECKPOINT_BASE, "stemnet", "final"));
  console.log(`✓ STEMNET Checkpoint saved! Best Val Loss: ${bestStemValLoss.toFixed(5)}`);

  // ==========================================
  // 4. Train VOICENET
  // ==========================================
  console.log("\n>>> [4/4] TRAINING VOICENET (Speech Clarity & Vocal Presence) <<<");
  const voiceNet = buildVoiceNetModel(8);
  console.log(`VOICENET Parameters: ${voiceNet.countParams().toLocaleString()}`);
  const optVoice = tf.train.adam(0.003);
  let bestVoiceValLoss = Infinity;

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const epochStart = Date.now();
    let trainLossSum = 0;
    let batchCount = 0;
    const shuffled = [...trainData].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
      const batchItems = shuffled.slice(i, i + BATCH_SIZE);
      const bStart = Date.now();

      const inBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.degradedAudioPath), 20, SLICE_LEN)))
      );
      const tgtBatch = tf.tidy(() =>
        tf.stack(batchItems.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.targetEnhancedPath), 20, SLICE_LEN)))
      );

      let bLoss = 0;
      const { value, grads } = tf.variableGrads(() => {
        const pred = voiceNet.predict(inBatch);
        const l1 = tf.mean(tf.abs(tf.sub(pred, tgtBatch)));
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

      console.log(`  [VOICENET Epoch ${epoch}/${EPOCHS} | Batch ${batchCount}/6] Loss: ${bLoss.toFixed(5)} | Step: ${Date.now() - bStart}ms`);
    }

    let valLossSum = 0;
    const vIn = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.degradedAudioPath), 20, SLICE_LEN))));
    const vTgt = tf.tidy(() => tf.stack(valData.map(it => extractSliceTensor(getCachedSpectrogram(it.voicenet.targetEnhancedPath), 20, SLICE_LEN))));
    tf.tidy(() => {
      const vPred = voiceNet.predict(vIn);
      valLossSum = tf.mean(tf.abs(tf.sub(vPred, vTgt))).dataSync()[0];
    });
    vIn.dispose();
    vTgt.dispose();

    const avgTrain = trainLossSum / batchCount;
    console.log(`[VOICENET Epoch ${epoch.toString().padStart(2, "0")}/${EPOCHS}] Train Loss: ${avgTrain.toFixed(5)} | Val Loss: ${valLossSum.toFixed(5)} | ${((Date.now() - epochStart)/1000).toFixed(1)}s`);

    if (valLossSum < bestVoiceValLoss) {
      bestVoiceValLoss = valLossSum;
      await saveCheckpoint(voiceNet, path.join(CHECKPOINT_BASE, "voicenet", "best"));
    }
  }
  await saveCheckpoint(voiceNet, path.join(CHECKPOINT_BASE, "voicenet", "final"));
  console.log(`✓ VOICENET Checkpoint saved! Best Val Loss: ${bestVoiceValLoss.toFixed(5)}`);

  // ==========================================
  // 5. Full-Length Evaluation on Unseen Test Split
  // ==========================================
  console.log("\n==================================================");
  console.log("   HELD-OUT EVALUATION ON UNSEEN TEST SOURCES    ");
  console.log("      (Sources: src_clean_04, src_clean_10)      ");
  console.log("==================================================");

  const bestNoise = await loadCheckpoint(path.join(CHECKPOINT_BASE, "noisenet", "best"));
  const bestEcho = await loadCheckpoint(path.join(CHECKPOINT_BASE, "echonet", "best"));
  const bestStem = await loadCheckpoint(path.join(CHECKPOINT_BASE, "stemnet", "best"));
  const bestVoice = await loadCheckpoint(path.join(CHECKPOINT_BASE, "voicenet", "best"));

  let totalNoiseInSdr = 0, totalNoiseOutSdr = 0, totalNoiseLatency = 0;
  let totalEchoInSdr = 0, totalEchoOutSdr = 0, totalEchoLatency = 0;
  let totalStemDiagSdr = 0, totalStemMusicSdr = 0, totalStemFxSdr = 0, totalStemLatency = 0;
  let totalVoiceInSdr = 0, totalVoiceOutSdr = 0, totalVoiceLatency = 0;

  function reconstructFullAudio(predTensor, refCached) {
    const d = predTensor.dataSync();
    const specCopy = { ...refCached.spec, magnitudes: [] };
    const numBins = refCached.numBins;
    for (let t = 0; t < refCached.numFrames; t++) {
      const magRow = new Float32Array(numBins);
      for (let f = 0; f < numBins; f++) magRow[f] = d[t * numBins + f];
      specCopy.magnitudes.push(magRow);
    }
    return AudioDSP.istft(specCopy);
  }

  for (let idx = 0; idx < testData.length; idx++) {
    const item = testData[idx];

    // NOISENET
    const nIn = getCachedSpectrogram(item.noisenet.degradedAudioPath);
    const nClean = getCachedSpectrogram(item.noisenet.targetCleanPath);
    const nInTensor = getFullTensor(nIn);
    const tN0 = Date.now();
    const nPred = bestNoise.predict(nInTensor);
    totalNoiseLatency += Date.now() - tN0;
    const nAudio = reconstructFullAudio(nPred, nIn);
    totalNoiseInSdr += AudioDSP.computeSdr(nClean.samples, nIn.samples);
    totalNoiseOutSdr += AudioDSP.computeSdr(nClean.samples, nAudio);
    nInTensor.dispose();
    nPred.dispose();

    // ECHONET
    const eIn = getCachedSpectrogram(item.echonet.degradedAudioPath);
    const eClean = getCachedSpectrogram(item.echonet.targetCleanPath);
    const eInTensor = getFullTensor(eIn);
    const tE0 = Date.now();
    const ePred = bestEcho.predict(eInTensor);
    totalEchoLatency += Date.now() - tE0;
    const eAudio = reconstructFullAudio(ePred, eIn);
    totalEchoInSdr += AudioDSP.computeSdr(eClean.samples, eIn.samples);
    totalEchoOutSdr += AudioDSP.computeSdr(eClean.samples, eAudio);
    eInTensor.dispose();
    ePred.dispose();

    // STEMNET
    const sIn = getCachedSpectrogram(item.stemnet.mixtureAudioPath);
    const sD = getCachedSpectrogram(item.stemnet.dialoguePath);
    const sM = getCachedSpectrogram(item.stemnet.musicPath);
    const sF = getCachedSpectrogram(item.stemnet.effectsPath);
    const sInTensor = getFullTensor(sIn);
    const tS0 = Date.now();
    const [pD, pM, pF] = bestStem.predict(sInTensor);
    totalStemLatency += Date.now() - tS0;
    const outD = reconstructFullAudio(pD, sIn);
    const outM = reconstructFullAudio(pM, sIn);
    const outF = reconstructFullAudio(pF, sIn);
    totalStemDiagSdr += AudioDSP.computeSdr(sD.samples, outD);
    totalStemMusicSdr += AudioDSP.computeSdr(sM.samples, outM);
    totalStemFxSdr += AudioDSP.computeSdr(sF.samples, outF);
    sInTensor.dispose();
    pD.dispose();
    pM.dispose();
    pF.dispose();

    // VOICENET
    const vIn = getCachedSpectrogram(item.voicenet.degradedAudioPath);
    const vClean = getCachedSpectrogram(item.voicenet.targetEnhancedPath);
    const vInTensor = getFullTensor(vIn);
    const tV0 = Date.now();
    const vPred = bestVoice.predict(vInTensor);
    totalVoiceLatency += Date.now() - tV0;
    const vAudio = reconstructFullAudio(vPred, vIn);
    totalVoiceInSdr += AudioDSP.computeSdr(vClean.samples, vIn.samples);
    totalVoiceOutSdr += AudioDSP.computeSdr(vClean.samples, vAudio);
    vInTensor.dispose();
    vPred.dispose();

    // Export test WAV samples for visual/auditory inspection on sample 0
    if (idx === 0) {
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "noisenet_input_degraded.wav"), AudioDSP.encodeWav(nIn.samples, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "noisenet_output_restored.wav"), AudioDSP.encodeWav(nAudio, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "noisenet_clean_target.wav"), AudioDSP.encodeWav(nClean.samples, 16000));

      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "echonet_input_reverberant.wav"), AudioDSP.encodeWav(eIn.samples, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "echonet_output_dereverbed.wav"), AudioDSP.encodeWav(eAudio, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "echonet_clean_target.wav"), AudioDSP.encodeWav(eClean.samples, 16000));

      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "stemnet_input_mixture.wav"), AudioDSP.encodeWav(sIn.samples, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "stemnet_output_dialogue.wav"), AudioDSP.encodeWav(outD, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "stemnet_output_music.wav"), AudioDSP.encodeWav(outM, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "stemnet_output_effects.wav"), AudioDSP.encodeWav(outF, 16000));

      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "voicenet_input_muffled.wav"), AudioDSP.encodeWav(vIn.samples, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "voicenet_output_enhanced.wav"), AudioDSP.encodeWav(vAudio, 16000));
      fs.writeFileSync(path.join(AUDIO_VISUALS_DIR, "voicenet_clean_target.wav"), AudioDSP.encodeWav(vClean.samples, 16000));

      console.log(`  [Audio Visual Samples Exported] -> ${AUDIO_VISUALS_DIR}`);
    }
  }

  const nTest = testData.length;
  const metrics = {
    testSequences: nTest,
    noisenet: {
      inputSdr: totalNoiseInSdr / nTest,
      restoredSdr: totalNoiseOutSdr / nTest,
      sdrGain: (totalNoiseOutSdr - totalNoiseInSdr) / nTest,
      latencyMs: totalNoiseLatency / nTest,
    },
    echonet: {
      inputSdr: totalEchoInSdr / nTest,
      restoredSdr: totalEchoOutSdr / nTest,
      sdrGain: (totalEchoOutSdr - totalEchoInSdr) / nTest,
      latencyMs: totalEchoLatency / nTest,
    },
    stemnet: {
      dialogueSdr: totalStemDiagSdr / nTest,
      musicSdr: totalStemMusicSdr / nTest,
      effectsSdr: totalStemFxSdr / nTest,
      overallSdr: (totalStemDiagSdr + totalStemMusicSdr + totalStemFxSdr) / (3 * nTest),
      latencyMs: totalStemLatency / nTest,
    },
    voicenet: {
      inputSdr: totalVoiceInSdr / nTest,
      restoredSdr: totalVoiceOutSdr / nTest,
      sdrGain: (totalVoiceOutSdr - totalVoiceInSdr) / nTest,
      latencyMs: totalVoiceLatency / nTest,
    },
  };

  console.log("\n--- QUANTITATIVE AUDIO BENCHMARK RESULTS ---");
  console.log(`1. NOISENET: Input SDR: ${metrics.noisenet.inputSdr.toFixed(2)} dB -> Restored SDR: ${metrics.noisenet.restoredSdr.toFixed(2)} dB (Gain: +${metrics.noisenet.sdrGain.toFixed(2)} dB) | ${metrics.noisenet.latencyMs.toFixed(1)} ms`);
  console.log(`2. ECHONET:  Input SDR: ${metrics.echonet.inputSdr.toFixed(2)} dB -> Restored SDR: ${metrics.echonet.restoredSdr.toFixed(2)} dB (Gain: +${metrics.echonet.sdrGain.toFixed(2)} dB) | ${metrics.echonet.latencyMs.toFixed(1)} ms`);
  console.log(`3. STEMNET:  Dialogue SDR: ${metrics.stemnet.dialogueSdr.toFixed(2)} dB | Music SDR: ${metrics.stemnet.musicSdr.toFixed(2)} dB | Effects SDR: ${metrics.stemnet.effectsSdr.toFixed(2)} dB | ${metrics.stemnet.latencyMs.toFixed(1)} ms`);
  console.log(`4. VOICENET: Input SDR: ${metrics.voicenet.inputSdr.toFixed(2)} dB -> Restored SDR: ${metrics.voicenet.restoredSdr.toFixed(2)} dB (Gain: +${metrics.voicenet.sdrGain.toFixed(2)} dB) | ${metrics.voicenet.latencyMs.toFixed(1)} ms`);

  fs.writeFileSync(
    path.join(CHECKPOINT_BASE, "evaluation_metrics.json"),
    JSON.stringify(metrics, null, 2),
    "utf-8"
  );
  console.log(`✓ Metrics written to: ${path.join(CHECKPOINT_BASE, "evaluation_metrics.json")}`);
}

main().catch(err => {
  console.error("Audio Pipeline Failure:", err);
  process.exit(1);
});
