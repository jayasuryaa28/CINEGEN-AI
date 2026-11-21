const fs = require("fs");
const path = require("path");
const { AudioDSP } = require("../src/ai/audio/dsp");
const {
  TrainedNoiseNet,
  TrainedStemNet,
  TrainedEchoNet,
  TrainedVoiceNet
} = require("../src/ai/audio/adapter");

const EVAL_DIR = path.resolve("./storage_data/realworld_eval");
const AUDIO_OUT_DIR = path.join(EVAL_DIR, "audio_eval");

// Reference-free audio metrics calculator
function computeAudioMetrics(samples, sampleRate) {
  let peak = 0;
  let sumSq = 0;
  let clipCount = 0;
  const numSamples = samples.length;

  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sumSq += samples[i] * samples[i];
    if (abs >= 0.999) clipCount++;
  }

  const rms = Math.sqrt(sumSq / (numSamples || 1));
  const crestFactor = rms > 0 ? peak / rms : 0;
  const clippingRate = (clipCount / (numSamples || 1)) * 100;

  // Approximate Spectral Flatness Measure (SFM)
  // Geometric mean / Arithmetic mean of power spectrum
  const fftSize = 1024;
  const numWindows = Math.min(20, Math.floor(numSamples / fftSize));
  let geomSum = 0;
  let arithSum = 0;
  let totalBands = 0;

  for (let w = 0; w < numWindows; w++) {
    const chunk = samples.subarray(w * fftSize, (w + 1) * fftSize);
    for (let k = 0; k < fftSize / 2; k++) {
      const power = chunk[k * 2] * chunk[k * 2] + 1e-10;
      geomSum += Math.log(power);
      arithSum += power;
      totalBands++;
    }
  }

  const geomMean = Math.exp(geomSum / (totalBands || 1));
  const arithMean = arithSum / (totalBands || 1);
  const sfm = arithMean > 0 ? geomMean / arithMean : 0;

  return {
    peak,
    rms,
    crestFactor,
    clippingRate,
    spectralFlatness: Math.min(1.0, Math.max(0, sfm))
  };
}

// Compute SDR between reference and test
function computeSdr(reference, test) {
  const len = Math.min(reference.length, test.length);
  let signalEnergy = 0;
  let noiseEnergy = 0;
  for (let i = 0; i < len; i++) {
    signalEnergy += reference[i] * reference[i];
    const diff = reference[i] - test[i];
    noiseEnergy += diff * diff;
  }
  if (noiseEnergy === 0) return 50.0;
  if (signalEnergy === 0) return -50.0;
  return 10 * Math.log10(signalEnergy / noiseEnergy);
}

// Compute SI-SDR
function computeSiSdr(reference, test) {
  const len = Math.min(reference.length, test.length);
  let dotProduct = 0;
  let refEnergy = 0;
  for (let i = 0; i < len; i++) {
    dotProduct += reference[i] * test[i];
    refEnergy += reference[i] * reference[i];
  }
  const alpha = refEnergy > 0 ? dotProduct / refEnergy : 0;
  let sTargetEnergy = 0;
  let eResidualEnergy = 0;
  for (let i = 0; i < len; i++) {
    const sTarget = alpha * reference[i];
    const eResidual = test[i] - sTarget;
    sTargetEnergy += sTarget * sTarget;
    eResidualEnergy += eResidual * eResidual;
  }
  if (eResidualEnergy === 0) return 50.0;
  if (sTargetEnergy === 0) return -50.0;
  return 10 * Math.log10(sTargetEnergy / eResidualEnergy);
}

async function main() {
  console.log("================================================================================");
  console.log(" CINEGEN AI — PHASE 10: AUDIO AI (NOISENET, STEMNET, ECHONET, VOICENET) EVAL");
  console.log("================================================================================");

  if (!fs.existsSync(AUDIO_OUT_DIR)) {
    fs.mkdirSync(AUDIO_OUT_DIR, { recursive: true });
  }

  // Initialize Audio Models
  const noisenet = new TrainedNoiseNet();
  const stemnet = new TrainedStemNet();
  const echonet = new TrainedEchoNet();
  const voicenet = new TrainedVoiceNet();

  console.log("\nInitializing audio neural models from checkpoints...");
  await noisenet.getModel();
  await stemnet.getModel();
  await echonet.getModel();
  await voicenet.getModel();
  console.log("Audio models initialized.\n");

  // Define Real-World Theatre Acoustic Scenarios
  const sampleRate = 48000;
  const durationSec = 3.0;
  const totalSamples = Math.floor(sampleRate * durationSec);

  // Generate synthetic dialogue foundation (formants)
  const cleanDialogue = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Harmonic voice spectrum: fundamental 160Hz + formants 320, 640, 1200 Hz
    cleanDialogue[i] =
      0.35 * Math.sin(2 * Math.PI * 160 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) +
      0.25 * Math.sin(2 * Math.PI * 320 * t) +
      0.15 * Math.sin(2 * Math.PI * 640 * t) +
      0.08 * Math.sin(2 * Math.PI * 1200 * t);
  }

  const cleanMusic = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Orchestral music foundation (strings/horns: 440Hz, 880Hz, 1320Hz)
    cleanMusic[i] =
      0.20 * Math.sin(2 * Math.PI * 440 * t) +
      0.12 * Math.sin(2 * Math.PI * 880 * t) +
      0.06 * Math.sin(2 * Math.PI * 1320 * t);
  }

  const SCENARIOS = [
    {
      id: "AUDIO-01-crowd-noise",
      name: "Audience Murmurs & Cinema Rustle",
      generator: () => {
        const mix = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
          const crowd = 0.15 * (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 1.5 * (i / sampleRate)));
          mix[i] = cleanDialogue[i] + cleanMusic[i] + crowd;
        }
        return mix;
      }
    },
    {
      id: "AUDIO-02-reverb-echo",
      name: "Long Auditorium Reverberation",
      generator: () => {
        const mix = new Float32Array(totalSamples);
        const delaySamples = Math.floor(sampleRate * 0.18); // 180ms delay
        for (let i = 0; i < totalSamples; i++) {
          const direct = cleanDialogue[i];
          const echo1 = i >= delaySamples ? 0.35 * cleanDialogue[i - delaySamples] : 0;
          const echo2 = i >= delaySamples * 2 ? 0.15 * cleanDialogue[i - delaySamples * 2] : 0;
          mix[i] = direct + echo1 + echo2;
        }
        return mix;
      }
    },
    {
      id: "AUDIO-03-distorted-dialogue",
      name: "High SPL Distortion & Peak Saturation",
      generator: () => {
        const mix = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
          const raw = (cleanDialogue[i] + cleanMusic[i]) * 2.5; // Overdriven input
          mix[i] = Math.max(-0.95, Math.min(0.95, Math.tanh(raw))); // Hard limiting
        }
        return mix;
      }
    },
    {
      id: "AUDIO-04-background-hiss",
      name: "Analog Preamplifier Hiss & Noise Floor",
      generator: () => {
        const mix = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
          const hiss = 0.08 * (Math.random() * 2 - 1);
          mix[i] = cleanDialogue[i] + hiss;
        }
        return mix;
      }
    },
    {
      id: "AUDIO-05-low-volume-dialogue",
      name: "Quiet Whispered Dialogue in Deep Reverb",
      generator: () => {
        const mix = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
          mix[i] = cleanDialogue[i] * 0.18 + 0.05 * (Math.random() * 2 - 1);
        }
        return mix;
      }
    },
    {
      id: "AUDIO-06-complex-music-effects",
      name: "High-Energy Action Sequence (Music + FX + Dialogue)",
      generator: () => {
        const mix = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
          const fx = 0.25 * (Math.random() * 2 - 1) * (i > totalSamples / 2 ? 1.0 : 0.1);
          mix[i] = cleanDialogue[i] + cleanMusic[i] * 1.5 + fx;
        }
        return mix;
      }
    }
  ];

  const results = [];

  for (const scen of SCENARIOS) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Evaluating Scenario: [${scen.id}] - ${scen.name}`);

    const inputMix = scen.generator();
    const inputWav = AudioDSP.encodeWav(inputMix, sampleRate);
    const inputMetrics = computeAudioMetrics(inputMix, sampleRate);
    const inputSdrVsDialogue = computeSdr(cleanDialogue, inputMix);

    // Save input wav
    const inWavPath = path.join(AUDIO_OUT_DIR, `${scen.id}_input.wav`);
    fs.writeFileSync(inWavPath, inputWav);

    // 1. NOISENET Evaluation
    const denoisedWav = await noisenet.suppressNoise(inputWav);
    const denoisedData = AudioDSP.decodeWav(denoisedWav);
    const denoisedMetrics = computeAudioMetrics(denoisedData.samples, sampleRate);
    const denoisedSdr = computeSdr(cleanDialogue, denoisedData.samples);
    const denoisedSiSdr = computeSiSdr(cleanDialogue, denoisedData.samples);
    const noisenetGain = denoisedSdr - inputSdrVsDialogue;

    const noisenetPath = path.join(AUDIO_OUT_DIR, `${scen.id}_noisenet.wav`);
    fs.writeFileSync(noisenetPath, denoisedWav);

    // 2. STEMNET Evaluation
    const stems = await stemnet.separateStems(denoisedWav);
    const dialogueStemData = AudioDSP.decodeWav(stems.dialogue);
    const dialogueStemSdr = computeSdr(cleanDialogue, dialogueStemData.samples);

    // Test STEMNET Recombination
    const musicStemData = AudioDSP.decodeWav(stems.music);
    const fxStemData = AudioDSP.decodeWav(stems.effects);
    const recombined = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      recombined[i] =
        (i < dialogueStemData.samples.length ? dialogueStemData.samples[i] : 0) +
        (i < musicStemData.samples.length ? musicStemData.samples[i] : 0) +
        (i < fxStemData.samples.length ? fxStemData.samples[i] : 0);
    }
    const recombSdr = computeSdr(denoisedData.samples, recombined);

    // 3. ECHONET & VOICENET Investigation
    echonet.enabled = true;
    const echonetWav = await echonet.dereverberate(denoisedWav);
    echonet.enabled = false;
    const echonetData = AudioDSP.decodeWav(echonetWav);
    const echonetSdr = computeSdr(cleanDialogue, echonetData.samples);
    const echonetGain = echonetSdr - denoisedSdr;

    voicenet.enabled = true;
    const voicenetWav = await voicenet.enhanceSpeech(stems.dialogue);
    voicenet.enabled = false;
    const voicenetData = AudioDSP.decodeWav(voicenetWav);
    const voicenetSdr = computeSdr(cleanDialogue, voicenetData.samples);
    const voicenetGain = voicenetSdr - dialogueStemSdr;

    console.log(`  Input Metrics     : RMS=${inputMetrics.rms.toFixed(3)} | CrestFactor=${inputMetrics.crestFactor.toFixed(2)} | ClipRate=${inputMetrics.clippingRate.toFixed(2)}% | SDR=${inputSdrVsDialogue.toFixed(2)} dB`);
    console.log(`  NOISENET Restored : SDR=${denoisedSdr.toFixed(2)} dB (Gain: ${noisenetGain > 0 ? "+" : ""}${noisenetGain.toFixed(2)} dB) | SI-SDR=${denoisedSiSdr.toFixed(2)} dB | CrestFactor=${denoisedMetrics.crestFactor.toFixed(2)}`);
    console.log(`  STEMNET Separation: Dialogue SDR=${dialogueStemSdr.toFixed(2)} dB | Recombination Energy SDR=${recombSdr.toFixed(1)} dB`);
    console.log(`  ECHONET & VOICENET: ECHONET Gain=${echonetGain.toFixed(3)} dB | VOICENET Gain=${voicenetGain.toFixed(3)} dB -> [BYPASS POLICY JUSTIFIED: ${echonetGain < 0.1 && voicenetGain < 0.1 ? "YES" : "NO"}]`);

    results.push({
      scenarioId: scen.id,
      name: scen.name,
      inputSdr: inputSdrVsDialogue,
      noisenet: {
        outputSdr: denoisedSdr,
        netGain: noisenetGain,
        siSdr: denoisedSiSdr,
        clippingRate: denoisedMetrics.clippingRate
      },
      stemnet: {
        dialogueSdr: dialogueStemSdr,
        recombinationSdr: recombSdr
      },
      echonet: {
        netGain: echonetGain,
        action: "BYPASSED_IN_PRODUCTION"
      },
      voicenet: {
        netGain: voicenetGain,
        action: "BYPASSED_IN_PRODUCTION"
      }
    });
  }

  const resultsFile = path.join(EVAL_DIR, "audio_evaluation_results.json");
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n================================================================================`);
  console.log(`Audio Evaluation Complete! Results saved to: ${resultsFile}`);
  console.log(`================================================================================`);
}

main().catch(err => {
  console.error("Audio evaluator error:", err);
  process.exit(1);
});
