import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { CineFrameSample } from "@/types/cineframe";

export interface CineFrameBatch {
  inputs: tf.Tensor4D; // [N, H, W, 9] (3 temporal RGB frames)
  targets: tf.Tensor4D; // [N, 2H, 2W, 3] (Clean high-resolution target)
}

export class CineFrameDatasetLoader {
  private annotationsPath: string;

  constructor(annotationsPath?: string) {
    this.annotationsPath =
      annotationsPath ||
      path.resolve("./storage_data/dataset/cineframe_annotations.json");
  }

  public loadAnnotations(): CineFrameSample[] {
    if (!fs.existsSync(this.annotationsPath)) {
      throw new Error(`Annotations file not found at: ${this.annotationsPath}`);
    }
    const raw = fs.readFileSync(this.annotationsPath, "utf-8");
    return JSON.parse(raw) as CineFrameSample[];
  }

  public getSplits(): {
    train: CineFrameSample[];
    val: CineFrameSample[];
    test: CineFrameSample[];
  } {
    const all = this.loadAnnotations();
    const train = all.filter((s) => s.split === "train");
    const val = all.filter((s) => s.split === "val");
    const test = all.filter((s) => s.split === "test");

    const trainSources = new Set(train.map((s) => s.sourceId));
    const valSources = new Set(val.map((s) => s.sourceId));
    const testSources = new Set(test.map((s) => s.sourceId));

    for (const s of valSources) {
      if (trainSources.has(s)) {
        throw new Error(`Data leakage: source ${s} in both train and val!`);
      }
    }
    for (const s of testSources) {
      if (trainSources.has(s) || valSources.has(s)) {
        throw new Error(`Data leakage: source ${s} in test and train/val!`);
      }
    }

    return { train, val, test };
  }

  /**
   * Loads 3 degraded frames as a single 9-channel tensor [64, 64, 9]
   */
  public static loadDegradedSequenceTensor(framePaths: [string, string, string]): tf.Tensor3D {
    const buffers: Buffer[] = [];
    for (const p of framePaths) {
      const rgb64 = p.replace(/\.png$/, "_64.rgb");
      if (fs.existsSync(rgb64)) {
        buffers.push(fs.readFileSync(rgb64));
      } else {
        throw new Error(`Missing 64x64 raw RGB frame: ${rgb64}`);
      }
    }

    // Interleave/stack 3 RGB images into 9 channels per pixel [64, 64, 9]
    const pixels = 64 * 64;
    const f32 = new Float32Array(pixels * 9);

    const b0 = buffers[0];
    const b1 = buffers[1];
    const b2 = buffers[2];

    for (let i = 0; i < pixels; i++) {
      const srcIdx = i * 3;
      const dstIdx = i * 9;

      // Frame t-1
      f32[dstIdx] = b0[srcIdx] / 255.0;
      f32[dstIdx + 1] = b0[srcIdx + 1] / 255.0;
      f32[dstIdx + 2] = b0[srcIdx + 2] / 255.0;

      // Frame t
      f32[dstIdx + 3] = b1[srcIdx] / 255.0;
      f32[dstIdx + 4] = b1[srcIdx + 1] / 255.0;
      f32[dstIdx + 5] = b1[srcIdx + 2] / 255.0;

      // Frame t+1
      f32[dstIdx + 6] = b2[srcIdx] / 255.0;
      f32[dstIdx + 7] = b2[srcIdx + 1] / 255.0;
      f32[dstIdx + 8] = b2[srcIdx + 2] / 255.0;
    }

    return tf.tensor3d(f32, [64, 64, 9]);
  }

  /**
   * Loads clean target frame as a 3-channel tensor [128, 128, 3]
   */
  public static loadCleanTargetTensor(framePath: string): tf.Tensor3D {
    const rgb128 = framePath.replace(/\.png$/, ".rgb");
    let buffer: Buffer;

    if (fs.existsSync(rgb128)) {
      buffer = fs.readFileSync(rgb128);
    } else {
      throw new Error(`Missing clean 128x128 target frame: ${rgb128}`);
    }

    const pixels = 128 * 128;
    const f32 = new Float32Array(pixels * 3);
    for (let i = 0; i < buffer.length; i++) {
      f32[i] = buffer[i] / 255.0;
    }

    return tf.tensor3d(f32, [128, 128, 3]);
  }

  public static createBatch(samples: CineFrameSample[]): CineFrameBatch {
    return tf.tidy(() => {
      const inputTensors: tf.Tensor3D[] = [];
      const targetTensors: tf.Tensor3D[] = [];

      for (const s of samples) {
        inputTensors.push(CineFrameDatasetLoader.loadDegradedSequenceTensor(s.degradedFrames));
        targetTensors.push(CineFrameDatasetLoader.loadCleanTargetTensor(s.cleanTargetFrame));
      }

      return {
        inputs: tf.stack(inputTensors) as tf.Tensor4D,
        targets: tf.stack(targetTensors) as tf.Tensor4D,
      };
    });
  }
}
