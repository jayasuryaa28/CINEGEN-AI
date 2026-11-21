const { AudioDSP } = require("../src/ai/audio/dsp");

function stftPadded(samples, fftSize = 256, hopSize = 128) {
  const pad = fftSize >> 1;
  const padded = new Float32Array(samples.length + pad * 2);
  // Reflect pad
  for (let i = 0; i < pad; i++) {
    padded[pad - 1 - i] = samples[i + 1] || samples[0];
  }
  padded.set(samples, pad);
  for (let i = 0; i < pad; i++) {
    padded[pad + samples.length + i] = samples[samples.length - 2 - i] || samples[samples.length - 1];
  }

  const spec = AudioDSP.stft(padded, fftSize, hopSize);
  spec.pad = pad;
  spec.realLength = samples.length;
  return spec;
}

function istftPadded(spec) {
  const fullRec = AudioDSP.istft(spec);
  return fullRec.subarray(spec.pad, spec.pad + spec.realLength);
}

const sr = 16000;
const nSamples = sr * 1.0;
const original = new Float32Array(nSamples);
for (let i = 0; i < nSamples; i++) {
  const t = i / sr;
  original[i] = 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 880 * t);
}

const spec = stftPadded(original, 256, 128);
const rec = istftPadded(spec);

console.log("Full Padded SDR:", AudioDSP.computeSdr(original, rec).toFixed(2), "dB");
console.log("Full Padded SI-SDR:", AudioDSP.computeSiSdr(original, rec).toFixed(2), "dB");
