/**
 * CINEGEN AI — CINEFRAME Neural Network Types & Contracts (Phase 4)
 *
 * Types for Video Restoration, Super-Resolution, Deblurring, Denoising,
 * Deblocking, and Temporal Consistency Enhancement.
 */

export interface CineFrameSample {
  sampleId: string;
  sourceId: string;
  split: "train" | "val" | "test";
  // Temporal 3-frame degraded sequence: [t-1, t, t+1]
  degradedFrames: [string, string, string];
  // High-resolution clean target frame at time t
  cleanTargetFrame: string;
  // Optional conditioning parameters from CINEVISION
  conditioning?: CineFrameConditioning;
}

export interface CineFrameConditioning {
  blurScore: number;
  noiseScore: number;
  flickerScore: number;
  brightnessShift: number;
  hasScreenPerspective: boolean;
}

export interface CineFrameModelConfig {
  scaleFactor: 2 | 4;
  inputChannels: number; // 9 for 3-frame RGB
  baseFilters: number;
  numResidualBlocks: number;
  useAttention: boolean;
}

export interface CineFrameEvaluationMetrics {
  totalTestFrames: number;
  degradedPsnr: number;
  baselineFfmpegPsnr: number;
  cineframePsnr: number;
  psnrGainOverDegraded: number;
  psnrGainOverBaseline: number;
  degradedSsim: number;
  baselineFfmpegSsim: number;
  cineframeSsim: number;
  ssimGainOverDegraded: number;
  ssimGainOverBaseline: number;
  temporalConsistencyError: number;
  edgePreservationError: number;
  inferenceLatencyMsPerFrame: number;
  peakMemoryMb: number;
}
