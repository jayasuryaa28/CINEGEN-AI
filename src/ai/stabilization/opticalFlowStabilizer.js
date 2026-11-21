/**
 * CINEGEN AI — Optical Flow Video Stabilizer (CommonJS)
 */

class OpticalFlowStabilizer {
  constructor(config = {}) {
    this.config = {
      gridSize: config.gridSize ?? 8,
      searchRadius: config.searchRadius ?? 6,
      smoothingStrength: config.smoothingStrength ?? 0.6,
      gaussianWindowRadius: config.gaussianWindowRadius ?? 5,
      maxShiftRatio: config.maxShiftRatio ?? 0.08,
      downscaleWidth: config.downscaleWidth ?? 128,
      downscaleHeight: config.downscaleHeight ?? 72,
    };
  }

  downscaleToGrayscale(rgbBuf, srcWidth, srcHeight, dstWidth, dstHeight) {
    const gray = new Uint8Array(dstWidth * dstHeight);
    const xRatio = srcWidth / dstWidth;
    const yRatio = srcHeight / dstHeight;

    for (let dy = 0; dy < dstHeight; dy++) {
      const sy = Math.min(srcHeight - 1, Math.floor(dy * yRatio));
      const rowOffset = dy * dstWidth;
      const srcRowOffset = sy * srcWidth * 3;

      for (let dx = 0; dx < dstWidth; dx++) {
        const sx = Math.min(srcWidth - 1, Math.floor(dx * xRatio));
        const srcIdx = srcRowOffset + sx * 3;
        const r = rgbBuf[srcIdx] || 0;
        const g = rgbBuf[srcIdx + 1] || 0;
        const b = rgbBuf[srcIdx + 2] || 0;
        gray[rowOffset + dx] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }

    return gray;
  }

  estimateGlobalMotion(prevGray, currGray, width, height) {
    const { gridSize, searchRadius } = this.config;
    const blockW = Math.floor(width / gridSize);
    const blockH = Math.floor(height / gridSize);

    const vectors = [];

    for (let gy = 0; gy < gridSize; gy++) {
      const by = gy * blockH;
      for (let gx = 0; gx < gridSize; gx++) {
        const bx = gx * blockW;

        let bestSAD = Infinity;
        let bestDx = 0;
        let bestDy = 0;

        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
          for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            let sad = 0;
            let sampleCount = 0;

            for (let py = 2; py < blockH - 2; py += 2) {
              const y1 = by + py;
              const y2 = y1 + dy;
              if (y2 < 0 || y2 >= height) continue;

              const row1 = y1 * width;
              const row2 = y2 * width;

              for (let px = 2; px < blockW - 2; px += 2) {
                const x1 = bx + px;
                const x2 = x1 + dx;
                if (x2 < 0 || x2 >= width) continue;

                const diff = Math.abs(currGray[row2 + x2] - prevGray[row1 + x1]);
                sad += diff;
                sampleCount++;
              }
            }

            if (sampleCount > 0) {
              const normalizedSAD = sad / sampleCount;
              if (normalizedSAD < bestSAD) {
                bestSAD = normalizedSAD;
                bestDx = dx;
                bestDy = dy;
              }
            }
          }
        }

        vectors.push({ dx: bestDx, dy: bestDy });
      }
    }

    return this.calculateTrimmedMedianVector(vectors);
  }

  calculateTrimmedMedianVector(vectors) {
    if (vectors.length === 0) return { dx: 0, dy: 0 };

    const dxs = vectors.map((v) => v.dx).sort((a, b) => a - b);
    const dys = vectors.map((v) => v.dy).sort((a, b) => a - b);

    const trimCount = Math.floor(vectors.length * 0.25);
    const validDxs = dxs.slice(trimCount, dxs.length - trimCount);
    const validDys = dys.slice(trimCount, dys.length - trimCount);

    const medianDx = validDxs[Math.floor(validDxs.length / 2)] || 0;
    const medianDy = validDys[Math.floor(validDys.length / 2)] || 0;

    return { dx: medianDx, dy: medianDy };
  }

  smoothTrajectory(trajectory) {
    const N = trajectory.length;
    if (N === 0) return [];
    if (this.config.smoothingStrength <= 0.01) return [...trajectory];

    const smoothed = [];
    const R = this.config.gaussianWindowRadius;
    const sigma = Math.max(0.5, R * this.config.smoothingStrength);

    const kernel = [];
    let kernelSum = 0;
    for (let k = -R; k <= R; k++) {
      const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
      kernel.push(weight);
      kernelSum += weight;
    }
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= kernelSum;
    }

    for (let i = 0; i < N; i++) {
      let sumDx = 0;
      let sumDy = 0;
      let effectiveWeightSum = 0;

      for (let k = -R; k <= R; k++) {
        const neighborIdx = Math.min(Math.max(0, i + k), N - 1);
        const weight = kernel[k + R];
        sumDx += trajectory[neighborIdx].dx * weight;
        sumDy += trajectory[neighborIdx].dy * weight;
        effectiveWeightSum += weight;
      }

      smoothed.push({
        dx: sumDx / effectiveWeightSum,
        dy: sumDy / effectiveWeightSum,
      });
    }

    return smoothed;
  }

  warpFrame(srcBuf, width, height, shiftX, shiftY) {
    const maxShiftX = Math.round(width * this.config.maxShiftRatio);
    const maxShiftY = Math.round(height * this.config.maxShiftRatio);

    const clampedDx = Math.max(-maxShiftX, Math.min(maxShiftX, Math.round(shiftX)));
    const clampedDy = Math.max(-maxShiftY, Math.min(maxShiftY, Math.round(shiftY)));

    if (clampedDx === 0 && clampedDy === 0) {
      return Buffer.from(srcBuf);
    }

    const dstBuf = Buffer.alloc(width * height * 3);

    for (let y = 0; y < height; y++) {
      const srcY = Math.max(0, Math.min(height - 1, y - clampedDy));
      const dstRowOffset = y * width * 3;
      const srcRowOffset = srcY * width * 3;

      for (let x = 0; x < width; x++) {
        const srcX = Math.max(0, Math.min(width - 1, x - clampedDx));
        const dstIdx = dstRowOffset + x * 3;
        const srcIdx = srcRowOffset + srcX * 3;

        dstBuf[dstIdx] = srcBuf[srcIdx];
        dstBuf[dstIdx + 1] = srcBuf[srcIdx + 1];
        dstBuf[dstIdx + 2] = srcBuf[srcIdx + 2];
      }
    }

    return dstBuf;
  }

  processSequence(frames, width, height) {
    if (frames.length === 0) {
      return {
        stabilizedFrames: [],
        metrics: {
          rawTrajectoryVariance: 0,
          smoothedTrajectoryVariance: 0,
          jitterReductionPercent: 0,
          averageCorrectionPx: 0,
          maxCorrectionPx: 0,
          framesProcessed: 0,
        },
      };
    }

    const { downscaleWidth, downscaleHeight } = this.config;
    const scaleX = width / downscaleWidth;
    const scaleY = height / downscaleHeight;

    const grays = frames.map((f) =>
      this.downscaleToGrayscale(f, width, height, downscaleWidth, downscaleHeight)
    );

    const velocities = [{ dx: 0, dy: 0 }];
    for (let i = 1; i < grays.length; i++) {
      const v = this.estimateGlobalMotion(grays[i - 1], grays[i], downscaleWidth, downscaleHeight);
      velocities.push({
        dx: v.dx * scaleX,
        dy: v.dy * scaleY,
      });
    }

    const cumulativeTrajectory = [{ dx: 0, dy: 0 }];
    let curX = 0;
    let curY = 0;
    for (let i = 1; i < velocities.length; i++) {
      curX += velocities[i].dx;
      curY += velocities[i].dy;
      cumulativeTrajectory.push({ dx: curX, dy: curY });
    }

    const smoothedTrajectory = this.smoothTrajectory(cumulativeTrajectory);

    const stabilizedFrames = [];
    const corrections = [];
    let totalCorrection = 0;
    let maxCorrection = 0;

    for (let i = 0; i < frames.length; i++) {
      const dx = smoothedTrajectory[i].dx - cumulativeTrajectory[i].dx;
      const dy = smoothedTrajectory[i].dy - cumulativeTrajectory[i].dy;
      corrections.push({ dx, dy });

      const dist = Math.sqrt(dx * dx + dy * dy);
      totalCorrection += dist;
      if (dist > maxCorrection) maxCorrection = dist;

      const warped = this.warpFrame(frames[i], width, height, dx, dy);
      stabilizedFrames.push(warped);
    }

    const calcVariance = (arr) => {
      if (arr.length <= 1) return 0;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    };

    const rawDxDiffs = velocities.map((v) => v.dx);
    const rawDyDiffs = velocities.map((v) => v.dy);
    const rawVariance = calcVariance(rawDxDiffs) + calcVariance(rawDyDiffs);

    const smoothedVelocities = [{ dx: 0, dy: 0 }];
    for (let i = 1; i < smoothedTrajectory.length; i++) {
      smoothedVelocities.push({
        dx: smoothedTrajectory[i].dx - smoothedTrajectory[i - 1].dx,
        dy: smoothedTrajectory[i].dy - smoothedTrajectory[i - 1].dy,
      });
    }
    const smoothDxDiffs = smoothedVelocities.map((v) => v.dx);
    const smoothDyDiffs = smoothedVelocities.map((v) => v.dy);
    const smoothedVariance = calcVariance(smoothDxDiffs) + calcVariance(smoothDyDiffs);

    const jitterReductionPercent =
      rawVariance > 0
        ? Math.max(0, ((rawVariance - smoothedVariance) / rawVariance) * 100)
        : 0;

    return {
      stabilizedFrames,
      metrics: {
        rawTrajectoryVariance: parseFloat(rawVariance.toFixed(3)),
        smoothedTrajectoryVariance: parseFloat(smoothedVariance.toFixed(3)),
        jitterReductionPercent: parseFloat(jitterReductionPercent.toFixed(1)),
        averageCorrectionPx: parseFloat((totalCorrection / frames.length).toFixed(2)),
        maxCorrectionPx: parseFloat(maxCorrection.toFixed(2)),
        framesProcessed: frames.length,
      },
    };
  }
}

module.exports = {
  OpticalFlowStabilizer,
};
