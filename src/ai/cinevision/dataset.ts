import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import * as tf from "@tensorflow/tfjs";
import { CineVisionSample } from "@/types/cinevision";

export interface CineVisionBatch {
  inputs: tf.Tensor4D;
  targets: {
    corners: tf.Tensor2D;
    homography: tf.Tensor2D;
    motion: tf.Tensor2D;
    occlusion: tf.Tensor2D;
    quality: tf.Tensor2D;
    occlusionMask: tf.Tensor2D;
  };
}

export class CineVisionDatasetLoader {
  private annotationsPath: string;

  constructor(annotationsPath?: string) {
    this.annotationsPath =
      annotationsPath ||
      path.resolve("./storage_data/dataset/cinevision_annotations.json");
  }

  public loadAnnotations(): CineVisionSample[] {
    if (!fs.existsSync(this.annotationsPath)) {
      throw new Error(`Annotations file not found at: ${this.annotationsPath}`);
    }
    const raw = fs.readFileSync(this.annotationsPath, "utf-8");
    return JSON.parse(raw) as CineVisionSample[];
  }

  public getSplits(): {
    train: CineVisionSample[];
    val: CineVisionSample[];
    test: CineVisionSample[];
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
   * Loads frame and converts to normalized [64, 64, 3] tensor
   */
  public static loadFrameTensor(framePath: string, targetDim = 64): tf.Tensor3D {
    const rgb64Path = framePath.replace(/\.png$/, "_64.rgb");
    const rgb128Path = framePath.replace(/\.png$/, ".rgb");

    if (targetDim === 64 && fs.existsSync(rgb64Path)) {
      const buffer = fs.readFileSync(rgb64Path);
      const f32 = new Float32Array(64 * 64 * 3);
      for (let i = 0; i < f32.length; i++) {
        f32[i] = buffer[i] / 255.0;
      }
      return tf.tensor3d(f32, [64, 64, 3]);
    }

    let buffer: Buffer;
    if (fs.existsSync(rgb128Path)) {
      buffer = fs.readFileSync(rgb128Path);
    } else {
      const res = spawnSync("ffmpeg", [
        "-i",
        framePath,
        "-vf",
        "scale=128:128",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      if (res.status !== 0 || !res.stdout || res.stdout.length !== 128 * 128 * 3) {
        throw new Error(`Failed to decode frame ${framePath}`);
      }
      buffer = res.stdout;
    }

    // Downsample 128x128 to 64x64 or targetDim
    const step = 128 / targetDim;
    const f32 = new Float32Array(targetDim * targetDim * 3);
    let idx = 0;
    for (let y = 0; y < targetDim; y++) {
      for (let x = 0; x < targetDim; x++) {
        const srcIdx = (Math.floor(y * step) * 128 + Math.floor(x * step)) * 3;
        f32[idx++] = buffer[srcIdx] / 255.0;
        f32[idx++] = buffer[srcIdx + 1] / 255.0;
        f32[idx++] = buffer[srcIdx + 2] / 255.0;
      }
    }

    return tf.tensor3d(f32, [targetDim, targetDim, 3]);
  }

  public static createBatch(samples: CineVisionSample[]): CineVisionBatch {
    return tf.tidy(() => {
      const frameTensors: tf.Tensor3D[] = [];
      const cornerArr: number[][] = [];
      const homoArr: number[][] = [];
      const motionArr: number[][] = [];
      const occArr: number[][] = [];
      const qualArr: number[][] = [];
      const maskArr: number[][] = [];

      for (const s of samples) {
        const ft = CineVisionDatasetLoader.loadFrameTensor(s.framePath, 64);
        frameTensors.push(ft);
        cornerArr.push(s.groundTruth.corners);
        homoArr.push(s.groundTruth.homography);
        motionArr.push(s.groundTruth.displacement);
        occArr.push(s.groundTruth.occlusion);
        qualArr.push(s.groundTruth.quality);
        maskArr.push(s.groundTruth.occlusionMask || new Array(64).fill(0));
      }

      const inputs = tf.stack(frameTensors) as tf.Tensor4D;

      return {
        inputs,
        targets: {
          corners: tf.tensor2d(cornerArr, [samples.length, 8]),
          homography: tf.tensor2d(homoArr, [samples.length, 8]),
          motion: tf.tensor2d(motionArr, [samples.length, 2]),
          occlusion: tf.tensor2d(occArr, [samples.length, 2]),
          quality: tf.tensor2d(qualArr, [samples.length, 4]),
          occlusionMask: tf.tensor2d(maskArr, [samples.length, 64]),
        },
      };
    });
  }
}
