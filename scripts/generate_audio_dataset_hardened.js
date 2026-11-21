#!/usr/bin/env node

/**
 * CINEGEN AI — Hardened Paired Audio Dataset Generator (Phase 5.1)
 *
 * Expands and hardens the audio dataset with:
 * 1. Strict relative SNR scaling for NOISENET (5 dB to 15 dB across all volume ranges)
 * 2. Physically accurate room impulse responses for ECHONET (unity direct path, T60 0.25-0.55s)
 * 3. True multi-stem acoustic synthesis for STEMNET (independent dialogue, music, and effects tracks with exact summation)
 * 4. Acoustic distance & formant muffling for VOICENET (1.5-3.5 kHz cutoff variation)
 * 5. Expanded temporal sampling: 12 segments per train source (72 train, 12 val, 12 test = 96 total)
 * 6. Strict source-level partition preserved across all 10 sources.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { AudioDSP } = require("../src/ai/audio/dsp");

const DATASET_DIR = path.resolve("./storage_data/dataset");
const RAW_SOURCES_DIR = path.join(DATASET_DIR, "raw_sources");
const AUDIO_DIR = path.join(DATASET_DIR, "audio_pairs_hardened");
const OUTPUT_ANNOTATIONS = path.join(DATASET_DIR, "audio_annotations_hardened.json");

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

const SOURCES = [
  { id: "src_clean_01", split: "train", file: "src_clean_01_clean.mp4" },
  { id: "src_clean_02", split: "train", file: "src_clean_02_clean.mp4" },
  { id: "src_clean_05", split: "train", file: "src_clean_05_clean.mp4" },
  { id: "src_clean_06", split: "train", file: "src_clean_06_clean.mp4" },
  { id: "src_clean_07", split: "train", file: "src_clean_07_clean.mp4" },
  { id: "src_clean_08", split: "train", file: "src_clean_08_clean.mp4" },
  { id: "src_clean_03", split: "val",   file: "src_clean_03_clean.mp4" },
  { id: "src_clean_09", split: "val",   file: "src_clean_09_clean.mp4" },
  { id: "src_clean_04", split: "test",  file: "src_clean_04_clean.mp4" },
  { id: "src_clean_10", split: "test",  file: "src_clean_10_clean.mp4" },
];

console.log("=== GENERATING HARDENED CINEGEN AUDIO DATASET ===");

const SR = 16000;
const SEGMENT_DUR = 1.0;
const SEGMENT_SAMPLES = SR * SEGMENT_DUR; // 16,000 samples

// Helper: Measure signal RMS
function computeRms(samples) {
  let e = 0;
  for (let i = 0; i < samples.length; i++) e += samples[i] * samples[i];
  return Math.sqrt(e / samples.length);
}

// 1. NOISENET: Relative SNR Noise Synthesis (Hum, Hiss, Audience Transients)
function synthesizeRelativeNoise(cleanSamples, targetSnrDb) {
  const n = cleanSamples.length;
  const rawNoise = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // 50Hz + 60Hz hum + 2nd & 3rd harmonics
    const hum =
      0.40 * Math.sin(2 * Math.PI * 60 * t) +
      0.25 * Math.sin(2 * Math.PI * 120 * t) +
      0.15 * Math.sin(2 * Math.PI * 180 * t) +
      0.30 * Math.sin(2 * Math.PI * 50 * t);
    // Gaussian white/pink hiss
    const hiss = (Math.random() + Math.random() - 1.0) * 0.70;
    rawNoise[i] = hum + hiss;
  }

  // Audience rustle/whisper transients in middle
  const transStart = Math.floor(n * 0.35);
  const transLen = Math.floor(n * 0.30);
  for (let i = 0; i < transLen; i++) {
    const env = Math.sin((Math.PI * i) / transLen);
    rawNoise[transStart + i] += (Math.random() - 0.5) * 1.2 * env;
  }

  // Normalize raw noise to RMS 1.0
  const noiseRms = computeRms(rawNoise);
  const cleanRms = Math.max(1e-4, computeRms(cleanSamples));
  const desiredNoiseRms = cleanRms / Math.pow(10, targetSnrDb / 20);
  const scale = desiredNoiseRms / (noiseRms + 1e-6);

  const noisy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    noisy[i] = cleanSamples[i] + rawNoise[i] * scale;
  }
  return noisy;
}

// 2. ECHONET: Physically Realistic Room Acoustic Reverberation
function synthesizeRealisticReverb(cleanSamples, t60 = 0.40) {
  const rirLen = Math.floor(SR * t60);
  const rir = new Float32Array(rirLen);
  rir[0] = 1.0; // Direct path (exact unity gain)

  // Early reflection taps (15-60ms)
  const taps = [
    { delay: Math.floor(SR * 0.016), gain: 0.38 },
    { delay: Math.floor(SR * 0.028), gain: 0.30 },
    { delay: Math.floor(SR * 0.045), gain: 0.24 },
    { delay: Math.floor(SR * 0.062), gain: 0.18 },
  ];
  for (const tap of taps) {
    if (tap.delay < rirLen) rir[tap.delay] = tap.gain;
  }

  // Late diffuse exponential decay tail
  const lateStart = Math.floor(SR * 0.07);
  for (let i = lateStart; i < rirLen; i++) {
    const decay = Math.exp(-6.9 * (i / SR) / t60);
    rir[i] += (Math.random() - 0.5) * decay * 0.20;
  }

  // Time-domain convolution
  const n = cleanSamples.length;
  const reverberant = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const maxK = Math.min(i, rirLen - 1);
    for (let k = 0; k <= maxK; k += (k < 800 ? 1 : 4)) {
      sum += cleanSamples[i - k] * rir[k];
    }
    reverberant[i] = sum;
  }
  return reverberant;
}

// 3. STEMNET: True Multi-Stem Synthesis (Dialogue + Music + Foley Effects)
function synthesizeStemsAndMixture(dialogueSamples, seedIdx) {
  const n = dialogueSamples.length;
  const dRms = Math.max(1e-4, computeRms(dialogueSamples));

  // Synthesize realistic cinematic music bed (chords + arpeggio)
  const music = new Float32Array(n);
  const baseFreqs = [110, 146.83, 164.81, 220]; // A2, D3, E3, A3
  const chordOffset = (seedIdx % 4);
  const f0 = baseFreqs[chordOffset];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bass = 0.5 * Math.sin(2 * Math.PI * f0 * t);
    const mid1 = 0.3 * Math.sin(2 * Math.PI * (f0 * 1.5) * t); // Fifth
    const mid2 = 0.2 * Math.sin(2 * Math.PI * (f0 * 2.0) * t); // Octave
    const arp = 0.15 * Math.sin(2 * Math.PI * (f0 * (3 + (Math.floor(t * 4) % 3))) * t);
    music[i] = (bass + mid1 + mid2 + arp);
  }
  // Scale music to -6 dB relative to dialogue
  const mScale = (dRms * 0.50) / (computeRms(music) + 1e-6);
  for (let i = 0; i < n; i++) music[i] *= mScale;

  // Synthesize realistic ambient Foley / effects (percussive transients + room atmosphere)
  const effects = new Float32Array(n);
  const foleyPos = Math.floor(n * 0.25);
  const foleyLen = Math.floor(n * 0.15);
  for (let i = 0; i < foleyLen; i++) {
    const env = Math.exp(-8.0 * (i / foleyLen));
    effects[foleyPos + i] += (Math.random() - 0.5) * env * 1.5;
  }
  // High-frequency room air
  for (let i = 0; i < n; i++) {
    effects[i] += (Math.random() - 0.5) * 0.08;
  }
  // Scale effects to -8 dB relative to dialogue
  const fScale = (dRms * 0.40) / (computeRms(effects) + 1e-6);
  for (let i = 0; i < n; i++) effects[i] *= fScale;

  // Exact composite mixture: Mix = D + M + F
  const mixture = new Float32Array(n);
  let maxPeak = 0;
  for (let i = 0; i < n; i++) {
    const sum = dialogueSamples[i] + music[i] + effects[i];
    mixture[i] = sum;
    if (Math.abs(sum) > maxPeak) maxPeak = Math.abs(sum);
  }

  // Soft headroom scaling if mixture exceeds 0.95
  let norm = 1.0;
  if (maxPeak > 0.95) {
    norm = 0.95 / maxPeak;
    for (let i = 0; i < n; i++) {
      mixture[i] *= norm;
      dialogueSamples[i] *= norm;
      music[i] *= norm;
      effects[i] *= norm;
    }
  }

  return {
    dialogue: dialogueSamples,
    music,
    effects,
    mixture,
  };
}

// 4. VOICENET: Muffled Dialogue & Distance Simulation
function synthesizeMuffledSpeech(cleanSamples, cutoffHz = 2200) {
  const n = cleanSamples.length;
  const muffled = new Float32Array(n);
  // IIR low-pass filter: alpha = 2*pi*fc / (2*pi*fc + fs)
  const dt = 1.0 / SR;
  const rc = 1.0 / (2.0 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);

  let prev = cleanSamples[0];
  for (let i = 0; i < n; i++) {
    const lp = prev + alpha * (cleanSamples[i] - prev);
    prev = lp;
    muffled[i] = lp * 0.95;
  }
  return muffled;
}

// -------------------------------------------------------------
// Main Dataset Processing
// -------------------------------------------------------------
const annotations = [];

for (const src of SOURCES) {
  const mp4Path = path.join(RAW_SOURCES_DIR, src.file);
  const masterWav = path.join(AUDIO_DIR, `${src.id}_master.wav`);

  console.log(`[Processing Source] ${src.id} (${src.split.toUpperCase()})...`);

  // Extract master WAV
  if (!fs.existsSync(masterWav)) {
    const res = spawnSync("ffmpeg", [
      "-y",
      "-i", mp4Path,
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      masterWav,
    ]);
    if (res.status !== 0) {
      console.error(`FFmpeg failed extracting audio from ${mp4Path}`);
      continue;
    }
  }

  const wavBuf = fs.readFileSync(masterWav);
  const { samples: fullAudio } = AudioDSP.decodeWav(wavBuf);

  // Train sources get 12 segments (0.35s hop across 5.5s clip)
  // Val/Test sources get 6 segments (0.7s hop)
  const numSegments = src.split === "train" ? 12 : 6;
  const hopSamples = Math.floor((fullAudio.length - SEGMENT_SAMPLES) / (numSegments - 1));

  for (let s = 0; s < numSegments; s++) {
    const segId = `${src.id}_hseg${(s + 1).toString().padStart(2, "0")}`;
    const startSample = s * hopSamples;
    const cleanSamples = fullAudio.subarray(startSample, startSample + SEGMENT_SAMPLES);

    // Save Clean Target Segment
    const cleanPath = path.join(AUDIO_DIR, `${segId}_clean.wav`);
    fs.writeFileSync(cleanPath, AudioDSP.encodeWav(cleanSamples, SR));

    // A. NOISENET: Relative SNR (varied between 6 dB and 14 dB)
    const targetSnr = 6.0 + (s % 3) * 4.0; // 6 dB, 10 dB, 14 dB
    const noisySamples = synthesizeRelativeNoise(cleanSamples, targetSnr);
    const noisyPath = path.join(AUDIO_DIR, `${segId}_noisy.wav`);
    fs.writeFileSync(noisyPath, AudioDSP.encodeWav(noisySamples, SR));

    // B. ECHONET: Realistic Reverberation (T60: 0.30s, 0.40s, 0.50s)
    const t60 = 0.30 + (s % 3) * 0.10;
    const reverbSamples = synthesizeRealisticReverb(cleanSamples, t60);
    const reverbPath = path.join(AUDIO_DIR, `${segId}_reverb.wav`);
    fs.writeFileSync(reverbPath, AudioDSP.encodeWav(reverbSamples, SR));

    // C. STEMNET: Multi-Stem Synthesis
    const stems = synthesizeStemsAndMixture(new Float32Array(cleanSamples), s);
    const stemMixPath = path.join(AUDIO_DIR, `${segId}_stem_mix.wav`);
    const stemDiagPath = path.join(AUDIO_DIR, `${segId}_stem_diag.wav`);
    const stemMusicPath = path.join(AUDIO_DIR, `${segId}_stem_music.wav`);
    const stemFxPath = path.join(AUDIO_DIR, `${segId}_stem_fx.wav`);
    fs.writeFileSync(stemMixPath, AudioDSP.encodeWav(stems.mixture, SR));
    fs.writeFileSync(stemDiagPath, AudioDSP.encodeWav(stems.dialogue, SR));
    fs.writeFileSync(stemMusicPath, AudioDSP.encodeWav(stems.music, SR));
    fs.writeFileSync(stemFxPath, AudioDSP.encodeWav(stems.effects, SR));

    // D. VOICENET: Muffled Dialogue (cutoff: 1800Hz - 2800Hz)
    const cutoff = 1800 + (s % 3) * 500;
    const muffledSamples = synthesizeMuffledSpeech(cleanSamples, cutoff);
    const muffledPath = path.join(AUDIO_DIR, `${segId}_muffled.wav`);
    fs.writeFileSync(muffledPath, AudioDSP.encodeWav(muffledSamples, SR));

    annotations.push({
      sampleId: segId,
      sourceId: src.id,
      split: src.split,
      durationSec: SEGMENT_DUR,
      sampleRate: SR,
      numSamples: SEGMENT_SAMPLES,
      cleanAudioPath: cleanPath,
      noisenet: {
        degradedAudioPath: noisyPath,
        targetCleanPath: cleanPath,
        targetSnrDb: targetSnr,
      },
      echonet: {
        degradedAudioPath: reverbPath,
        targetCleanPath: cleanPath,
        t60Seconds: t60,
      },
      stemnet: {
        mixtureAudioPath: stemMixPath,
        dialoguePath: stemDiagPath,
        musicPath: stemMusicPath,
        effectsPath: stemFxPath,
      },
      voicenet: {
        degradedAudioPath: muffledPath,
        targetEnhancedPath: cleanPath,
        cutoffHz: cutoff,
      },
    });
  }
}

fs.writeFileSync(OUTPUT_ANNOTATIONS, JSON.stringify(annotations, null, 2), "utf-8");

const trainCount = annotations.filter(a => a.split === "train").length;
const valCount = annotations.filter(a => a.split === "val").length;
const testCount = annotations.filter(a => a.split === "test").length;

console.log("\n=== HARDENED DATASET GENERATION SUMMARY ===");
console.log(`Total 1-Second Audio Sequences: ${annotations.length}`);
console.log(` - Train (6 sources): ${trainCount} sequences (target: 72)`);
console.log(` - Val   (2 sources): ${valCount} sequences (target: 12)`);
console.log(` - Test  (2 sources): ${testCount} sequences (target: 12)`);
console.log(`Annotations saved to: ${OUTPUT_ANNOTATIONS}`);
