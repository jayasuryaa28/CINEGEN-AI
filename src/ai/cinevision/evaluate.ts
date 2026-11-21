import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { CineVisionTrainer } from "./train";
import { CineVisionDatasetLoader } from "./dataset";
import { CineVisionSample } from "@/types/cinevision";

export interface CineVisionEvaluationMetrics {
  totalTestSamples: number;
  cornerMaeNormalized: number;
  cornerPixelError1080p: number; // In pixels for 1920x1080
  meanScreenIoU: number;
  homographyReprojectionError: number;
  motionErrorNormalized: number;
  occlusionAccuracy: number;
  occlusionAreaMae: number;
  occlusionMaskPrecision: number;
  occlusionMaskRecall: number;
  occlusionMaskIoU: number;
  qualityMae: number;
  inferenceLatencyMsPerFrame: number;
}

export class CineVisionEvaluator {
  private checkpointDir: string;

  constructor(checkpointDir?: string) {
    this.checkpointDir =
      checkpointDir ||
      path.resolve("./storage_data/checkpoints/cinevision/best");
  }

  /**
   * Computes 2D Axis-Aligned Bounding Box Intersection-over-Union (IoU)
   */
  public static computeBoxIoU(
    boxA: [number, number, number, number], // [ymin, xmin, ymax, xmax]
    boxB: [number, number, number, number]
  ): number {
    const yA = Math.max(boxA[0], boxB[0]);
    const xA = Math.max(boxA[1], boxB[1]);
    const yB = Math.min(boxA[2], boxB[2]);
    const xB = Math.min(boxA[3], boxB[3]);

    const interArea = Math.max(0, yB - yA) * Math.max(0, xB - xA);
    const boxAArea = Math.max(0, boxA[2] - boxA[0]) * Math.max(0, boxA[3] - boxA[1]);
    const boxBArea = Math.max(0, boxB[2] - boxB[0]) * Math.max(0, boxB[3] - boxB[1]);

    const unionArea = boxAArea + boxBArea - interArea;
    return unionArea > 0 ? interArea / unionArea : 0;
  }

  /**
   * Projects 4 screen corners through 8-parameter homography matrix and calculates Euclidean error
   */
  public static computeHomographyError(
    hPred: number[],
    hGt: number[]
  ): number {
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];

    let totalDist = 0;
    for (const [x, y] of corners) {
      const denomP = hPred[6] * x + hPred[7] * y + 1;
      const xP = (hPred[0] * x + hPred[1] * y + hPred[2]) / (Math.abs(denomP) > 1e-6 ? denomP : 1e-6);
      const yP = (hPred[3] * x + hPred[4] * y + hPred[5]) / (Math.abs(denomP) > 1e-6 ? denomP : 1e-6);

      const denomG = hGt[6] * x + hGt[7] * y + 1;
      const xG = (hGt[0] * x + hGt[1] * y + hGt[2]) / (Math.abs(denomG) > 1e-6 ? denomG : 1e-6);
      const yG = (hGt[3] * x + hGt[4] * y + hGt[5]) / (Math.abs(denomG) > 1e-6 ? denomG : 1e-6);

      const dx = xP - xG;
      const dy = yP - yG;
      totalDist += Math.sqrt(dx * dx + dy * dy);
    }

    return totalDist / corners.length;
  }

  /**
   * Runs formal evaluation against the held-out test split
   */
  public async evaluate(): Promise<CineVisionEvaluationMetrics> {
    console.log(`=== RUNNING CINEVISION HELD-OUT TEST EVALUATION ===`);
    console.log(`Loading checkpoint from: ${this.checkpointDir}`);

    const model = await CineVisionTrainer.loadCheckpoint(this.checkpointDir);

    const loader = new CineVisionDatasetLoader();
    const { test } = loader.getSplits();
    console.log(`Evaluating on ${test.length} held-out test frames...`);

    let totalCornerError = 0;
    let totalIoU = 0;
    let totalHomoError = 0;
    let totalMotionError = 0;
    let correctOcclusionCount = 0;
    let totalOcclusionAreaError = 0;
    let totalQualityError = 0;
    let totalLatency = 0;
    let totalMaskIntersection = 0;
    let totalMaskUnion = 0;
    let totalMaskTp = 0;
    let totalMaskFp = 0;
    let totalMaskFn = 0;

    for (const sample of test) {
      const startT = Date.now();
      const inputTensor = tf.tidy(() => {
        const frame3d = CineVisionDatasetLoader.loadFrameTensor(sample.framePath, 64);
        return frame3d.expandDims(0) as tf.Tensor4D;
      });

      const preds = model.predict(inputTensor) as tf.Tensor[];
      const latency = Date.now() - startT;
      totalLatency += latency;

      const [predCornersT, predHomoT, predMotionT, predOccT, predQualT, predMaskT] = preds;

      const predCorners = Array.from(predCornersT.dataSync());
      const predHomo = Array.from(predHomoT.dataSync());
      const predMotion = Array.from(predMotionT.dataSync());
      const predOcc = Array.from(predOccT.dataSync());
      const predQual = Array.from(predQualT.dataSync());
      const predMask = predMaskT ? Array.from(predMaskT.dataSync()) : [];

      // Dispose prediction tensors
      inputTensor.dispose();
      preds.forEach((t) => t.dispose());

      // 1. Corner Error
      let sampleCornerErr = 0;
      for (let i = 0; i < 8; i++) {
        sampleCornerErr += Math.abs(predCorners[i] - sample.groundTruth.corners[i]);
      }
      totalCornerError += sampleCornerErr / 8;

      // 2. Screen Bounding Box IoU
      const predXs = [predCorners[0], predCorners[2], predCorners[4], predCorners[6]];
      const predYs = [predCorners[1], predCorners[3], predCorners[5], predCorners[7]];
      const predBox: [number, number, number, number] = [
        Math.min(...predYs),
        Math.min(...predXs),
        Math.max(...predYs),
        Math.max(...predXs),
      ];
      totalIoU += CineVisionEvaluator.computeBoxIoU(predBox, sample.groundTruth.screenBox);

      // 3. Homography Reprojection Error
      totalHomoError += CineVisionEvaluator.computeHomographyError(
        predHomo,
        sample.groundTruth.homography
      );

      // 4. Motion Error
      const mDx = predMotion[0] - sample.groundTruth.displacement[0];
      const mDy = predMotion[1] - sample.groundTruth.displacement[1];
      totalMotionError += Math.sqrt(mDx * mDx + mDy * mDy);

      // 5. Occlusion Accuracy & Area
      const predHasOcc = predOcc[0] >= 0.5 ? 1 : 0;
      const gtHasOcc = sample.groundTruth.occlusion[0] >= 0.5 ? 1 : 0;
      if (predHasOcc === gtHasOcc) correctOcclusionCount++;
      totalOcclusionAreaError += Math.abs(predOcc[1] - sample.groundTruth.occlusion[1]);

      // 5b. Spatial Occlusion Segmentation Mask Metrics
      if (predMask.length > 0 && sample.groundTruth.occlusionMask) {
        const gtMask = sample.groundTruth.occlusionMask;
        for (let j = 0; j < 64; j++) {
          const p = predMask[j] >= 0.5 ? 1 : 0;
          const y = gtMask[j] >= 0.5 ? 1 : 0;
          if (p === 1 && y === 1) {
            totalMaskTp++;
            totalMaskIntersection++;
            totalMaskUnion++;
          } else if (p === 1 && y === 0) {
            totalMaskFp++;
            totalMaskUnion++;
          } else if (p === 0 && y === 1) {
            totalMaskFn++;
            totalMaskUnion++;
          }
        }
      }

      // 6. Quality MAE
      let qErr = 0;
      for (let i = 0; i < 4; i++) {
        qErr += Math.abs(predQual[i] - sample.groundTruth.quality[i]);
      }
      totalQualityError += qErr / 4;
    }

    const n = test.length;
    const cornerMaeNorm = totalCornerError / n;
    // Scale normalized coordinate error to 1080p diagonal (sqrt(1920^2 + 1080^2) ≈ 2202.9)
    const cornerPixel1080p = cornerMaeNorm * 1080;
    const meanIoU = totalIoU / n;
    const meanHomoErr = totalHomoError / n;
    const meanMotionErr = totalMotionError / n;
    const occAccuracy = (correctOcclusionCount / n) * 100;
    const occAreaMae = totalOcclusionAreaError / n;
    const qualityMae = totalQualityError / n;
    const avgLatency = totalLatency / n;

    const maskPrecision =
      totalMaskTp + totalMaskFp > 0
        ? (totalMaskTp / (totalMaskTp + totalMaskFp)) * 100
        : 100;
    const maskRecall =
      totalMaskTp + totalMaskFn > 0
        ? (totalMaskTp / (totalMaskTp + totalMaskFn)) * 100
        : 100;
    const maskIoU =
      totalMaskUnion > 0 ? (totalMaskIntersection / totalMaskUnion) * 100 : 100;

    const metrics: CineVisionEvaluationMetrics = {
      totalTestSamples: n,
      cornerMaeNormalized: cornerMaeNorm,
      cornerPixelError1080p: cornerPixel1080p,
      meanScreenIoU: meanIoU,
      homographyReprojectionError: meanHomoErr,
      motionErrorNormalized: meanMotionErr,
      occlusionAccuracy: occAccuracy,
      occlusionAreaMae: occAreaMae,
      occlusionMaskPrecision: maskPrecision,
      occlusionMaskRecall: maskRecall,
      occlusionMaskIoU: maskIoU,
      qualityMae,
      inferenceLatencyMsPerFrame: avgLatency,
    };

    console.log("\n=== TEST SPLIT BENCHMARK RESULTS ===");
    console.log(`Evaluated Test Frames: ${n}`);
    console.log(`Corner Coordinate Error: ${cornerMaeNorm.toFixed(4)} normalized (~${cornerPixel1080p.toFixed(1)} px at 1080p)`);
    console.log(`Mean Screen IoU: ${(meanIoU * 100).toFixed(2)}%`);
    console.log(`Homography Reprojection Error: ${meanHomoErr.toFixed(4)} normalized units`);
    console.log(`Camera Motion Error: ${meanMotionErr.toFixed(4)}`);
    console.log(`Occlusion Detection Accuracy: ${occAccuracy.toFixed(1)}% (Area MAE: ${occAreaMae.toFixed(4)})`);
    console.log(`Occlusion Mask Pixel Precision: ${maskPrecision.toFixed(1)}%, Recall: ${maskRecall.toFixed(1)}%, Mask IoU: ${maskIoU.toFixed(1)}%`);
    console.log(`Quality Estimation MAE: ${qualityMae.toFixed(4)}`);
    console.log(`Average Inference Latency: ${avgLatency.toFixed(2)} ms/frame`);

    return metrics;
  }
}
