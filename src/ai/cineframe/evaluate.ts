import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { CineFrameDatasetLoader } from "./dataset";
import { CineFrameSample, CineFrameEvaluationMetrics } from "@/types/cineframe";

export class CineFrameEvaluator {
  private checkpointDir: string;

  constructor(checkpointDir?: string) {
    this.checkpointDir =
      checkpointDir ||
      path.resolve("./storage_data/checkpoints/cineframe/best");
  }

  /**
   * Computes Peak Signal-to-Noise Ratio (PSNR) in decibels (dB)
   */
  public static computePsnr(predData: Float32Array | number[], targetData: Float32Array | number[]): number {
    let mse = 0;
    const n = Math.min(predData.length, targetData.length);
    for (let i = 0; i < n; i++) {
      const d = predData[i] - targetData[i];
      mse += d * d;
    }
    mse /= n;
    return 10 * Math.log10(1.0 / (mse + 1e-10));
  }

  /**
   * Computes Structural Similarity Index (SSIM) over 128x128x3 RGB images
   */
  public static computeSsim(
    predData: Float32Array | number[],
    targetData: Float32Array | number[],
    width = 128,
    height = 128
  ): number {
    let meanP = 0;
    let meanT = 0;
    const n = width * height * 3;

    for (let i = 0; i < n; i++) {
      meanP += predData[i];
      meanT += targetData[i];
    }
    meanP /= n;
    meanT /= n;

    let varP = 0;
    let varT = 0;
    let covPT = 0;

    for (let i = 0; i < n; i++) {
      const dP = predData[i] - meanP;
      const dT = targetData[i] - meanT;
      varP += dP * dP;
      varT += dT * dT;
      covPT += dP * dT;
    }
    varP /= n;
    varT /= n;
    covPT /= n;

    const c1 = 0.0001; // (0.01)^2
    const c2 = 0.0009; // (0.03)^2

    const numerator = (2 * meanP * meanT + c1) * (2 * covPT + c2);
    const denominator = (meanP * meanP + meanT * meanT + c1) * (varP + varT + c2);

    return numerator / Math.max(denominator, 1e-7);
  }

  /**
   * Computes Edge Gradient Preservation L1 Error
   */
  public static computeEdgeError(
    predData: Float32Array | number[],
    targetData: Float32Array | number[],
    width = 128,
    height = 128
  ): number {
    let edgeDiffSum = 0;
    let pixelCount = 0;

    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          const idx = (y * width + x) * 3 + c;
          const idxX = (y * width + (x + 1)) * 3 + c;
          const idxY = ((y + 1) * width + x) * 3 + c;

          const dxP = predData[idxX] - predData[idx];
          const dxT = targetData[idxX] - targetData[idx];
          const dyP = predData[idxY] - predData[idx];
          const dyT = targetData[idxY] - targetData[idx];

          edgeDiffSum += Math.abs(dxP - dxT) + Math.abs(dyP - dyT);
          pixelCount++;
        }
      }
    }
    return pixelCount > 0 ? edgeDiffSum / pixelCount : 0;
  }

  /**
   * Generates Conventional FFmpeg baseline simulation (Lanczos upsampling + unsharp)
   */
  public static simulateFfmpegBaseline(degraded64Buffer: Buffer): Float32Array {
    // 64x64 -> 128x128 Lanczos/Bilinear with unsharp filtering
    const f128 = new Float32Array(128 * 128 * 3);

    // Bilinear interpolation
    for (let y = 0; y < 128; y++) {
      const srcY = y / 2.0;
      const y0 = Math.floor(srcY);
      const y1 = Math.min(63, y0 + 1);
      const dy = srcY - y0;

      for (let x = 0; x < 128; x++) {
        const srcX = x / 2.0;
        const x0 = Math.floor(srcX);
        const x1 = Math.min(63, x0 + 1);
        const dx = srcX - x0;

        for (let c = 0; c < 3; c++) {
          const c00 = degraded64Buffer[(y0 * 64 + x0) * 3 + c] / 255.0;
          const c10 = degraded64Buffer[(y0 * 64 + x1) * 3 + c] / 255.0;
          const c01 = degraded64Buffer[(y1 * 64 + x0) * 3 + c] / 255.0;
          const c11 = degraded64Buffer[(y1 * 64 + x1) * 3 + c] / 255.0;

          const val =
            c00 * (1 - dx) * (1 - dy) +
            c10 * dx * (1 - dy) +
            c01 * (1 - dx) * dy +
            c11 * dx * dy;

          f128[(y * 128 + x) * 3 + c] = Math.min(1.0, Math.max(0.0, val));
        }
      }
    }

    // Apply unsharp mask filter (boost high frequencies)
    const sharpened = new Float32Array(128 * 128 * 3);
    for (let y = 1; y < 127; y++) {
      for (let x = 1; x < 127; x++) {
        for (let c = 0; c < 3; c++) {
          const idx = (y * 128 + x) * 3 + c;
          const center = f128[idx];
          const neighborAvg =
            (f128[((y - 1) * 128 + x) * 3 + c] +
              f128[((y + 1) * 128 + x) * 3 + c] +
              f128[(y * 128 + (x - 1)) * 3 + c] +
              f128[(y * 128 + (x + 1)) * 3 + c]) /
            4.0;
          // Unsharp amount 0.35
          const sharpVal = center + (center - neighborAvg) * 0.35;
          sharpened[idx] = Math.min(1.0, Math.max(0.0, sharpVal));
        }
      }
    }

    return sharpened;
  }

  /**
   * Generates degraded baseline (direct nearest/bilinear 64x64 -> 128x128)
   */
  public static simulateDegradedUpscaled(degraded64Buffer: Buffer): Float32Array {
    const f128 = new Float32Array(128 * 128 * 3);
    for (let y = 0; y < 128; y++) {
      const srcY = Math.min(63, Math.floor(y / 2));
      for (let x = 0; x < 128; x++) {
        const srcX = Math.min(63, Math.floor(x / 2));
        const srcIdx = (srcY * 64 + srcX) * 3;
        const dstIdx = (y * 128 + x) * 3;
        f128[dstIdx] = degraded64Buffer[srcIdx] / 255.0;
        f128[dstIdx + 1] = degraded64Buffer[srcIdx + 1] / 255.0;
        f128[dstIdx + 2] = degraded64Buffer[srcIdx + 2] / 255.0;
      }
    }
    return f128;
  }

  /**
   * Runs formal quantitative held-out test evaluation
   */
  public async evaluate(model: tf.LayersModel, testSamples?: CineFrameSample[]): Promise<CineFrameEvaluationMetrics> {
    console.log("=== RUNNING CINEFRAME HELD-OUT TEST BENCHMARK ===");

    const loader = new CineFrameDatasetLoader();
    const test = testSamples || loader.getSplits().test;
    const testSources = Array.from(new Set(test.map((s) => s.sourceId))).join(", ");
    console.log(`Evaluating on ${test.length} held-out test sequences from unseen Sources: ${testSources}...`);

    let totalDegPsnr = 0;
    let totalBasePsnr = 0;
    let totalCinePsnr = 0;

    let totalDegSsim = 0;
    let totalBaseSsim = 0;
    let totalCineSsim = 0;

    let totalEdgeErr = 0;
    let totalTempErr = 0;
    let totalLatency = 0;

    let prevPredData: Float32Array | null = null;
    let prevTargetData: Float32Array | null = null;

    for (const sample of test) {
      const startT = Date.now();

      // 1. Run CINEFRAME Neural Inference
      const inputTensor = tf.tidy(() => {
        return CineFrameDatasetLoader.loadDegradedSequenceTensor(sample.degradedFrames).expandDims(0) as tf.Tensor4D;
      });

      const predTensor = model.predict(inputTensor) as tf.Tensor4D;
      const latency = Date.now() - startT;
      totalLatency += latency;

      const predData = predTensor.dataSync() as Float32Array;
      inputTensor.dispose();
      predTensor.dispose();

      // 2. Load Ground Truth Clean Frame
      const cleanRgbPath = sample.cleanTargetFrame.replace(/\.png$/, ".rgb");
      const cleanBuf = fs.readFileSync(cleanRgbPath);
      const targetData = new Float32Array(cleanBuf.length);
      for (let i = 0; i < cleanBuf.length; i++) {
        targetData[i] = cleanBuf[i] / 255.0;
      }

      // 3. Load Degraded Middle Frame (64x64)
      const degMiddleRgbPath = sample.degradedFrames[1].replace(/\.png$/, "_64.rgb");
      const degMiddleBuf = fs.readFileSync(degMiddleRgbPath);

      // Baselines
      const degData = CineFrameEvaluator.simulateDegradedUpscaled(degMiddleBuf);
      const baseData = CineFrameEvaluator.simulateFfmpegBaseline(degMiddleBuf);

      // Metrics
      const degPsnr = CineFrameEvaluator.computePsnr(degData, targetData);
      const basePsnr = CineFrameEvaluator.computePsnr(baseData, targetData);
      const cinePsnr = CineFrameEvaluator.computePsnr(predData, targetData);

      const degSsim = CineFrameEvaluator.computeSsim(degData, targetData);
      const baseSsim = CineFrameEvaluator.computeSsim(baseData, targetData);
      const cineSsim = CineFrameEvaluator.computeSsim(predData, targetData);

      const edgeErr = CineFrameEvaluator.computeEdgeError(predData, targetData);

      totalDegPsnr += degPsnr;
      totalBasePsnr += basePsnr;
      totalCinePsnr += cinePsnr;

      totalDegSsim += degSsim;
      totalBaseSsim += baseSsim;
      totalCineSsim += cineSsim;

      totalEdgeErr += edgeErr;

      // Temporal Consistency Metric
      if (prevPredData && prevTargetData) {
        let tempDiff = 0;
        const n = predData.length;
        for (let i = 0; i < n; i++) {
          const dPred = predData[i] - prevPredData[i];
          const dTarget = targetData[i] - prevTargetData[i];
          tempDiff += Math.abs(dPred - dTarget);
        }
        totalTempErr += tempDiff / n;
      }

      prevPredData = predData;
      prevTargetData = targetData;
    }

    const n = test.length;
    const avgDegPsnr = totalDegPsnr / n;
    const avgBasePsnr = totalBasePsnr / n;
    const avgCinePsnr = totalCinePsnr / n;

    const avgDegSsim = totalDegSsim / n;
    const avgBaseSsim = totalBaseSsim / n;
    const avgCineSsim = totalCineSsim / n;

    const avgEdgeErr = totalEdgeErr / n;
    const avgTempErr = totalTempErr / Math.max(1, n - 1);
    const avgLatency = totalLatency / n;

    const memUsage = process.memoryUsage();
    const peakMemMb = (memUsage.heapUsed + memUsage.external) / (1024 * 1024);

    const metrics: CineFrameEvaluationMetrics = {
      totalTestFrames: n,
      degradedPsnr: avgDegPsnr,
      baselineFfmpegPsnr: avgBasePsnr,
      cineframePsnr: avgCinePsnr,
      psnrGainOverDegraded: avgCinePsnr - avgDegPsnr,
      psnrGainOverBaseline: avgCinePsnr - avgBasePsnr,
      degradedSsim: avgDegSsim,
      baselineFfmpegSsim: avgBaseSsim,
      cineframeSsim: avgCineSsim,
      ssimGainOverDegraded: avgCineSsim - avgDegSsim,
      ssimGainOverBaseline: avgCineSsim - avgBaseSsim,
      temporalConsistencyError: avgTempErr,
      edgePreservationError: avgEdgeErr,
      inferenceLatencyMsPerFrame: avgLatency,
      peakMemoryMb: peakMemMb,
    };

    console.log("\n=== CINEFRAME BENCHMARK RESULTS (HELD-OUT TEST SPLIT) ===");
    console.log(`Evaluated Sequences:      ${n}`);
    console.log(`Input Degraded PSNR:      ${avgDegPsnr.toFixed(2)} dB (SSIM: ${avgDegSsim.toFixed(4)})`);
    console.log(`Conventional FFmpeg PSNR: ${avgBasePsnr.toFixed(2)} dB (SSIM: ${avgBaseSsim.toFixed(4)})`);
    console.log(`CINEFRAME Restored PSNR:  ${avgCinePsnr.toFixed(2)} dB (SSIM: ${avgCineSsim.toFixed(4)})`);
    console.log(`PSNR Improvement:         +${(avgCinePsnr - avgBasePsnr).toFixed(2)} dB over conventional baseline`);
    console.log(`SSIM Improvement:         +${(avgCineSsim - avgBaseSsim).toFixed(4)} over conventional baseline`);
    console.log(`Temporal Consistency Err: ${avgTempErr.toFixed(5)}`);
    console.log(`Edge Preservation Error:  ${avgEdgeErr.toFixed(5)}`);
    console.log(`Inference Latency:        ${avgLatency.toFixed(2)} ms/frame`);
    console.log(`Peak Memory:              ${peakMemMb.toFixed(1)} MB`);

    return metrics;
  }
}
