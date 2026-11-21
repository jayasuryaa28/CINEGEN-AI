/**
 * CINEGEN AI — Audio Digital Signal Processing (DSP) Foundation (CommonJS)
 */

class AudioDSP {
  static DEFAULT_SAMPLE_RATE = 16000;
  static DEFAULT_FFT_SIZE = 256;
  static DEFAULT_HOP_SIZE = 128;

  // 1. WAV Encoding / Decoding (16-bit PCM Mono)
  static decodeWav(buffer) {
    if (buffer.length < 44) {
      throw new Error("Invalid WAV buffer: Header too small");
    }

    const riff = buffer.toString("ascii", 0, 4);
    const wave = buffer.toString("ascii", 8, 12);
    if (riff !== "RIFF" || wave !== "WAVE") {
      throw new Error("Invalid WAV format: Missing RIFF/WAVE header");
    }

    const numChannels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const bitsPerSample = buffer.readUInt16LE(34);

    let offset = 12;
    let dataOffset = -1;
    let dataLength = 0;

    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === "data") {
        dataOffset = offset + 8;
        dataLength = chunkSize;
        break;
      }
      offset += 8 + chunkSize;
    }

    if (dataOffset === -1) {
      dataOffset = 44;
      dataLength = buffer.length - 44;
    }

    const bytesPerSample = bitsPerSample / 8;
    const totalSamplesInBytes = Math.min(dataLength, buffer.length - dataOffset);
    const numFrames = Math.floor(totalSamplesInBytes / (numChannels * bytesPerSample));
    const monoSamples = new Float32Array(numFrames);

    if (bitsPerSample === 16) {
      for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          const sampleIdx = dataOffset + (i * numChannels + ch) * 2;
          sum += buffer.readInt16LE(sampleIdx) / 32768.0;
        }
        monoSamples[i] = sum / numChannels;
      }
    } else if (bitsPerSample === 8) {
      for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          const sampleIdx = dataOffset + (i * numChannels + ch);
          sum += (buffer.readUInt8(sampleIdx) - 128) / 128.0;
        }
        monoSamples[i] = sum / numChannels;
      }
    } else {
      throw new Error(`Unsupported bits per sample: ${bitsPerSample}`);
    }

    return { samples: monoSamples, sampleRate };
  }

  static encodeWav(samples, sampleRate = AudioDSP.DEFAULT_SAMPLE_RATE) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = samples.length * numChannels * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
    buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1.0, Math.min(1.0, samples[i]));
      const val = Math.round(clamped * 32767.0);
      buffer.writeInt16LE(val, 44 + i * 2);
    }

    return buffer;
  }

  // 2. Fast Fourier Transform (Cooley-Tukey Radix-2)
  static fft(real, imag) {
    const n = real.length;
    if ((n & (n - 1)) !== 0) throw new Error("FFT size must be a power of 2");

    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        const tr = real[i]; real[i] = real[j]; real[j] = tr;
        const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const angle = (-2.0 * Math.PI) / len;
      const wStepR = Math.cos(angle);
      const wStepI = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let wr = 1.0;
        let wi = 0.0;
        for (let k = 0; k < halfLen; k++) {
          const pos = i + k;
          const match = pos + halfLen;

          const tr = wr * real[match] - wi * imag[match];
          const ti = wr * imag[match] + wi * real[match];

          real[match] = real[pos] - tr;
          imag[match] = imag[pos] - ti;
          real[pos] += tr;
          imag[pos] += ti;

          const nextWr = wr * wStepR - wi * wStepI;
          wi = wr * wStepI + wi * wStepR;
          wr = nextWr;
        }
      }
    }
  }

  static ifft(real, imag) {
    const n = real.length;
    for (let i = 0; i < n; i++) imag[i] = -imag[i];
    this.fft(real, imag);
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] = -imag[i] / n;
    }
  }

  // 3. STFT / iSTFT with Reflection Padding
  static getHannWindow(length) {
    const win = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      win[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / length));
    }
    return win;
  }

  static stft(samples, fftSize = AudioDSP.DEFAULT_FFT_SIZE, hopSize = AudioDSP.DEFAULT_HOP_SIZE, sampleRate = AudioDSP.DEFAULT_SAMPLE_RATE) {
    const pad = fftSize >> 1;
    const padded = new Float32Array(samples.length + pad * 2);

    for (let i = 0; i < pad; i++) {
      padded[pad - 1 - i] = samples[i + 1] ?? samples[0];
    }
    padded.set(samples, pad);
    for (let i = 0; i < pad; i++) {
      padded[pad + samples.length + i] = samples[samples.length - 2 - i] ?? samples[samples.length - 1];
    }

    const window = this.getHannWindow(fftSize);
    const numBins = (fftSize >> 1) + 1;
    const numFrames = Math.max(1, Math.floor((padded.length - fftSize) / hopSize) + 1);

    const magnitudes = [];
    const phases = [];

    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);

    for (let t = 0; t < numFrames; t++) {
      const start = t * hopSize;
      for (let i = 0; i < fftSize; i++) {
        const s = start + i < padded.length ? padded[start + i] : 0.0;
        real[i] = s * window[i];
        imag[i] = 0.0;
      }

      this.fft(real, imag);

      const mag = new Float32Array(numBins);
      const ph = new Float32Array(numBins);

      for (let f = 0; f < numBins; f++) {
        mag[f] = Math.sqrt(real[f] * real[f] + imag[f] * imag[f]);
        ph[f] = Math.atan2(imag[f], real[f]);
      }

      magnitudes.push(mag);
      phases.push(ph);
    }

    return {
      magnitudes,
      phases,
      numFrames,
      fftSize,
      hopSize,
      sampleRate,
      originalLength: samples.length,
      pad,
    };
  }

  static istft(spec) {
    const { magnitudes, phases, numFrames, fftSize, hopSize, originalLength, pad } = spec;
    const window = this.getHannWindow(fftSize);
    const numBins = (fftSize >> 1) + 1;

    const paddedLength = (numFrames - 1) * hopSize + fftSize;
    const output = new Float32Array(paddedLength);
    const windowSum = new Float32Array(paddedLength);

    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);

    for (let t = 0; t < numFrames; t++) {
      const mag = magnitudes[t];
      const ph = phases[t];

      for (let f = 0; f < numBins; f++) {
        const m = mag[f];
        const p = ph[f];
        const r = m * Math.cos(p);
        const im = m * Math.sin(p);

        real[f] = r;
        imag[f] = im;

        if (f > 0 && f < numBins - 1) {
          real[fftSize - f] = r;
          imag[fftSize - f] = -im;
        }
      }

      this.ifft(real, imag);

      const start = t * hopSize;
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx < paddedLength) {
          output[idx] += real[i] * window[i];
          windowSum[idx] += window[i] * window[i];
        }
      }
    }

    for (let i = 0; i < paddedLength; i++) {
      if (windowSum[i] > 1e-4) {
        output[i] /= windowSum[i];
      }
    }

    const unpadded = new Float32Array(originalLength);
    for (let i = 0; i < originalLength; i++) {
      unpadded[i] = output[pad + i];
    }

    return unpadded;
  }

  // 4. Evaluation Metrics
  static computeSdr(reference, estimated) {
    const n = Math.min(reference.length, estimated.length);
    let sEnergy = 0.0;
    let errEnergy = 0.0;

    for (let i = 0; i < n; i++) {
      const s = reference[i];
      const e = s - estimated[i];
      sEnergy += s * s;
      errEnergy += e * e;
    }

    if (errEnergy < 1e-9) return 50.0;
    return 10.0 * Math.log10(sEnergy / (errEnergy + 1e-10));
  }

  static computeSiSdr(reference, estimated) {
    const n = Math.min(reference.length, estimated.length);
    let dotRefEst = 0.0;
    let dotRefRef = 0.0;

    for (let i = 0; i < n; i++) {
      dotRefEst += reference[i] * estimated[i];
      dotRefRef += reference[i] * reference[i];
    }

    const alpha = (dotRefEst + 1e-9) / (dotRefRef + 1e-9);

    let sTargetEnergy = 0.0;
    let eNoiseEnergy = 0.0;

    for (let i = 0; i < n; i++) {
      const sTarget = alpha * reference[i];
      const eNoise = estimated[i] - sTarget;
      sTargetEnergy += sTarget * sTarget;
      eNoiseEnergy += eNoise * eNoise;
    }

    if (eNoiseEnergy < 1e-9) return 50.0;
    return 10.0 * Math.log10((sTargetEnergy + 1e-9) / (eNoiseEnergy + 1e-9));
  }

  static computeSpectralConvergence(refSpec, estSpec) {
    const numFrames = Math.min(refSpec.numFrames, estSpec.numFrames);
    const numBins = (refSpec.fftSize >> 1) + 1;

    let numDiff = 0.0;
    let denRef = 0.0;

    for (let t = 0; t < numFrames; t++) {
      for (let f = 0; f < numBins; f++) {
        const d = refSpec.magnitudes[t][f] - estSpec.magnitudes[t][f];
        numDiff += d * d;
        denRef += refSpec.magnitudes[t][f] * refSpec.magnitudes[t][f];
      }
    }

    return Math.sqrt(numDiff / (denRef + 1e-9));
  }

  static computeLogSpectralDistance(refSpec, estSpec) {
    const numFrames = Math.min(refSpec.numFrames, estSpec.numFrames);
    const numBins = (refSpec.fftSize >> 1) + 1;
    let totalLsd = 0.0;

    for (let t = 0; t < numFrames; t++) {
      let frameDist = 0.0;
      for (let f = 0; f < numBins; f++) {
        const rLog = Math.log10(Math.max(1e-7, refSpec.magnitudes[t][f]));
        const eLog = Math.log10(Math.max(1e-7, estSpec.magnitudes[t][f]));
        const d = 20.0 * (rLog - eLog);
        frameDist += d * d;
      }
      totalLsd += Math.sqrt(frameDist / numBins);
    }

    return totalLsd / numFrames;
  }
}

module.exports = { AudioDSP };
