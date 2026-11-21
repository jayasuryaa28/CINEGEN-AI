const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

class PerspectiveService {
  static DEFAULT_CONFIDENCE_THRESHOLD = 0.72;
  static DEFAULT_SAFETY_MARGIN = 0.008;

  convertCineVisionToFFmpegCorners(cineCorners, width, height, safetyMargin = PerspectiveService.DEFAULT_SAFETY_MARGIN) {
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

    const clamp = (v) => Math.max(0, Math.min(1, v));

    const cTL = [clamp(expandedTL[0]), clamp(expandedTL[1])];
    const cTR = [clamp(expandedTR[0]), clamp(expandedTR[1])];
    const cBR = [clamp(expandedBR[0]), clamp(expandedBR[1])];
    const cBL = [clamp(expandedBL[0]), clamp(expandedBL[1])];

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

  validateQuadGeometry(corners, options = {}) {
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

    const e0 = [TR[0] - TL[0], TR[1] - TL[1]];
    const e1 = [BR[0] - TR[0], BR[1] - TR[1]];
    const e2 = [BL[0] - BR[0], BL[1] - BR[1]];
    const e3 = [TL[0] - BL[0], TL[1] - BL[1]];

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

    const z0 = e0[0] * e1[1] - e0[1] * e1[0];
    const z1 = e1[0] * e2[1] - e1[1] * e2[0];
    const z2 = e2[0] * e3[1] - e2[1] * e3[0];
    const z3 = e3[0] * e0[1] - e3[1] * e0[0];
    const crossProducts = [z0, z1, z2, z3];

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

    const radToDeg = 180 / Math.PI;
    const thetaTop = Math.atan2(e0[1], e0[0]) * radToDeg;
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

  calculatePerspectiveConfidence(params) {
    const { geometry, occlusion, quality } = params;
    const threshold = params.threshold ?? PerspectiveService.DEFAULT_CONFIDENCE_THRESHOLD;

    const weights = {
      convexity: params.weights?.convexity ?? 0.30,
      aspectRatio: params.weights?.aspectRatio ?? 0.20,
      occlusion: params.weights?.occlusion ?? 0.20,
      imageQuality: params.weights?.imageQuality ?? 0.15,
      temporalStability: params.weights?.temporalStability ?? 0.15,
    };

    const sConvex = geometry.isConvex ? 1.0 : 0.0;

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

    let sOcc = 1.0;
    if (occlusion && occlusion.length >= 2) {
      const area = Math.max(0, Math.min(1, occlusion[0]));
      const severity = Math.max(0, Math.min(1, occlusion[1]));
      const penalty = 0.70 * area + 0.30 * severity;
      sOcc = Math.max(0, Math.min(1, 1.0 - penalty));
    }

    let sQual = 0.85;
    const blur = params.blurScore ?? (quality ? quality[0] : 0.2);
    const noise = params.noiseScore ?? (quality ? quality[1] : 0.2);
    const brightness = params.brightnessShift ?? (quality ? quality[3] : 0.5);

    const sBlur = Math.max(0, Math.min(1, 1.0 - blur));
    const sNoise = Math.max(0, Math.min(1, 1.0 - noise));
    const sBright = Math.max(0, Math.min(1, 1.0 - 2.0 * Math.abs(Math.max(0, Math.min(1, brightness)) - 0.5)));
    sQual = 0.40 * sBlur + 0.40 * sNoise + 0.20 * sBright;

    const sTemp = Math.max(0, Math.min(1, params.temporalStability ?? 1.0));

    let confidence =
      weights.convexity * sConvex +
      weights.aspectRatio * sAspect +
      weights.occlusion * sOcc +
      weights.imageQuality * sQual +
      weights.temporalStability * sTemp;

    confidence = Math.max(0, Math.min(1, confidence));

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

  analyzeTemporalStability(samples) {
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

      if (lumDiff > 0.35 || cornerDisp > 0.22) {
        hasSceneCut = true;
      }
    }

    if (hasSceneCut) {
      const selected = samples[samples.length - 1];
      return {
        smoothedCorners: selected.corners,
        stabilityScore: 0.55,
        hasSceneCut: true,
        motionType: "scene_cut",
        frameSamplesCount: samples.length,
      };
    }

    let motionType = "static";
    if (maxCornerDisplacement > 0.015) {
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
          coherent = false;
        }
      }
      motionType = coherent ? "pan" : "shake";
    }

    const smoothedCorners = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];

    if (motionType === "pan") {
      const latest = samples[samples.length - 1].corners;
      const prev = samples[samples.length - 2].corners;
      for (let k = 0; k < 4; k++) {
        smoothedCorners[k] = [
          0.60 * latest[k][0] + 0.40 * prev[k][0],
          0.60 * latest[k][1] + 0.40 * prev[k][1],
        ];
      }
    } else {
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

    const stabilityScore = Math.max(0.2, Math.min(1.0, 1.0 - 4.0 * maxCornerDisplacement));

    return {
      smoothedCorners,
      stabilityScore,
      hasSceneCut: false,
      motionType,
      frameSamplesCount: samples.length,
    };
  }

  buildPerspectiveFilterString(ffmpegCorners, options = {}) {
    const interp = options.interpolation || "cubic";
    const sense = options.sense || "source";

    const { x0, y0, x1, y1, x2, y2, x3, y3 } = ffmpegCorners;

    return `perspective=x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}:x2=${x2}:y2=${y2}:x3=${x3}:y3=${y3}:interpolation=${interp}:sense=${sense}`;
  }

  async extractSampleFrame(videoPath, timestampSec, frameWidth = 128, frameHeight = 128) {
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
      const chunks = [];
      let errStr = "";

      ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
      ffmpeg.stderr.on("data", (chunk) => {
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

  async analyzeChunkPerspective(chunkPath, targetWidth, targetHeight, options = {}) {
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

    const is4K = inputWidth >= 3840 || inputHeight >= 2160 || targetWidth >= 3840 || targetHeight >= 2160;
    const interpolation = options.interpolation || (is4K ? "linear" : "cubic");

    try {
      // Lazy load TrainedCineVision if aiRegistry is not loaded
      let cinevision = options.cinevisionModel;
      if (!cinevision) {
        try {
          const { aiRegistry } = require("../ai/models");
          cinevision = aiRegistry ? aiRegistry.cinevision : null;
        } catch {
          const { TrainedCineVision } = require("../ai/cinevision/adapter");
          cinevision = new TrainedCineVision();
        }
      }

      const sampleTimes = [1.0, 3.0, 5.0];
      const samples = [];

      for (const t of sampleTimes) {
        try {
          const { buffer, luminance } = await this.extractSampleFrame(chunkPath, t, 128, 128);
          const visionOut = await cinevision.analyzeFrame(buffer);

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
          if (samples.length === 0) {
            try {
              const { buffer, luminance } = await this.extractSampleFrame(chunkPath, 0.1, 128, 128);
              const visionOut = await cinevision.analyzeFrame(buffer);
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

      const tempResult = this.analyzeTemporalStability(samples);
      const geomResult = this.validateQuadGeometry(
        tempResult.smoothedCorners,
        options.geometryOptions
      );

      const latestSample = samples[samples.length - 1];
      const confResult = this.calculatePerspectiveConfidence({
        geometry: geomResult,
        occlusion: latestSample.occlusion,
        blurScore: latestSample.blurScore,
        noiseScore: latestSample.noiseScore,
        temporalStability: tempResult.stabilityScore,
        threshold,
      });

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

      const ffmpegCorners = this.convertCineVisionToFFmpegCorners(
        tempResult.smoothedCorners,
        inputWidth,
        inputHeight,
        safetyMargin
      );

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
    } catch (err) {
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

const perspectiveService = new PerspectiveService();

module.exports = {
  PerspectiveService,
  perspectiveService,
};
