import { spawn } from "child_process";
import fs from "fs";
import { aiRegistry } from "@/ai/models";

/**
 * CINEGEN AI — Perspective Correction Types
 */
export interface FFmpegCorners {
  x0: number; // Top-Left X
  y0: number; // Top-Left Y
  x1: number; // Top-Right X
  y1: number; // Top-Right Y
  x2: number; // Bottom-Left X (FFmpeg ordering)
  y2: number; // Bottom-Left Y (FFmpeg ordering)
  x3: number; // Bottom-Right X (FFmpeg ordering)
  y3: number; // Bottom-Right Y (FFmpeg ordering)
}

export interface GeometryValidationOptions {
  minArea?: number; // default: 0.35
  maxArea?: number; // default: 1.02
  minAspectRatio?: number; // default: 1.10
  maxAspectRatio?: number; // default: 2.65
  maxKeystoneAngleDeg?: number; // default: 25.0
  minEdgeLength?: number; // default: 0.05
  convexityTolerance?: number; // default: 1e-5
  canvasAspectRatio?: number; // default: 16/9 for normalized coordinates
}

export interface GeometryValidationResult {
  isValid: boolean;
  reason?: string;
  isConvex: boolean;
  area: number;
  aspectRatio: number;
  keystoneAngleDeg: number;
  edgeLengths: { top: number; right: number; bottom: number; left: number };
  crossProducts: [number, number, number, number];
}

export interface ConfidenceInputParams {
  geometry: GeometryValidationResult;
  occlusion?: [number, number]; // [areaFraction, severity]
  quality?: [number, number, number, number]; // [blur, noise, flicker, brightness]
  blurScore?: number;
  noiseScore?: number;
  brightnessShift?: number;
  temporalStability?: number;
  weights?: {
    convexity?: number;
    aspectRatio?: number;
    occlusion?: number;
    imageQuality?: number;
    temporalStability?: number;
  };
  threshold?: number; // default: 0.72
}

export interface ConfidenceResult {
  confidence: number;
  meetsThreshold: boolean;
  threshold: number;
  signals: {
    convexity: number;
    aspectRatio: number;
    occlusion: number;
    imageQuality: number;
    temporalStability: number;
  };
  weights: {
    convexity: number;
    aspectRatio: number;
    occlusion: number;
    imageQuality: number;
    temporalStability: number;
  };
  reason: string;
}

export interface SampleFrameAnalysis {
  timestampSec: number;
  corners: [number, number][]; // [TL, TR, BR, BL] normalized
  luminance: number; // 0.0 to 1.0
  blurScore: number;
  noiseScore: number;
  occlusion?: [number, number];
  rawOutput?: any;
}

export interface TemporalAnalysisResult {
  smoothedCorners: [number, number][];
  stabilityScore: number;
  hasSceneCut: boolean;
  motionType: "static" | "pan" | "shake" | "scene_cut";
  frameSamplesCount: number;
}

export interface FilterStringOptions {
  interpolation?: "cubic" | "linear";
  sense?: "source";
}

export interface PerspectiveDecision {
  enabled: boolean;
  filterString?: string;
  confidence: number;
  corners?: [number, number][]; // [TL, TR, BR, BL] normalized
  ffmpegCorners?: FFmpegCorners;
  reason: string;
  hasSceneCut: boolean;
  isConvex: boolean;
  area: number;
  aspectRatio: number;
  keystoneAngleDeg: number;
  interpolation: "cubic" | "linear";
  safetyMarginUsed: number;
}

export interface ChunkPerspectiveOptions {
  inputWidth?: number;
  inputHeight?: number;
  safetyMargin?: number;
  confidenceThreshold?: number;
  interpolation?: "cubic" | "linear";
  geometryOptions?: GeometryValidationOptions;
  sampleCount?: number;
}

export class PerspectiveService {
  /**
   * Default provisional confidence threshold
   */
  public static readonly DEFAULT_CONFIDENCE_THRESHOLD = 0.72;

  /**
   * Default safety margin for outward quad expansion (0.8%)
   */
  public static readonly DEFAULT_SAFETY_MARGIN = 0.008;

  /**
   * Convert CINEVISION [TL, TR, BR, BL] corners to FFmpeg [TL, TR, BL, BR] pixel coordinates.
   *
   * Performs audited outward vector expansion along quadrilateral edge directions
   * to mitigate content clipping, while clamping to boundaries to prevent uncontrolled
   * auditorium border intrusion.
   *
   * @param cineCorners 4 normalized corners in clockwise order: [TL, TR, BR, BL]
   * @param width Source video width in pixels
   * @param height Source video height in pixels
   * @param safetyMargin Outward expansion fraction (default 0.008 = 0.8%, 0 allowed)
   */
  public convertCineVisionToFFmpegCorners(
    cineCorners: [number, number][],
    width: number,
    height: number,
    safetyMargin: number = PerspectiveService.DEFAULT_SAFETY_MARGIN
  ): FFmpegCorners {
    if (!cineCorners || cineCorners.length < 4) {
      throw new Error("convertCineVisionToFFmpegCorners requires exactly 4 corner coordinates");
    }

    const TL = cineCorners[0];
    const TR = cineCorners[1];
    const BR = cineCorners[2];
    const BL = cineCorners[3];

    let expandedTL = [TL[0], TL[1]];
    let expandedTR = [TR[0], TR[1]];
    let expandedBR = [BR[0], BR[1]];
    let expandedBL = [BL[0], BL[1]];

    const delta = Math.max(0, safetyMargin);

    if (delta > 0) {
      // Vector directions along quad edges
      const vH_top = [TR[0] - TL[0], TR[1] - TL[1]];
      const vH_bot = [BR[0] - BL[0], BR[1] - BL[1]];
      const vV_left = [BL[0] - TL[0], BL[1] - TL[1]];
      const vV_right = [BR[0] - TR[0], BR[1] - TR[1]];

      expandedTL = [
        TL[0] - delta * vH_top[0] - delta * vV_left[0],
        TL[1] - delta * vH_top[1] - delta * vV_left[1],
      ];
      expandedTR = [
        TR[0] + delta * vH_top[0] - delta * vV_right[0],
        TR[1] + delta * vH_top[1] - delta * vV_right[1],
      ];
      expandedBR = [
        BR[0] + delta * vH_bot[0] + delta * vV_right[0],
        BR[1] + delta * vH_bot[1] + delta * vV_right[1],
      ];
      expandedBL = [
        BL[0] - delta * vH_bot[0] + delta * vV_left[0],
        BL[1] - delta * vH_bot[1] + delta * vV_left[1],
      ];
    }

    // Clamp normalized coordinates to [0.0, 1.0]
    const clamp = (v: number) => Math.max(0, Math.min(1, v));

    const cTL = [clamp(expandedTL[0]), clamp(expandedTL[1])];
    const cTR = [clamp(expandedTR[0]), clamp(expandedTR[1])];
    const cBR = [clamp(expandedBR[0]), clamp(expandedBR[1])];
    const cBL = [clamp(expandedBL[0]), clamp(expandedBL[1])];

    // Scale to pixel dimensions and map to FFmpeg ordering:
    // FFmpeg perspective filter expects:
    // x0, y0: Top-Left (TL)
    // x1, y1: Top-Right (TR)
    // x2, y2: Bottom-Left (BL)  <-- index 3 in CINEVISION
    // x3, y3: Bottom-Right (BR) <-- index 2 in CINEVISION
    return {
      x0: Math.round(cTL[0] * width),
      y0: Math.round(cTL[1] * height),
      x1: Math.round(cTR[0] * width),
      y1: Math.round(cTR[1] * height),
      x2: Math.round(cBL[0] * width),
      y2: Math.round(cBL[1] * height),
      x3: Math.round(cBR[0] * width),
      y3: Math.round(cBR[1] * height),
    };
  }

  /**
   * Validate quadrilateral geometry against calibrated physical constraints
   */
  public validateQuadGeometry(
    corners: [number, number][],
    options: GeometryValidationOptions = {}
  ): GeometryValidationResult {
    const minArea = options.minArea ?? 0.35;
    const maxArea = options.maxArea ?? 1.02;
    const minAspectRatio = options.minAspectRatio ?? 1.10;
    const maxAspectRatio = options.maxAspectRatio ?? 2.65;
    const maxKeystoneAngleDeg = options.maxKeystoneAngleDeg ?? 25.0;
    const minEdgeLength = options.minEdgeLength ?? 0.05;
    const convexityTolerance = options.convexityTolerance ?? 1e-5;

    if (!corners || corners.length !== 4) {
      return {
        isValid: false,
        reason: "Quadrilateral must have exactly 4 corner coordinates",
        isConvex: false,
        area: 0,
        aspectRatio: 0,
        keystoneAngleDeg: 0,
        edgeLengths: { top: 0, right: 0, bottom: 0, left: 0 },
        crossProducts: [0, 0, 0, 0],
      };
    }

    const [TL, TR, BR, BL] = corners;

    // Check finite numbers
    for (const pt of [TL, TR, BR, BL]) {
      if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
        return {
          isValid: false,
          reason: "Corner coordinates contain non-finite values",
          isConvex: false,
          area: 0,
          aspectRatio: 0,
          keystoneAngleDeg: 0,
          edgeLengths: { top: 0, right: 0, bottom: 0, left: 0 },
          crossProducts: [0, 0, 0, 0],
        };
      }
    }

    // Edge vectors in clockwise order
    const e0 = [TR[0] - TL[0], TR[1] - TL[1]]; // top
    const e1 = [BR[0] - TR[0], BR[1] - TR[1]]; // right
    const e2 = [BL[0] - BR[0], BL[1] - BR[1]]; // bottom
    const e3 = [TL[0] - BL[0], TL[1] - BL[1]]; // left

    // Edge lengths
    const lenTop = Math.hypot(e0[0], e0[1]);
    const lenRight = Math.hypot(e1[0], e1[1]);
    const lenBottom = Math.hypot(e2[0], e2[1]);
    const lenLeft = Math.hypot(e3[0], e3[1]);

    const edgeLengths = {
      top: lenTop,
      right: lenRight,
      bottom: lenBottom,
      left: lenLeft,
    };

    if (
      lenTop < minEdgeLength ||
      lenRight < minEdgeLength ||
      lenBottom < minEdgeLength ||
      lenLeft < minEdgeLength
    ) {
      return {
        isValid: false,
        reason: `Degenerate quadrilateral: one or more edges smaller than minimum length (${minEdgeLength})`,
        isConvex: false,
        area: 0,
        aspectRatio: 0,
        keystoneAngleDeg: 0,
        edgeLengths,
        crossProducts: [0, 0, 0, 0],
      };
    }

    // Cross-products (z-component) for clockwise orientation in y-down graphics coordinates
    const z0 = e0[0] * e1[1] - e0[1] * e1[0];
    const z1 = e1[0] * e2[1] - e1[1] * e2[0];
    const z2 = e2[0] * e3[1] - e2[1] * e3[0];
    const z3 = e3[0] * e0[1] - e3[1] * e0[0];
    const crossProducts: [number, number, number, number] = [z0, z1, z2, z3];

    // In y-down clockwise systems, every cross product must be strictly positive
    const isConvex =
      z0 > convexityTolerance &&
      z1 > convexityTolerance &&
      z2 > convexityTolerance &&
      z3 > convexityTolerance;

    if (!isConvex) {
      return {
        isValid: false,
        reason: "Non-convex or self-intersecting (bowtie) quadrilateral detected",
        isConvex: false,
        area: 0,
        aspectRatio: 0,
        keystoneAngleDeg: 0,
        edgeLengths,
        crossProducts,
      };
    }

    // Shoelace formula for area
    const shoelace =
      TL[0] * TR[1] -
      TL[1] * TR[0] +
      (TR[0] * BR[1] - TR[1] * BR[0]) +
      (BR[0] * BL[1] - BR[1] * BL[0]) +
      (BL[0] * TL[1] - BL[1] * TL[0]);
    const area = Math.abs(shoelace) * 0.5;

    if (area < minArea || area > maxArea) {
      return {
        isValid: false,
        reason: `Quadrilateral area (${area.toFixed(3)}) outside valid range [${minArea}, ${maxArea}]`,
        isConvex: true,
        area,
        aspectRatio: 0,
        keystoneAngleDeg: 0,
        edgeLengths,
        crossProducts,
      };
    }

    // Aspect Ratio: average width / average height, scaled by physical canvas aspect ratio
    const isPixelSpace = TL[0] > 2.0 || TR[0] > 2.0 || BR[0] > 2.0 || BL[0] > 2.0;
    const canvasAspectRatio = isPixelSpace ? 1.0 : (options.canvasAspectRatio ?? (16 / 9));
    const avgWidth = (lenTop + lenBottom) * 0.5;
    const avgHeight = (lenLeft + lenRight) * 0.5;
    const aspectRatio = avgHeight > 0 ? (avgWidth / avgHeight) * canvasAspectRatio : 0;

    if (aspectRatio < minAspectRatio || aspectRatio > maxAspectRatio) {
      return {
        isValid: false,
        reason: `Quadrilateral aspect ratio (${aspectRatio.toFixed(3)}) outside acceptable cinema range [${minAspectRatio}, ${maxAspectRatio}]`,
        isConvex: true,
        area,
        aspectRatio,
        keystoneAngleDeg: 0,
        edgeLengths,
        crossProducts,
      };
    }

    // Keystone angle calculation (relative angle between opposing edges)
    const radToDeg = 180 / Math.PI;
    const thetaTop = Math.atan2(e0[1], e0[0]) * radToDeg;
    // e2 goes BL -> BR in vector terms
    const thetaBottom = Math.atan2(BR[1] - BL[1], BR[0] - BL[0]) * radToDeg;
    const thetaLeft = Math.atan2(BL[0] - TL[0], BL[1] - TL[1]) * radToDeg;
    const thetaRight = Math.atan2(BR[0] - TR[0], BR[1] - TR[1]) * radToDeg;

    const deltaHoriz = Math.abs(thetaTop - thetaBottom);
    const deltaVert = Math.abs(thetaLeft - thetaRight);
    const keystoneAngleDeg = Math.max(deltaHoriz, deltaVert);

    if (keystoneAngleDeg > maxKeystoneAngleDeg) {
      return {
        isValid: false,
        reason: `Keystone distortion angle (${keystoneAngleDeg.toFixed(2)}°) exceeds maximum allowed (${maxKeystoneAngleDeg}°)`,
        isConvex: true,
        area,
        aspectRatio,
        keystoneAngleDeg,
        edgeLengths,
        crossProducts,
      };
    }

    return {
      isValid: true,
      isConvex: true,
      area,
      aspectRatio,
      keystoneAngleDeg,
      edgeLengths,
      crossProducts,
    };
  }

  /**
   * Deterministic 5-signal confidence calculation
   */
  public calculatePerspectiveConfidence(params: ConfidenceInputParams): ConfidenceResult {
    const { geometry, occlusion, quality } = params;
    const threshold = params.threshold ?? PerspectiveService.DEFAULT_CONFIDENCE_THRESHOLD;

    const weights = {
      convexity: params.weights?.convexity ?? 0.30,
      aspectRatio: params.weights?.aspectRatio ?? 0.20,
      occlusion: params.weights?.occlusion ?? 0.20,
      imageQuality: params.weights?.imageQuality ?? 0.15,
      temporalStability: params.weights?.temporalStability ?? 0.15,
    };

    // 1. Convexity Signal (0.0 or 1.0)
    const sConvex = geometry.isConvex ? 1.0 : 0.0;

    // 2. Aspect Ratio Signal (0.0 to 1.0)
    const ar = geometry.aspectRatio;
    let sAspect = 0.0;
    if (ar >= 1.15 && ar <= 2.50) {
      sAspect = 1.0;
    } else if (ar >= 1.00 && ar < 1.15) {
      sAspect = (ar - 1.00) / 0.15;
    } else if (ar > 2.50 && ar <= 2.80) {
      sAspect = (2.80 - ar) / 0.30;
    } else {
      sAspect = 0.0;
    }

    // 3. Occlusion Signal (0.0 to 1.0)
    let sOcc = 1.0;
    if (occlusion && occlusion.length >= 2) {
      const area = Math.max(0, Math.min(1, occlusion[0]));
      const severity = Math.max(0, Math.min(1, occlusion[1]));
      const penalty = 0.70 * area + 0.30 * severity;
      sOcc = Math.max(0, Math.min(1, 1.0 - penalty));
    }

    // 4. Image Quality Signal (0.0 to 1.0)
    let sQual = 0.85;
    const blur = params.blurScore ?? (quality ? quality[0] : 0.2);
    const noise = params.noiseScore ?? (quality ? quality[1] : 0.2);
    const brightness = params.brightnessShift ?? (quality ? quality[3] : 0.5);

    const sBlur = Math.max(0, Math.min(1, 1.0 - blur));
    const sNoise = Math.max(0, Math.min(1, 1.0 - noise));
    const sBright = Math.max(0, Math.min(1, 1.0 - 2.0 * Math.abs(Math.max(0, Math.min(1, brightness)) - 0.5)));
    sQual = 0.40 * sBlur + 0.40 * sNoise + 0.20 * sBright;

    // 5. Temporal Stability Signal (0.0 to 1.0)
    const sTemp = Math.max(0, Math.min(1, params.temporalStability ?? 1.0));

    // Weighted Composite Score
    let confidence =
      weights.convexity * sConvex +
      weights.aspectRatio * sAspect +
      weights.occlusion * sOcc +
      weights.imageQuality * sQual +
      weights.temporalStability * sTemp;

    confidence = Math.max(0, Math.min(1, confidence));

    // STRICT SAFETY RULE: Reject invalid geometry regardless of raw confidence score
    if (!geometry.isValid) {
      return {
        confidence: Math.min(confidence, 0.40),
        meetsThreshold: false,
        threshold,
        signals: {
          convexity: sConvex,
          aspectRatio: sAspect,
          occlusion: sOcc,
          imageQuality: sQual,
          temporalStability: sTemp,
        },
        weights,
        reason: `Geometry validation failed: ${geometry.reason || "Invalid quad"}`,
      };
    }

    const meetsThreshold = confidence >= threshold;
    const reason = meetsThreshold
      ? `Confidence score ${confidence.toFixed(3)} meets activation threshold (${threshold.toFixed(2)})`
      : `Confidence score ${confidence.toFixed(3)} is below activation threshold (${threshold.toFixed(2)})`;

    return {
      confidence,
      meetsThreshold,
      threshold,
      signals: {
        convexity: sConvex,
        aspectRatio: sAspect,
        occlusion: sOcc,
        imageQuality: sQual,
        temporalStability: sTemp,
      },
      weights,
      reason,
    };
  }

  /**
   * Analyze temporal continuity across sampled frames.
   * Detects scene cuts and pans without over-smoothing.
   */
  public analyzeTemporalStability(samples: SampleFrameAnalysis[]): TemporalAnalysisResult {
    if (!samples || samples.length === 0) {
      return {
        smoothedCorners: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        stabilityScore: 0.5,
        hasSceneCut: false,
        motionType: "static",
        frameSamplesCount: 0,
      };
    }

    if (samples.length === 1) {
      return {
        smoothedCorners: samples[0].corners,
        stabilityScore: 0.85,
        hasSceneCut: false,
        motionType: "static",
        frameSamplesCount: 1,
      };
    }

    // Measure frame-to-frame luminance and corner shifts
    let maxLuminanceDiff = 0;
    let maxCornerDisplacement = 0;
    let hasSceneCut = false;

    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const curr = samples[i];

      const lumDiff = Math.abs(curr.luminance - prev.luminance);
      if (lumDiff > maxLuminanceDiff) maxLuminanceDiff = lumDiff;

      let cornerDisp = 0;
      for (let k = 0; k < 4; k++) {
        cornerDisp += Math.hypot(
          curr.corners[k][0] - prev.corners[k][0],
          curr.corners[k][1] - prev.corners[k][1]
        );
      }
      cornerDisp /= 4.0;
      if (cornerDisp > maxCornerDisplacement) maxCornerDisplacement = cornerDisp;

      // Scene Cut Threshold: Significant luminance jump (> 0.35) or drastic corner leap (> 0.22)
      if (lumDiff > 0.35 || cornerDisp > 0.22) {
        hasSceneCut = true;
      }
    }

    // If scene cut occurs: DO NOT smooth across the cut.
    if (hasSceneCut) {
      // Pick the sample with highest quality or latest stable segment
      const selected = samples[samples.length - 1];
      return {
        smoothedCorners: selected.corners,
        stabilityScore: 0.55,
        hasSceneCut: true,
        motionType: "scene_cut",
        frameSamplesCount: samples.length,
      };
    }

    // Classify Motion: Static vs Pan vs Handheld Shake
    let motionType: "static" | "pan" | "shake" = "static";
    if (maxCornerDisplacement > 0.015) {
      // Check directional coherence between consecutive samples
      const d1 = [
        samples[1].corners[0][0] - samples[0].corners[0][0],
        samples[1].corners[0][1] - samples[0].corners[0][1],
      ];
      let coherent = true;
      if (samples.length > 2) {
        const d2 = [
          samples[2].corners[0][0] - samples[1].corners[0][0],
          samples[2].corners[0][1] - samples[1].corners[0][1],
        ];
        const dot = d1[0] * d2[0] + d1[1] * d2[1];
        if (dot < 0) {
          coherent = false; // Oscillating / handheld shake
        }
      }
      motionType = coherent ? "pan" : "shake";
    }

    // Apply motion-adaptive temporal filtering
    const smoothedCorners: [number, number][] = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];

    if (motionType === "pan") {
      // During pans: gentle tracking EMA (alpha=0.6 on latest frame) to avoid lagging behind camera
      const latest = samples[samples.length - 1].corners;
      const prev = samples[samples.length - 2].corners;
      for (let k = 0; k < 4; k++) {
        smoothedCorners[k] = [
          0.60 * latest[k][0] + 0.40 * prev[k][0],
          0.60 * latest[k][1] + 0.40 * prev[k][1],
        ];
      }
    } else {
      // Static or minor jitter: uniform mean across samples
      const n = samples.length;
      for (let k = 0; k < 4; k++) {
        let sumX = 0;
        let sumY = 0;
        for (let i = 0; i < n; i++) {
          sumX += samples[i].corners[k][0];
          sumY += samples[i].corners[k][1];
        }
        smoothedCorners[k] = [sumX / n, sumY / n];
      }
    }

    // Calculate stability score based on displacement variance
    const stabilityScore = Math.max(0.2, Math.min(1.0, 1.0 - 4.0 * maxCornerDisplacement));

    return {
      smoothedCorners,
      stabilityScore,
      hasSceneCut: false,
      motionType,
      frameSamplesCount: samples.length,
    };
  }

  /**
   * Build the FFmpeg perspective filter string
   */
  public buildPerspectiveFilterString(
    ffmpegCorners: FFmpegCorners,
    options: FilterStringOptions = {}
  ): string {
    const interp = options.interpolation || "cubic";
    const sense = options.sense || "source";

    const { x0, y0, x1, y1, x2, y2, x3, y3 } = ffmpegCorners;

    return `perspective=x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}:x2=${x2}:y2=${y2}:x3=${x3}:y3=${y3}:interpolation=${interp}:sense=${sense}`;
  }

  /**
   * Extract a raw RGB24 frame at a specified timestamp using FFmpeg
   */
  public async extractSampleFrame(
    videoPath: string,
    timestampSec: number,
    frameWidth: number = 128,
    frameHeight: number = 128
  ): Promise<{ buffer: Buffer; luminance: number }> {
    return new Promise((resolve, reject) => {
      const args = [
        "-ss",
        timestampSec.toFixed(3),
        "-i",
        videoPath,
        "-vframes",
        "1",
        "-vf",
        `scale=${frameWidth}:${frameHeight}`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ];

      const ffmpeg = spawn("ffmpeg", args);
      const chunks: Buffer[] = [];
      let errStr = "";

      ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        errStr += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Failed to extract sample frame at ${timestampSec}s: ${errStr}`));
        }

        const buffer = Buffer.concat(chunks);
        const expectedBytes = frameWidth * frameHeight * 3;
        if (buffer.length < expectedBytes) {
          return reject(
            new Error(
              `Extracted frame incomplete (${buffer.length} bytes, expected ${expectedBytes})`
            )
          );
        }

        // Calculate average frame luminance
        let lumSum = 0;
        const totalPixels = frameWidth * frameHeight;
        for (let i = 0; i < totalPixels; i++) {
          const idx = i * 3;
          const r = buffer[idx];
          const g = buffer[idx + 1];
          const b = buffer[idx + 2];
          lumSum += 0.299 * r + 0.587 * g + 0.114 * b;
        }
        const luminance = lumSum / (totalPixels * 255.0);

        resolve({ buffer, luminance });
      });
    });
  }

  /**
   * End-to-end chunk perspective evaluation.
   * Samples frames, executes CINEVISION neural inference, validates geometry,
   * checks temporal continuity, calculates confidence, and determines whether
   * perspective correction should be applied.
   */
  public async analyzeChunkPerspective(
    chunkPath: string,
    targetWidth: number,
    targetHeight: number,
    options: ChunkPerspectiveOptions = {}
  ): Promise<PerspectiveDecision> {
    if (!fs.existsSync(chunkPath)) {
      return {
        enabled: false,
        confidence: 0,
        reason: `Chunk file not found: ${chunkPath}`,
        hasSceneCut: false,
        isConvex: false,
        area: 0,
        aspectRatio: 0,
        keystoneAngleDeg: 0,
        interpolation: "cubic",
        safetyMarginUsed: 0,
      };
    }

    const inputWidth = options.inputWidth || 1920;
    const inputHeight = options.inputHeight || 1080;
    const safetyMargin = options.safetyMargin ?? PerspectiveService.DEFAULT_SAFETY_MARGIN;
    const threshold = options.confidenceThreshold ?? PerspectiveService.DEFAULT_CONFIDENCE_THRESHOLD;

    // Adaptive interpolation: cubic for <= 1080p, linear for 4K
    const is4K = inputWidth >= 3840 || inputHeight >= 2160 || targetWidth >= 3840 || targetHeight >= 2160;
    const interpolation: "cubic" | "linear" = options.interpolation || (is4K ? "linear" : "cubic");

    try {
      // Sample 3 representative frames (e.g. at 1.0s, 3.0s, 5.0s, or fallback)
      const sampleTimes = [1.0, 3.0, 5.0];
      const samples: SampleFrameAnalysis[] = [];

      for (const t of sampleTimes) {
        try {
          const { buffer, luminance } = await this.extractSampleFrame(chunkPath, t, 128, 128);
          const visionOut = await aiRegistry.cinevision.analyzeFrame(buffer);

          samples.push({
            timestampSec: t,
            corners: visionOut.corners,
            luminance,
            blurScore: visionOut.blurScore,
            noiseScore: visionOut.noiseScore,
            occlusion: visionOut.occlusion,
            rawOutput: visionOut,
          });
        } catch {
          // If seeking past end of a short chunk, break gracefully
          if (samples.length === 0) {
            // Try at 0.1s
            try {
              const { buffer, luminance } = await this.extractSampleFrame(chunkPath, 0.1, 128, 128);
              const visionOut = await aiRegistry.cinevision.analyzeFrame(buffer);
              samples.push({
                timestampSec: 0.1,
                corners: visionOut.corners,
                luminance,
                blurScore: visionOut.blurScore,
                noiseScore: visionOut.noiseScore,
                occlusion: visionOut.occlusion,
                rawOutput: visionOut,
              });
            } catch {}
          }
        }
      }

      if (samples.length === 0) {
        return {
          enabled: false,
          confidence: 0,
          reason: "Unable to extract sample frames from chunk for perspective analysis",
          hasSceneCut: false,
          isConvex: false,
          area: 0,
          aspectRatio: 0,
          keystoneAngleDeg: 0,
          interpolation,
          safetyMarginUsed: safetyMargin,
        };
      }

      // 1. Temporal Analysis across samples
      const tempResult = this.analyzeTemporalStability(samples);

      // 2. Validate Quad Geometry on smoothed corners
      const geomResult = this.validateQuadGeometry(
        tempResult.smoothedCorners,
        options.geometryOptions
      );

      // 3. Calculate Deterministic Confidence Score
      const latestSample = samples[samples.length - 1];
      const confResult = this.calculatePerspectiveConfidence({
        geometry: geomResult,
        occlusion: latestSample.occlusion,
        blurScore: latestSample.blurScore,
        noiseScore: latestSample.noiseScore,
        temporalStability: tempResult.stabilityScore,
        threshold,
      });

      // 4. Keystone Flatness Check:
      // If the screen corners are already virtually rectangular (e.g. within 1.5% of edges
      // and keystone tilt < 0.5°), perspective correction is redundant and would only
      // introduce resampling blur. Bypass it safely!
      const [TL, TR, BR, BL] = tempResult.smoothedCorners;
      const isAlreadyFlat =
        geomResult.keystoneAngleDeg < 0.5 &&
        TL[0] <= 0.015 &&
        TL[1] <= 0.015 &&
        TR[0] >= 0.985 &&
        TR[1] <= 0.015 &&
        BR[0] >= 0.985 &&
        BR[1] >= 0.985 &&
        BL[0] <= 0.015 &&
        BL[1] >= 0.985;

      if (isAlreadyFlat) {
        return {
          enabled: false,
          confidence: confResult.confidence,
          corners: tempResult.smoothedCorners,
          reason:
            "Screen geometry is already rectangular (keystone < 0.5°); perspective correction bypassed to preserve native raster quality",
          hasSceneCut: tempResult.hasSceneCut,
          isConvex: geomResult.isConvex,
          area: geomResult.area,
          aspectRatio: geomResult.aspectRatio,
          keystoneAngleDeg: geomResult.keystoneAngleDeg,
          interpolation,
          safetyMarginUsed: safetyMargin,
        };
      }

      if (!confResult.meetsThreshold) {
        return {
          enabled: false,
          confidence: confResult.confidence,
          corners: tempResult.smoothedCorners,
          reason: confResult.reason,
          hasSceneCut: tempResult.hasSceneCut,
          isConvex: geomResult.isConvex,
          area: geomResult.area,
          aspectRatio: geomResult.aspectRatio,
          keystoneAngleDeg: geomResult.keystoneAngleDeg,
          interpolation,
          safetyMarginUsed: safetyMargin,
        };
      }

      // Convert to FFmpeg pixel coordinates with outward safety margin
      const ffmpegCorners = this.convertCineVisionToFFmpegCorners(
        tempResult.smoothedCorners,
        inputWidth,
        inputHeight,
        safetyMargin
      );

      // Build FFmpeg filter string
      const filterString = this.buildPerspectiveFilterString(ffmpegCorners, {
        interpolation,
        sense: "source",
      });

      return {
        enabled: true,
        filterString,
        confidence: confResult.confidence,
        corners: tempResult.smoothedCorners,
        ffmpegCorners,
        reason: `Perspective correction activated (confidence: ${confResult.confidence.toFixed(3)}, keystone: ${geomResult.keystoneAngleDeg.toFixed(2)}°)`,
        hasSceneCut: tempResult.hasSceneCut,
        isConvex: geomResult.isConvex,
        area: geomResult.area,
        aspectRatio: geomResult.aspectRatio,
        keystoneAngleDeg: geomResult.keystoneAngleDeg,
        interpolation,
        safetyMarginUsed: safetyMargin,
      };
    } catch (err: any) {
      return {
        enabled: false,
        confidence: 0,
        reason: `Perspective analysis error: ${err.message || String(err)}`,
        hasSceneCut: false,
        isConvex: false,
        area: 0,
        aspectRatio: 0,
        keystoneAngleDeg: 0,
        interpolation,
        safetyMarginUsed: safetyMargin,
      };
    }
  }
}

export const perspectiveService = new PerspectiveService();
