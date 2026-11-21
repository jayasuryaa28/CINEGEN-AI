const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");
const { AudioDSP } = require("./dsp");

const DEFAULT_STORAGE = process.env.STORAGE_LOCAL_DIR || "./storage_data";

// Helper for model loading
async function loadAudioModel(checkpointDir) {
  const topologyPath = path.join(checkpointDir, "model_topology.json");
  const specsPath = path.join(checkpointDir, "weight_specs.json");
  const weightsPath = path.join(checkpointDir, "weights.bin");

  if (!fs.existsSync(topologyPath) || !fs.existsSync(weightsPath)) {
    throw new Error(`Audio checkpoint not found at: ${checkpointDir}`);
  }

  const modelTopology = JSON.parse(fs.readFileSync(topologyPath, "utf-8"));
  const weightSpecs = JSON.parse(fs.readFileSync(specsPath, "utf-8"));
  const weightBuf = fs.readFileSync(weightsPath);

  const handler = {
    load: async () => ({
      modelTopology,
      weightSpecs,
      weightData: weightBuf.buffer.slice(
        weightBuf.byteOffset,
        weightBuf.byteOffset + weightBuf.byteLength
      ),
    }),
  };

  return tf.loadLayersModel(handler);
}

// Memory-safe chunked spectrogram processing helper
async function processAudioChunked(samples, sampleRate, processSpectrogramFn) {
  const CHUNK_SIZE = 16000; // 1 second chunks at 16kHz
  const HOP = 12000;        // 25% overlap for seamless crossfading
  const n = samples.length;

  if (n <= CHUNK_SIZE) {
    const spec = AudioDSP.stft(samples, 256, 128, sampleRate);
    const numFrames = spec.numFrames;
    const numBins = (spec.fftSize >> 1) + 1;
    const f32 = new Float32Array(numFrames * numBins);

    for (let t = 0; t < numFrames; t++) {
      for (let f = 0; f < numBins; f++) {
        f32[t * numBins + f] = spec.magnitudes[t][f];
      }
    }

    const inTensor = tf.tensor4d(f32, [1, numFrames, numBins, 1]);
    const outTensor = processSpectrogramFn(inTensor);
    const outData = outTensor.dataSync();

    inTensor.dispose();
    outTensor.dispose();

    const outSpec = { ...spec, magnitudes: [] };
    for (let t = 0; t < numFrames; t++) {
      const magRow = new Float32Array(numBins);
      for (let f = 0; f < numBins; f++) {
        magRow[f] = outData[t * numBins + f];
      }
      outSpec.magnitudes.push(magRow);
    }

    return AudioDSP.istft(outSpec);
  }

  // Multi-chunk overlap-add
  const output = new Float32Array(n);
  const weights = new Float32Array(n);

  for (let start = 0; start < n; start += HOP) {
    const end = Math.min(n, start + CHUNK_SIZE);
    const chunk = samples.subarray(start, end);
    const paddedChunk = new Float32Array(CHUNK_SIZE);
    paddedChunk.set(chunk);

    const spec = AudioDSP.stft(paddedChunk, 256, 128, sampleRate);
    const numFrames = spec.numFrames;
    const numBins = (spec.fftSize >> 1) + 1;
    const f32 = new Float32Array(numFrames * numBins);

    for (let t = 0; t < numFrames; t++) {
      for (let f = 0; f < numBins; f++) {
        f32[t * numBins + f] = spec.magnitudes[t][f];
      }
    }

    const inTensor = tf.tensor4d(f32, [1, numFrames, numBins, 1]);
    const outTensor = processSpectrogramFn(inTensor);
    const outData = outTensor.dataSync();

    inTensor.dispose();
    outTensor.dispose();

    const outSpec = { ...spec, magnitudes: [] };
    for (let t = 0; t < numFrames; t++) {
      const magRow = new Float32Array(numBins);
      for (let f = 0; f < numBins; f++) {
        magRow[f] = outData[t * numBins + f];
      }
      outSpec.magnitudes.push(magRow);
    }

    const recChunk = AudioDSP.istft(outSpec);
    const validLen = end - start;

    for (let i = 0; i < validLen; i++) {
      const winVal = Math.sin((Math.PI * i) / validLen);
      output[start + i] += recChunk[i] * winVal;
      weights[start + i] += winVal;
    }
  }

  for (let i = 0; i < n; i++) {
    if (weights[i] > 1e-4) {
      output[i] /= weights[i];
    }
  }

  return output;
}

function resolveAudioCheckpointDir(modelName) {
  const hardenedDir = path.resolve(DEFAULT_STORAGE, "checkpoints", "audio_hardened", modelName, "best");
  if (fs.existsSync(path.join(hardenedDir, "model_topology.json"))) {
    return hardenedDir;
  }
  return path.resolve(DEFAULT_STORAGE, "checkpoints", "audio", modelName, "best");
}

// ==========================================
// 1. Trained NOISENET Adapter
// ==========================================
class TrainedNoiseNet {
  constructor(checkpointDir) {
    this.name = "NOISENET";
    this.status = "active";
    this.enabled = true; // Enabled by default (+1.66 dB gain)
    this.model = null;
    this.checkpointDir = checkpointDir || resolveAudioCheckpointDir("noisenet");
  }

  async getModel() {
    if (!this.model) this.model = await loadAudioModel(this.checkpointDir);
    return this.model;
  }

  async suppressNoise(audioBuffer) {
    if (!this.enabled || audioBuffer.length < 44) return audioBuffer;
    const { samples, sampleRate } = AudioDSP.decodeWav(audioBuffer);
    const model = await this.getModel();

    const denoised = await processAudioChunked(samples, sampleRate, (inTensor) => {
      const preds = model.predict(inTensor);
      const pred = Array.isArray(preds) ? preds[0] : preds;
      return pred;
    });

    return AudioDSP.encodeWav(denoised, sampleRate);
  }
}

// ==========================================
// 2. Trained ECHONET Adapter
// ==========================================
class TrainedEchoNet {
  constructor(checkpointDir) {
    this.name = "ECHONET";
    this.status = "active";
    this.enabled = false; // Bypassed by default (0.00 dB gain)
    this.model = null;
    this.checkpointDir = checkpointDir || resolveAudioCheckpointDir("echonet");
  }

  async getModel() {
    if (!this.model) this.model = await loadAudioModel(this.checkpointDir);
    return this.model;
  }

  async dereverberate(audioBuffer) {
    if (!this.enabled || audioBuffer.length < 44) return audioBuffer;
    const { samples, sampleRate } = AudioDSP.decodeWav(audioBuffer);
    const model = await this.getModel();

    const dereverbed = await processAudioChunked(samples, sampleRate, (inTensor) => {
      const preds = model.predict(inTensor);
      const pred = Array.isArray(preds) ? preds[0] : preds;
      return pred;
    });

    return AudioDSP.encodeWav(dereverbed, sampleRate);
  }
}

// ==========================================
// 3. Trained STEMNET Adapter
// ==========================================
class TrainedStemNet {
  constructor(checkpointDir) {
    this.name = "STEMNET";
    this.status = "active";
    this.enabled = true; // Enabled by default (50.0 dB lossless recombination)
    this.model = null;
    this.checkpointDir = checkpointDir || resolveAudioCheckpointDir("stemnet");
  }

  async getModel() {
    if (!this.model) this.model = await loadAudioModel(this.checkpointDir);
    return this.model;
  }

  async separateStems(audioBuffer) {
    if (audioBuffer.length < 44) {
      return { dialogue: audioBuffer, music: Buffer.alloc(0), effects: Buffer.alloc(0) };
    }
    if (!this.enabled) {
      return { dialogue: audioBuffer, music: Buffer.alloc(0), effects: Buffer.alloc(0) };
    }

    const { samples, sampleRate } = AudioDSP.decodeWav(audioBuffer);
    const model = await this.getModel();

    const spec = AudioDSP.stft(samples, 256, 128, sampleRate);
    const numFrames = spec.numFrames;
    const numBins = (spec.fftSize >> 1) + 1;
    const f32 = new Float32Array(numFrames * numBins);

    for (let t = 0; t < numFrames; t++) {
      for (let f = 0; f < numBins; f++) {
        f32[t * numBins + f] = spec.magnitudes[t][f];
      }
    }

    const inTensor = tf.tensor4d(f32, [1, numFrames, numBins, 1]);
    const pred = model.predict(inTensor);

    let dData;
    let mData;
    let fData;

    if (Array.isArray(pred)) {
      const [pD, pM, pF] = pred;
      dData = pD.dataSync();
      mData = pM.dataSync();
      fData = pF.dataSync();
      pD.dispose();
      pM.dispose();
      pF.dispose();
    } else {
      const fullData = pred.dataSync();
      const totalPoints = numFrames * numBins;
      dData = new Float32Array(totalPoints);
      mData = new Float32Array(totalPoints);
      fData = new Float32Array(totalPoints);

      for (let i = 0; i < totalPoints; i++) {
        dData[i] = fullData[i * 3 + 0];
        mData[i] = fullData[i * 3 + 1];
        fData[i] = fullData[i * 3 + 2];
      }
      pred.dispose();
    }

    inTensor.dispose();

    function buildStemAudio(data) {
      const stemSpec = { ...spec, magnitudes: [] };
      for (let t = 0; t < numFrames; t++) {
        const magRow = new Float32Array(numBins);
        for (let f = 0; f < numBins; f++) {
          magRow[f] = data[t * numBins + f];
        }
        stemSpec.magnitudes.push(magRow);
      }
      return AudioDSP.istft(stemSpec);
    }

    const diagSamples = buildStemAudio(dData);
    const musicSamples = buildStemAudio(mData);
    const fxSamples = buildStemAudio(fData);

    return {
      dialogue: AudioDSP.encodeWav(diagSamples, sampleRate),
      music: AudioDSP.encodeWav(musicSamples, sampleRate),
      effects: AudioDSP.encodeWav(fxSamples, sampleRate),
    };
  }
}

// ==========================================
// 4. Trained VOICENET Adapter
// ==========================================
class TrainedVoiceNet {
  constructor(checkpointDir) {
    this.name = "VOICENET";
    this.status = "active";
    this.enabled = false; // Bypassed by default (-0.86 dB degradation)
    this.model = null;
    this.checkpointDir = checkpointDir || resolveAudioCheckpointDir("voicenet");
  }

  async getModel() {
    if (!this.model) this.model = await loadAudioModel(this.checkpointDir);
    return this.model;
  }

  async enhanceSpeech(dialogueBuffer) {
    if (!this.enabled || dialogueBuffer.length < 44) return dialogueBuffer;
    const { samples, sampleRate } = AudioDSP.decodeWav(dialogueBuffer);
    const model = await this.getModel();

    const enhanced = await processAudioChunked(samples, sampleRate, (inTensor) => {
      const preds = model.predict(inTensor);
      const pred = Array.isArray(preds) ? preds[0] : preds;
      return pred;
    });

    return AudioDSP.encodeWav(enhanced, sampleRate);
  }
}

module.exports = {
  loadAudioModel,
  processAudioChunked,
  TrainedNoiseNet,
  TrainedEchoNet,
  TrainedStemNet,
  TrainedVoiceNet,
};
