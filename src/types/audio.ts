/**
 * CINEGEN AI — Audio AI System Types & Interfaces (Phase 5)
 */

export interface AudioSpectrogramConfig {
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  numBins: number; // (fftSize / 2) + 1
}

export interface AudioEvaluationMetrics {
  sdr: number;             // Signal-to-Distortion Ratio (dB)
  siSdr: number;           // Scale-Invariant Signal-to-Distortion Ratio (dB)
  spectralConvergence: number; // Spectral Convergence (SC)
  logSpectralDistance: number; // Log-Spectral Distance (LSD in dB)
  latencyMs: number;
}

export interface AudioStems {
  dialogue: Buffer;
  music: Buffer;
  effects: Buffer;
}

export interface AudioStemsMetrics {
  dialogueSdr: number;
  musicSdr: number;
  effectsSdr: number;
  overallSdr: number;
}
