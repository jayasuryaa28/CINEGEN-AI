#!/usr/bin/env node

/**
 * CINEGEN AI — Paired Audio Dataset Generator (Phase 5)
 *
 * Extracts clean 16kHz mono audio from video sources and synthesizes realistic
 * degradations with strict source-level isolation across Train, Val, and Test splits:
 * 1. NOISENET: Clean vs (Audience noise + electrical hum + mic hiss)
 * 2. ECHONET:  Clean vs (Theatre acoustic reverberation & echo)
 * 3. STEMNET:  Composite mixture vs (Dialogue + Music + Effects stems)
 * 4. VOICENET: Muffled/distorted dialogue vs Enhanced clean vocal reference
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { AudioDSP } = require("../src/ai/audio/dsp");

const DATASET_DIR = path.resolve("./storage_data/dataset");
const RAW_SOURCES_DIR = path.join(DATASET_DIR, "raw_sources");
const AUDIO_DIR = path.join(DATASET_DIR, "audio_pairs");
const OUTPUT_ANNOTATIONS = path.join(DATASET_DIR, "audio_annotations.json");

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

console.log("=== GENERATING CINEGEN PAIRED AUDIO DATASET ===");

const SR = 16000;
const SEGMENT_DUR = 1.0; // 1.0 second chunks
const SEGMENT_SAMPLES = SR * SEGMENT_DUR; // 16,000 samples

// 1. Degradation Generators
function synthesizeHumAndHiss(nSamples) {
  const noise = new Float32Array(nSamples);
  // Electrical 50Hz + 60Hz hum with harmonics
  for (let i = 0; i < nSamples; i++) {
    const t = i / SR;
    const hum =
      0.035 * Math.sin(2 * Math.PI * 60 * t) +
      0.020 * Math.sin(2 * Math.PI * 120 * t) +
      0.012 * Math.sin(2 * Math.PI * 180 * t) +
      0.025 * Math.sin(2 * Math.PI * 50 * t);
    // Pink / White hiss
    const hiss = (Math.random() - 0.5) * 0.055;
    noise[i] = hum + hiss;
  }
  // Simulated transient audience cough / rustle around sample 4000..8000
  const rustleStart = Math.floor(nSamples * 0.3);
  const rustleLen = Math.floor(nSamples * 0.25);
  for (let i = 0; i < rustleLen; i++) {
    const env = Math.sin((Math.PI * i) / rustleLen);
    noise[rustleStart + i] += (Math.random() - 0.5) * 0.07 * env;
  }
  return noise;
}

function synthesizeReverberation(cleanSamples) {
  // Auditorium Room Impulse Response (RIR): Direct path + Early Reflections + Late Decay
  const rirLen = Math.floor(SR * 0.45); // 450 ms reverb tail
  const rir = new Float32Array(rirLen);
  rir[0] = 1.0; // Direct sound

  // Early reflections
  const reflections = [
    { delay: Math.floor(SR * 0.018), gain: 0.42 }, // 18 ms floor/wall
    { delay: Math.floor(SR * 0.034), gain: 0.35 }, // 34 ms side wall
    { delay: Math.floor(SR * 0.052), gain: 0.28 }, // 52 ms ceiling
    { delay: Math.floor(SR * 0.075), gain: 0.22 }, // 75 ms back wall
  ];
  for (const ref of reflections) {
    if (ref.delay < rirLen) rir[ref.delay] = ref.gain;
  }

  // Late diffuse reverberant decay
  const lateStart = Math.floor(SR * 0.08);
  for (let i = lateStart; i < rirLen; i++) {
    const decay = Math.exp(-6.9 * (i / SR) / 0.5); // T60 = 0.5s
    rir[i] += (Math.random() - 0.5) * decay * 0.22;
  }

  // Convolve clean with RIR (truncated to preserve sample count)
  const n = cleanSamples.length;
  const reverberant = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const maxK = Math.min(i, rirLen - 1);
    // Downsample convolution taps for fast generation
    for (let k = 0; k <= maxK; k += (k < 1000 ? 1 : 4)) {
      sum += cleanSamples[i - k] * rir[k];
    }
    reverberant[i] = sum * 0.82;
  }
  return reverberant;
}

function synthesizeMuffledSpeech(cleanSamples) {
  // Apply treble roll-off and low-end resonance to simulate distant muffled microphone
  const n = cleanSamples.length;
  const muffled = new Float32Array(n);
  let prev1 = 0, prev2 = 0;
  for (let i = 0; i < n; i++) {
    // 2-pole low-pass filter
    const x = cleanSamples[i];
    const lp = 0.45 * x + 0.35 * prev1 + 0.20 * prev2;
    prev2 = prev1;
    prev1 = lp;
    // Add mild soft-saturation
    muffled[i] = Math.tanh(lp * 1.25) * 0.95;
  }
  return muffled;
}

function decomposeStems(cleanSamples) {
  // Decompose clean audio into 3 complementary stems: Dialogue, Music, Effects
  const spec = AudioDSP.stft(cleanSamples, 256, 128, SR);
  const numFrames = spec.numFrames;
  const numBins = (spec.fftSize >> 1) + 1; // 129 bins

  const diagMags = [];
  const musicMags = [];
  const fxMags = [];

  for (let t = 0; t < numFrames; t++) {
    const m = spec.magnitudes[t];
    const dM = new Float32Array(numBins);
    const mM = new Float32Array(numBins);
    const fM = new Float32Array(numBins);

    for (let f = 0; f < numBins; f++) {
      const freqHz = (f * SR) / spec.fftSize;
      const magVal = m[f];

      // Dialogue focus: 300Hz - 3400Hz (vocal formant region)
      let diagWeight = 0.0;
      if (freqHz >= 250 && freqHz <= 3500) {
        diagWeight = 0.70;
      } else if (freqHz > 3500 && freqHz <= 5500) {
        diagWeight = 0.40;
      } else {
        diagWeight = 0.10;
      }

      // Music focus: Low bass (< 250Hz) and harmonic overtones (> 1500Hz)
      let musicWeight = 0.0;
      if (freqHz < 250) {
        musicWeight = 0.75;
      } else if (freqHz >= 1500 && freqHz <= 6000) {
        musicWeight = 0.35;
      } else {
        musicWeight = 0.20;
      }

      // Ambience / Effects focus: High frequency transients and background
      let fxWeight = 0.0;
      if (freqHz > 5500) {
        fxWeight = 0.70;
      } else {
        fxWeight = 0.15;
      }

      // Normalize weights so dM + mM + fM == magVal (Strict Energy Conservation)
      const sumW = diagWeight + musicWeight + fxWeight;
      dM[f] = magVal * (diagWeight / sumW);
      mM[f] = magVal * (musicWeight / sumW);
      fM[f] = magVal * (fxWeight / sumW);
    }

    diagMags.push(dM);
    musicMags.push(mM);
    fxMags.push(fM);
  }

  const diagSamples = AudioDSP.istft({ ...spec, magnitudes: diagMags });
  const musicSamples = AudioDSP.istft({ ...spec, magnitudes: musicMags });
  const fxSamples = AudioDSP.istft({ ...spec, magnitudes: fxMags });

  return { diagSamples, musicSamples, fxSamples };
}

// 2. Process All Sources
const annotations = [];

for (const src of SOURCES) {
  const mp4Path = path.join(RAW_SOURCES_DIR, src.file);
  const masterWav = path.join(AUDIO_DIR, `${src.id}_master.wav`);

  console.log(`[Source] ${src.id} (${src.split.toUpperCase()})...`);

  // Extract 16kHz mono master WAV using FFmpeg
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
  const numSegments = Math.min(4, Math.floor(fullAudio.length / SEGMENT_SAMPLES));

  for (let s = 0; s < numSegments; s++) {
    const segId = `${src.id}_seg${(s + 1).toString().padStart(2, "0")}`;
    const startSample = s * SEGMENT_SAMPLES;
    const cleanSamples = fullAudio.subarray(startSample, startSample + SEGMENT_SAMPLES);

    // Save Clean Target Segment
    const cleanPath = path.join(AUDIO_DIR, `${segId}_clean.wav`);
    fs.writeFileSync(cleanPath, AudioDSP.encodeWav(cleanSamples, SR));

    // A. NOISENET: Add Hum + Hiss + Audience Rustle
    const noiseOnly = synthesizeHumAndHiss(SEGMENT_SAMPLES);
    const noisySamples = new Float32Array(SEGMENT_SAMPLES);
    for (let i = 0; i < SEGMENT_SAMPLES; i++) {
      noisySamples[i] = Math.max(-1.0, Math.min(1.0, cleanSamples[i] + noiseOnly[i]));
    }
    const noisyPath = path.join(AUDIO_DIR, `${segId}_noisy.wav`);
    fs.writeFileSync(noisyPath, AudioDSP.encodeWav(noisySamples, SR));

    // B. ECHONET: Multi-tap Auditorium Reverberation
    const reverbSamples = synthesizeReverberation(cleanSamples);
    const reverbPath = path.join(AUDIO_DIR, `${segId}_reverb.wav`);
    fs.writeFileSync(reverbPath, AudioDSP.encodeWav(reverbSamples, SR));

    // C. STEMNET: Decompose into 3 Constituent Stems
    const { diagSamples, musicSamples, fxSamples } = decomposeStems(cleanSamples);
    const stemDiagPath = path.join(AUDIO_DIR, `${segId}_stem_diag.wav`);
    const stemMusicPath = path.join(AUDIO_DIR, `${segId}_stem_music.wav`);
    const stemFxPath = path.join(AUDIO_DIR, `${segId}_stem_fx.wav`);
    fs.writeFileSync(stemDiagPath, AudioDSP.encodeWav(diagSamples, SR));
    fs.writeFileSync(stemMusicPath, AudioDSP.encodeWav(musicSamples, SR));
    fs.writeFileSync(stemFxPath, AudioDSP.encodeWav(fxSamples, SR));

    // D. VOICENET: Muffled Dialogue Degradation
    const muffledSamples = synthesizeMuffledSpeech(diagSamples);
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
      },
      echonet: {
        degradedAudioPath: reverbPath,
        targetCleanPath: cleanPath,
      },
      stemnet: {
        mixtureAudioPath: cleanPath,
        dialoguePath: stemDiagPath,
        musicPath: stemMusicPath,
        effectsPath: stemFxPath,
      },
      voicenet: {
        degradedAudioPath: muffledPath,
        targetEnhancedPath: stemDiagPath,
      },
    });
  }
}

fs.writeFileSync(OUTPUT_ANNOTATIONS, JSON.stringify(annotations, null, 2), "utf-8");

const trainCount = annotations.filter(a => a.split === "train").length;
const valCount = annotations.filter(a => a.split === "val").length;
const testCount = annotations.filter(a => a.split === "test").length;

console.log("\n=== DATASET GENERATION SUMMARY ===");
console.log(`Total 1-Second Audio Sequences: ${annotations.length}`);
console.log(` - Train (6 sources): ${trainCount} sequences`);
console.log(` - Val   (2 sources): ${valCount} sequences`);
console.log(` - Test  (2 sources): ${testCount} sequences`);
console.log(`Annotations saved to: ${OUTPUT_ANNOTATIONS}`);
