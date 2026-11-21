import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { CineVisionModel } from "./model";
import { calculateCineVisionLosses } from "./losses";
import { CineVisionDatasetLoader } from "./dataset";
import { CineVisionSample } from "@/types/cinevision";

export interface TrainingConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  checkpointDir: string;
  lossWeights: {
    corners: number;
    homography: number;
    motion: number;
    occlusion: number;
    quality: number;
    mask?: number;
  };
}

export interface EpochLog {
  epoch: number;
  trainTotalLoss: number;
  trainCornerLoss: number;
  trainHomoLoss: number;
  trainMotionLoss: number;
  trainOcclusionLoss: number;
  trainQualityLoss: number;
  valTotalLoss: number;
  valCornerLoss: number;
  valHomoLoss: number;
  durationMs: number;
}

export class CineVisionTrainer {
  private config: TrainingConfig;
  private checkpointDir: string;

  constructor(config?: Partial<TrainingConfig>) {
    this.config = {
      epochs: config?.epochs || 15,
      batchSize: config?.batchSize || 8,
      learningRate: config?.learningRate || 0.001,
      checkpointDir:
        config?.checkpointDir ||
        path.resolve("./storage_data/checkpoints/cinevision"),
      lossWeights: config?.lossWeights || {
        corners: 2.0,
        homography: 0.5,
        motion: 1.0,
        occlusion: 1.0,
        quality: 1.0,
        mask: 1.5,
      },
    };
    this.checkpointDir = this.config.checkpointDir;
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * Saves model architecture and weights in a portable TFJS format
   */
  public async saveCheckpoint(
    model: tf.LayersModel,
    targetDir: string = this.checkpointDir
  ): Promise<void> {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    await model.save(
      tf.io.withSaveHandler(async (artifacts) => {
        fs.writeFileSync(
          path.join(targetDir, "model_topology.json"),
          JSON.stringify(artifacts.modelTopology, null, 2),
          "utf-8"
        );
        fs.writeFileSync(
          path.join(targetDir, "weight_specs.json"),
          JSON.stringify(artifacts.weightSpecs, null, 2),
          "utf-8"
        );
        if (artifacts.weightData) {
          const buf = Array.isArray(artifacts.weightData)
            ? Buffer.concat(artifacts.weightData.map((ab) => Buffer.from(ab)))
            : Buffer.from(artifacts.weightData as ArrayBuffer);
          fs.writeFileSync(
            path.join(targetDir, "weights.bin"),
            buf
          );
        }
        return {
          modelArtifactsInfo: {
            dateSaved: new Date(),
            modelTopologyType: "JSON",
          },
        };
      })
    );
  }

  /**
   * Loads saved model architecture and weights from checkpoint directory
   */
  public static async loadCheckpoint(
    targetDir: string
  ): Promise<tf.LayersModel> {
    const topologyPath = path.join(targetDir, "model_topology.json");
    const specsPath = path.join(targetDir, "weight_specs.json");
    const weightsPath = path.join(targetDir, "weights.bin");

    if (!fs.existsSync(topologyPath) || !fs.existsSync(weightsPath)) {
      throw new Error(`Checkpoint files not found at: ${targetDir}`);
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

    return tf.loadLayersModel(handler);
  }

  /**
   * Executes full training loop from randomly initialized weights
   */
  public async train(): Promise<{
    model: tf.LayersModel;
    logs: EpochLog[];
    bestValLoss: number;
  }> {
    console.log("=== INITIATING CINEVISION TRAINING FROM RANDOM WEIGHTS ===");
    console.log(`Backend: ${tf.getBackend()} (JavaScript CPU)`);
    console.log(
      `Hyperparameters: Epochs=${this.config.epochs}, BatchSize=${this.config.batchSize}, LR=${this.config.learningRate}`
    );

    // 1. Load paired dataset
    const loader = new CineVisionDatasetLoader();
    const { train, val } = loader.getSplits();
    console.log(
      `Dataset Partition: ${train.length} Training Frames, ${val.length} Validation Frames`
    );

    // 2. Initialize Model with Random Weights
    console.log("Initializing CINEVISION architecture (HeNormal / GlorotUniform)...");
    const cv = new CineVisionModel([64, 64, 3]);
    const model = cv.model;

    const optimizer = tf.train.adam(this.config.learningRate);
    const logs: EpochLog[] = [];
    let bestValLoss = Infinity;

    // 3. Training Loop
    for (let epoch = 1; epoch <= this.config.epochs; epoch++) {
      const startTime = Date.now();

      // Shuffle training set
      const shuffledTrain = [...train].sort(() => Math.random() - 0.5);

      let epochTotalLoss = 0;
      let epochCornerLoss = 0;
      let epochHomoLoss = 0;
      let epochMotionLoss = 0;
      let epochOccLoss = 0;
      let epochQualLoss = 0;
      let batchCount = 0;

      for (let i = 0; i < shuffledTrain.length; i += this.config.batchSize) {
        const batchSamples = shuffledTrain.slice(i, i + this.config.batchSize);
        if (batchSamples.length === 0) continue;

        // Create batch tensors
        const batch = CineVisionDatasetLoader.createBatch(batchSamples);

        // Compute loss and backpropagation gradients
        const { value: lossVal, grads } = tf.variableGrads(() => {
          const preds = model.predict(batch.inputs) as tf.Tensor[];
          const losses = calculateCineVisionLosses(
            preds,
            batch.targets,
            this.config.lossWeights
          );
          return losses.totalLoss;
        });

        // Apply gradients to trainable weights
        optimizer.applyGradients(grads as any);

        // Compute metric breakdowns for logging
        tf.tidy(() => {
          const preds = model.predict(batch.inputs) as tf.Tensor[];
          const breakdown = calculateCineVisionLosses(
            preds,
            batch.targets,
            this.config.lossWeights
          );

          epochTotalLoss += lossVal.dataSync()[0];
          epochCornerLoss += breakdown.cornerLoss.dataSync()[0];
          epochHomoLoss += breakdown.homoLoss.dataSync()[0];
          epochMotionLoss += breakdown.motionLoss.dataSync()[0];
          epochOccLoss += breakdown.occlusionLoss.dataSync()[0];
          epochQualLoss += breakdown.qualityLoss.dataSync()[0];
          batchCount++;
        });

        // Dispose batch tensors to prevent memory accumulation
        batch.inputs.dispose();
        batch.targets.corners.dispose();
        batch.targets.homography.dispose();
        batch.targets.motion.dispose();
        batch.targets.occlusion.dispose();
        batch.targets.quality.dispose();
        batch.targets.occlusionMask?.dispose();
        lossVal.dispose();
        tf.dispose(grads);
      }

      // 4. Validation Loop
      let valTotalLoss = 0;
      let valCornerLoss = 0;
      let valHomoLoss = 0;
      let valBatchCount = 0;

      for (let i = 0; i < val.length; i += this.config.batchSize) {
        const valBatchSamples = val.slice(i, i + this.config.batchSize);
        if (valBatchSamples.length === 0) continue;

        const valBatch = CineVisionDatasetLoader.createBatch(valBatchSamples);

        tf.tidy(() => {
          const preds = model.predict(valBatch.inputs) as tf.Tensor[];
          const losses = calculateCineVisionLosses(
            preds,
            valBatch.targets,
            this.config.lossWeights
          );
          valTotalLoss += losses.totalLoss.dataSync()[0];
          valCornerLoss += losses.cornerLoss.dataSync()[0];
          valHomoLoss += losses.homoLoss.dataSync()[0];
          valBatchCount++;
        });

        valBatch.inputs.dispose();
        valBatch.targets.corners.dispose();
        valBatch.targets.homography.dispose();
        valBatch.targets.motion.dispose();
        valBatch.targets.occlusion.dispose();
        valBatch.targets.quality.dispose();
        valBatch.targets.occlusionMask?.dispose();
      }

      const avgTrainTotal = epochTotalLoss / batchCount;
      const avgTrainCorner = epochCornerLoss / batchCount;
      const avgTrainHomo = epochHomoLoss / batchCount;
      const avgTrainMotion = epochMotionLoss / batchCount;
      const avgTrainOcc = epochOccLoss / batchCount;
      const avgTrainQual = epochQualLoss / batchCount;

      const avgValTotal = valTotalLoss / valBatchCount;
      const avgValCorner = valCornerLoss / valBatchCount;
      const avgValHomo = valHomoLoss / valBatchCount;

      const durationMs = Date.now() - startTime;

      const logEntry: EpochLog = {
        epoch,
        trainTotalLoss: avgTrainTotal,
        trainCornerLoss: avgTrainCorner,
        trainHomoLoss: avgTrainHomo,
        trainMotionLoss: avgTrainMotion,
        trainOcclusionLoss: avgTrainOcc,
        trainQualityLoss: avgTrainQual,
        valTotalLoss: avgValTotal,
        valCornerLoss: avgValCorner,
        valHomoLoss: avgValHomo,
        durationMs,
      };
      logs.push(logEntry);

      console.log(
        `[Epoch ${epoch.toString().padStart(2, "0")}/${this.config.epochs}] ` +
          `Train Loss: ${avgTrainTotal.toFixed(4)} (Corner: ${avgTrainCorner.toFixed(4)}, Homo: ${avgTrainHomo.toFixed(4)}) | ` +
          `Val Loss: ${avgValTotal.toFixed(4)} (Corner: ${avgValCorner.toFixed(4)}) | ` +
          `${(durationMs / 1000).toFixed(1)}s`
      );

      // Checkpoint best weights
      if (avgValTotal < bestValLoss) {
        bestValLoss = avgValTotal;
        await this.saveCheckpoint(model, path.join(this.checkpointDir, "best"));
      }
    }

    // Save final checkpoint
    await this.saveCheckpoint(model, path.join(this.checkpointDir, "final"));

    // Save training log manifest
    fs.writeFileSync(
      path.join(this.checkpointDir, "training_history.json"),
      JSON.stringify(logs, null, 2),
      "utf-8"
    );

    console.log(
      `\n✓ Training Completed! Best Val Loss: ${bestValLoss.toFixed(4)}. Checkpoints saved to: ${this.checkpointDir}`
    );

    return { model, logs, bestValLoss };
  }
}
