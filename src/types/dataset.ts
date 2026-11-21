/**
 * CINEGEN AI — Dataset & Degradation Domain Interfaces (Phase 2)
 */

export type DatasetSplit = "train" | "val" | "test";

export interface VideoDegradationConfig {
  // Perspective & Geometry
  perspectiveIntensity: number; // 0.0 - 1.0 (subtle to severe off-axis yaw/pitch)
  keystoneDistortion: boolean;

  // Camera Dynamics & Lens
  cameraShake: boolean;
  cameraShakeSpeed: number; // frequency in Hz
  motionBlur: boolean;
  defocusBlurRadius: number; // 0 (none) - 10 (heavy blur)

  // Sensor & Physical Screen Artifacts
  sensorNoiseAmount: number; // 0.0 - 1.0
  moirePattern: boolean;
  flickerFrequency: number; // 0.0 (none) - 12.0 Hz
  flickerAmplitude: number; // 0.0 - 0.3

  // Radiometric & Color
  brightnessShift: number; // -0.3 to +0.3
  contrastScale: number; // 0.7 to 1.5
  colorShift: { r: number; g: number; b: number }; // Multipliers e.g. 1.05, 0.95, 0.90 (warm/cool auditorium tint)

  // Resolution & Compression
  downscaleWidth: number; // e.g. 640 or 854
  downscaleHeight: number; // e.g. 360 or 480
  degradedFramerate: number; // e.g. 15, 18, 20 fps
  compressionCrf: number; // 28 - 42 (heavy macroblocking)

  // Occlusion
  simulatedOcclusion: boolean; // Cinema silhouette (heads in bottom third)
}

export interface AudioDegradationConfig {
  // Acoustic Environment & Reflections
  reverberationRt60: number; // 0.4s to 2.5s (auditorium reflection tail)
  echoDelayMs: number; // 50ms - 250ms
  echoDecay: number; // 0.1 - 0.5

  // Background Ambience & Noise Injection
  crowdNoiseLevel: number; // 0.0 - 1.0 (synthesized murmur / transient rustle)
  backgroundSpeechLevel: number; // 0.0 - 0.5
  microphoneHissLevel: number; // 0.0 - 1.0

  // Non-linear Transducer Distortion
  clippingThreshold: number; // 0.5 - 1.0 (0.7 means hard clipping over 70% peak)
  frequencyAttenuationLowCut: number; // High-pass cutoff in Hz (e.g. 150Hz bass roll-off)
  frequencyAttenuationHighCut: number; // Low-pass cutoff in Hz (e.g. 6000Hz cheap mic cutoff)
  dynamicRangeCompression: boolean;
  stereoImbalance: number; // -0.5 (left bias) to +0.5 (right bias)
  compressionBitrate: string; // e.g. "64k" or "96k" low-bitrate MP3/AAC
}

export interface DegradationProfile {
  id: string;
  name: string;
  description: string;
  video: VideoDegradationConfig;
  audio: AudioDegradationConfig;
}

export interface DatasetSamplePair {
  pairId: string;
  sourceId: string;
  split: DatasetSplit;
  license: string;
  cleanTarget: {
    sampleId: string;
    videoPath: string;
    audioPath: string;
    width: number;
    height: number;
    duration: number;
    framerate: number;
    videoCodec: string;
    audioCodec: string;
  };
  degradedSample: {
    sampleId: string;
    videoPath: string;
    audioPath: string;
    width: number;
    height: number;
    duration: number;
    framerate: number;
    videoCodec: string;
    audioCodec: string;
  };
  degradationProfileApplied: DegradationProfile;
  createdAt: string;
}

export interface DatasetManifest {
  manifestVersion: string;
  datasetName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  license: string;
  totalPairs: number;
  splits: {
    train: number;
    val: number;
    test: number;
  };
  sources: {
    sourceId: string;
    filename: string;
    duration: number;
    assignedSplit: DatasetSplit;
    license: string;
  }[];
  samples: DatasetSamplePair[];
}

export interface QualityValidationReport {
  passed: boolean;
  timestamp: string;
  totalChecked: number;
  errors: {
    pairId: string;
    type:
      | "missing_file"
      | "corrupt_media"
      | "mismatched_duration"
      | "broken_audio"
      | "invalid_resolution"
      | "metadata_discrepancy";
    message: string;
  }[];
  warnings: string[];
}
