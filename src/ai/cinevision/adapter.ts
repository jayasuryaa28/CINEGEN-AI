import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { ICineVisionModel } from "@/ai/models";

export class TrainedCineVision implements ICineVisionModel {
  public readonly name = "CINEVISION" as const;
  public readonly status = "active" as const;
  private model: tf.LayersModel | null = null;
  private checkpointDir: string;
  private isWarmedUp = false;
  private cachedInputBuffer: Float32Array | null = null;

  constructor(checkpointDir?: string) {
    this.checkpointDir =
      checkpointDir ||
      path.resolve(
        process.env.STORAGE_LOCAL_DIR || "./storage_data",
        "checkpoints",
        "cinevision",
        "best"
      );
  }

  public async initialize(): Promise<tf.LayersModel> {
    return this.getOrLoadModel();
  }

  private async getOrLoadModel(): Promise<tf.LayersModel> {
    if (this.model) return this.model;

    const topologyPath = path.join(this.checkpointDir, "model_topology.json");
    const specsPath = path.join(this.checkpointDir, "weight_specs.json");
    const weightsPath = path.join(this.checkpointDir, "weights.bin");

    if (!fs.existsSync(topologyPath) || !fs.existsSync(weightsPath)) {
      throw new Error(`CineVision trained checkpoint not found at: ${this.checkpointDir}`);
    }

    const modelTopology = JSON.parse(fs.readFileSync(topologyPath, "utf-8"));
    const weightSpecs = JSON.parse(fs.readFileSync(specsPath, "utf-8"));
    const weightBuf = fs.readFileSync(weightsPath);

    const handler: tf.io.IOHandler = {
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
   * Pre-warms the model graph to eliminate cold-start compilation overhead
   */
  public async warmup(): Promise<void> {
    if (this.isWarmedUp) return;
    const model = await this.getOrLoadModel();
    tf.tidy(() => {
      const dummy = tf.zeros([1, 64, 64, 3]);
      const preds = model.predict(dummy) as tf.Tensor[];
      preds.forEach((p) => p.dataSync());
    });
    this.isWarmedUp = true;
  }

  private getInputBuffer(): Float32Array {
    if (!this.cachedInputBuffer) {
      this.cachedInputBuffer = new Float32Array(64 * 64 * 3);
    }
    return this.cachedInputBuffer;
  }

  public async analyzeFrame(frameBuffer: Buffer): Promise<{
    hasScreenPerspective: boolean;
    corners: [number, number][];
    blurScore: number;
    noiseScore: number;
    flickerScore?: number;
    brightnessShift?: number;
    homography?: number[];
    displacement?: [number, number];
    occlusion?: [number, number];
    occlusionMask?: number[];
  }> {
    const model = await this.getOrLoadModel();

    if (!this.isWarmedUp) {
      await this.warmup();
    }

    const f32 = this.getInputBuffer();

    if (frameBuffer.length >= 128 * 128 * 3) {
      let idx = 0;
      for (let y = 0; y < 128; y += 2) {
        for (let x = 0; x < 128; x += 2) {
          const srcIdx = (y * 128 + x) * 3;
          f32[idx++] = frameBuffer[srcIdx] / 255.0;
          f32[idx++] = frameBuffer[srcIdx + 1] / 255.0;
          f32[idx++] = frameBuffer[srcIdx + 2] / 255.0;
        }
      }
    } else if (frameBuffer.length === 64 * 64 * 3) {
      for (let i = 0; i < f32.length; i++) {
        f32[i] = frameBuffer[i] / 255.0;
      }
    } else {
      for (let i = 0; i < Math.min(frameBuffer.length, f32.length); i++) {
        f32[i] = frameBuffer[i] / 255.0;
      }
    }

    const { cornersRaw, homoRaw, motionRaw, occRaw, qualRaw, maskRaw } = tf.tidy(() => {
      const inputTensor = tf.tensor3d(f32, [64, 64, 3]).expandDims(0);
      const preds = model.predict(inputTensor) as tf.Tensor[];
      const [predCornersT, predHomoT, predMotionT, predOccT, predQualT, predMaskT] = preds;

      return {
        cornersRaw: Array.from(predCornersT.dataSync()),
        homoRaw: Array.from(predHomoT.dataSync()),
        motionRaw: Array.from(predMotionT.dataSync()),
        occRaw: Array.from(predOccT.dataSync()),
        qualRaw: Array.from(predQualT.dataSync()),
        maskRaw: predMaskT ? Array.from(predMaskT.dataSync()) : undefined,
      };
    });

    const corners: [number, number][] = [
      [cornersRaw[0], cornersRaw[1]],
      [cornersRaw[2], cornersRaw[3]],
      [cornersRaw[4], cornersRaw[5]],
      [cornersRaw[6], cornersRaw[7]],
    ];

    const hasScreenPerspective =
      cornersRaw[0] > 0.02 ||
      cornersRaw[1] > 0.02 ||
      cornersRaw[2] < 0.98 ||
      cornersRaw[4] < 0.98;

    return {
      hasScreenPerspective,
      corners,
      blurScore: qualRaw[0],
      noiseScore: qualRaw[1],
      flickerScore: qualRaw[2],
      brightnessShift: qualRaw[3],
      homography: homoRaw,
      displacement: [motionRaw[0], motionRaw[1]],
      occlusion: [occRaw[0], occRaw[1]],
      occlusionMask: maskRaw,
    };
  }
}
