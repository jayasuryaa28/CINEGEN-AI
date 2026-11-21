/**
 * CINEGEN AI — CINEVISION Model Annotation & Ground-Truth Targets
 */

export interface CineVisionGroundTruth {
  // Screen Corners: 4 (x, y) normalized coordinates in [0.0, 1.0]
  // [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
  corners: [number, number, number, number, number, number, number, number];

  // Screen Bounding Box: [ymin, xmin, ymax, xmax] in [0.0, 1.0]
  screenBox: [number, number, number, number];

  // 3x3 Homography Matrix (flattened to 8 elements, h33 normalized to 1.0)
  // [h11, h12, h13, h21, h22, h23, h31, h32]
  homography: [number, number, number, number, number, number, number, number];

  // Camera Motion & Tremor: [dx, dy] frame displacement
  displacement: [number, number];

  // Partial Occlusion: [hasOcclusion (0 or 1), occlusionAreaFraction (0.0 to 1.0)]
  occlusion: [number, number];

  // Spatial Occlusion Segmentation Mask: 8x8 spatial grid (64 normalized values in [0, 1])
  occlusionMask?: number[];

  // Quality Vector: [blurScore, noiseScore, flickerScore, brightnessShift]
  quality: [number, number, number, number];
}

export interface CineVisionSample {
  sampleId: string;
  sourceId: string;
  split: "train" | "val" | "test";
  framePath: string; // Degraded input frame image
  previousFramePath?: string; // For 2-frame motion estimation
  groundTruth: CineVisionGroundTruth;
}

export interface CineVisionPrediction {
  corners: [number, number, number, number, number, number, number, number];
  screenBox: [number, number, number, number];
  homography: [number, number, number, number, number, number, number, number];
  displacement: [number, number];
  occlusion: [number, number];
  occlusionMask?: number[];
  quality: [number, number, number, number];
}
