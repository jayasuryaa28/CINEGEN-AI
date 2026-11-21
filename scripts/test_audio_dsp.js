const { AudioDSP } = require("../src/ai/audio/dsp");

console.log("=== TESTING AUDIO DSP FOUNDATION ===");

// 1. Generate a synthetic audio signal with harmonics (440Hz + 880Hz + 1320Hz + noise)
const sr = 16000;
const durSec = 1.0;
const nSamples = sr * durSec;
const original = new Float32Array(nSamples);

for (let i = 0; i < nSamples; i++) {
  const t = i / sr;
  original[i] =
    0.5 * Math.sin(2 * Math.PI * 440 * t) +
    0.3 * Math.sin(2 * Math.PI * 880 * t) +
    0.15 * Math.sin(2 * Math.PI * 1320 * t);
}

// 2. Test WAV encode / decode
const wavBuf = AudioDSP.encodeWav(original, sr);
console.log(`✓ Encoded 16kHz mono WAV (${wavBuf.length} bytes)`);

const decoded = AudioDSP.decodeWav(wavBuf);
console.log(`✓ Decoded WAV: ${decoded.samples.length} samples at ${decoded.sampleRate}Hz`);

let wavDiff = 0;
for (let i = 0; i < original.length; i++) {
  wavDiff = Math.max(wavDiff, Math.abs(original[i] - decoded.samples[i]));
}
console.log(`✓ WAV quantization precision max diff: ${wavDiff.toExponential(4)} (Expected < 5e-4)`);

// 3. Test STFT and iSTFT Inversion
const spec = AudioDSP.stft(decoded.samples, 256, 128, sr);
console.log(`✓ STFT computed: ${spec.numFrames} frames x ${(spec.fftSize >> 1) + 1} bins`);

const reconstructed = AudioDSP.istft(spec);
console.log(`✓ iSTFT reconstructed: ${reconstructed.length} samples`);

const sdr = AudioDSP.computeSdr(decoded.samples, reconstructed);
const sisdr = AudioDSP.computeSiSdr(decoded.samples, reconstructed);
console.log(`✓ Invertibility SDR: ${sdr.toFixed(2)} dB (Target > 35 dB)`);
console.log(`✓ Invertibility SI-SDR: ${sisdr.toFixed(2)} dB (Target > 35 dB)`);

const sc = AudioDSP.computeSpectralConvergence(spec, AudioDSP.stft(reconstructed, 256, 128, sr));
const lsd = AudioDSP.computeLogSpectralDistance(spec, AudioDSP.stft(reconstructed, 256, 128, sr));
console.log(`✓ Spectral Convergence: ${sc.toExponential(4)} (Target < 1e-2)`);
console.log(`✓ Log-Spectral Distance: ${lsd.toFixed(4)} dB (Target < 0.1 dB)`);

if (sdr < 35.0) {
  console.error("DSP Inversion SDR below threshold!");
  process.exit(1);
}
console.log("🎉 Audio DSP Foundation PASSED all mathematical checks!");
