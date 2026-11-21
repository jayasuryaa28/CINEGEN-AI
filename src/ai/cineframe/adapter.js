const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs");

class TrainedCineFrame {
  constructor(checkpointDir) {
    this.name = "CINEFRAME";
    this.status = "active";
    this.model = null;
    this.checkpointDir =
      checkpointDir ||
      path.resolve(
        process.env.STORAGE_LOCAL_DIR || "./storage_data",
        "checkpoints",
        "cineframe",
        "best"
      );
    this.isWarmedUp = false;
    this.cachedInputBatchSize = 0;
    this.cachedInputBuffer = null;
  }

  async initialize() {
    return this.getOrLoadModel();
  }

  async getOrLoadModel() {
    if (this.model) return this.model;

    const topologyPath = path.join(this.checkpointDir, "model_topology.json");
    const specsPath = path.join(this.checkpointDir, "weight_specs.json");
    const weightsPath = path.join(this.checkpointDir, "weights.bin");

    if (!fs.existsSync(topologyPath) || !fs.existsSync(weightsPath)) {
      throw new Error(`CineFrame trained checkpoint not found at: ${this.checkpointDir}`);
    }

    const modelTopology = JSON.parse(fs.readFileSync(topologyPath, "utf-8"));
    const weightSpecs = JSON.parse(fs.readFileSync(specsPath, "utf-8"));
    const weightBuf = fs.readFileSync(weightsPath);

    const handler = {
      load: async () => ({
        modelTopology,
        weightSpecs,
        weightData: weightBuf.buffer.slice(
          weightBuf.byteOffset,
          weightBuf.byteOffset + weightBuf.byteLength
        ),
      }),
    };

    this.model = await tf.loadLayersModel(handler);
    return this.model;
  }

  /**
   * Pre-warms the model graph to eliminate first-frame compilation latency
   */
  async warmup() {
    if (this.isWarmedUp) return;
    const model = await this.getOrLoadModel();
    tf.tidy(() => {
      const dummyInput = tf.zeros([1, 64, 64, 9]);
      const pred = model.predict(dummyInput);
      pred.dataSync();
    });
    this.isWarmedUp = true;
  }

  /**
   * Reusable Float32Array buffer to avoid GC thrashing across frames
   */
  getInputBuffer(batchSize) {
    const requiredSize = batchSize * 64 * 64 * 9;
    if (!this.cachedInputBuffer || this.cachedInputBuffer.length < requiredSize) {
      this.cachedInputBuffer = new Float32Array(requiredSize);
      this.cachedInputBatchSize = batchSize;
    }
    return this.cachedInputBuffer;
  }

  async enhanceFrame(currBuf, width = 640, height = 360) {
    const enhanced = await this.enhanceFrames([currBuf], width * 2, height * 2, 1);
    return enhanced[0];
  }

  /**
   * Enhances a sequence of video frames using batched inference and zero-copy buffers
   */
  async enhanceFrames(frames, targetWidth = 1280, targetHeight = 720, batchSize = 4) {
    if (frames.length === 0) return [];
    const model = await this.getOrLoadModel();

    if (!this.isWarmedUp) {
      await this.warmup();
    }

    const enhancedFrames = [];
    const totalFrames = frames.length;

    for (let batchStart = 0; batchStart < totalFrames; batchStart += batchSize) {
      const currentBatchSize = Math.min(batchSize, totalFrames - batchStart);
      const f32 = this.getInputBuffer(currentBatchSize);

      for (let b = 0; b < currentBatchSize; b++) {
        const i = batchStart + b;
        const prevIdx = Math.max(0, i - 1);
        const currIdx = i;
        const nextIdx = Math.min(totalFrames - 1, i + 1);

        const prevBuf = frames[prevIdx];
        const currBuf = frames[currIdx];
        const nextBuf = frames[nextIdx];

        const batchOffset = b * 64 * 64 * 9;
        const pixels = 64 * 64;
        const currLen3 = Math.max(1, Math.floor(currBuf.length / 3));

        for (let p = 0; p < pixels; p++) {
          const srcIdx = (p % currLen3) * 3;
          const dstIdx = batchOffset + p * 9;

          f32[dstIdx] = (prevBuf[srcIdx] || 0) / 255.0;
          f32[dstIdx + 1] = (prevBuf[srcIdx + 1] || 0) / 255.0;
          f32[dstIdx + 2] = (prevBuf[srcIdx + 2] || 0) / 255.0;

          f32[dstIdx + 3] = (currBuf[srcIdx] || 0) / 255.0;
          f32[dstIdx + 4] = (currBuf[srcIdx + 1] || 0) / 255.0;
          f32[dstIdx + 5] = (currBuf[srcIdx + 2] || 0) / 255.0;

          f32[dstIdx + 6] = (nextBuf[srcIdx] || 0) / 255.0;
          f32[dstIdx + 7] = (nextBuf[srcIdx + 1] || 0) / 255.0;
          f32[dstIdx + 8] = (nextBuf[srcIdx + 2] || 0) / 255.0;
        }
      }

      // Execute batched forward pass
      const outData = tf.tidy(() => {
        const inputTensor = tf.tensor4d(
          f32.subarray(0, currentBatchSize * 64 * 64 * 9),
          [currentBatchSize, 64, 64, 9]
        );
        const rawPred = model.predict(inputTensor);
        const predTensor = tf.clipByValue(rawPred, 0.0, 1.0);
        return predTensor.dataSync();
      });

      const frameOutElements = 128 * 128 * 3;
      const outWidth = targetWidth || 1280;
      const outHeight = targetHeight || 720;

      for (let b = 0; b < currentBatchSize; b++) {
        const frameOffset = b * frameOutElements;
        const restoredBuf = Buffer.alloc(outWidth * outHeight * 3);

        if (outWidth === 128 && outHeight === 128) {
          for (let j = 0; j < frameOutElements; j++) {
            restoredBuf[j] = Math.min(255, Math.max(0, Math.round(outData[frameOffset + j] * 255)));
          }
        } else {
          for (let y = 0; y < outHeight; y++) {
            const srcY = Math.min(127, Math.floor((y / outHeight) * 128));
            for (let x = 0; x < outWidth; x++) {
              const srcX = Math.min(127, Math.floor((x / outWidth) * 128));
              const srcIdx = frameOffset + (srcY * 128 + srcX) * 3;
              const dstIdx = (y * outWidth + x) * 3;
              restoredBuf[dstIdx] = Math.min(255, Math.max(0, Math.round(outData[srcIdx] * 255)));
              restoredBuf[dstIdx + 1] = Math.min(255, Math.max(0, Math.round(outData[srcIdx + 1] * 255)));
              restoredBuf[dstIdx + 2] = Math.min(255, Math.max(0, Math.round(outData[srcIdx + 2] * 255)));
            }
          }
        }

        enhancedFrames.push(restoredBuf);
      }
    }

    return enhancedFrames;
  }
}

module.exports = {
  TrainedCineFrame,
  CineFrameAdapter: TrainedCineFrame,
};
