import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { CineFrameModel } from "./model";
import { calculateCineFrameLosses, CineFrameLossWeights } from "./losses";
import { CineFrameDatasetLoader } from "./dataset";
import { CineFrameSample } from "@/types/cineframe";

export interface CineFrameTrainConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  checkpointDir: string;
  lossWeights: CineFrameLossWeights;
}

export interface CineFrameEpochLog {
  epoch: number;
  trainTotalLoss: number;
  trainCharLoss: number;
  trainEdgeLoss: number;
  trainSsimLoss: number;
  valTotalLoss: number;
  valCharLoss: number;
  durationSec: number;
}

export class CineFrameTrainer {
  private config: CineFrameTrainConfig;
  private checkpointDir: string;

  constructor(config?: Partial<CineFrameTrainConfig>) {
    this.config = {
      epochs: config?.epochs || 4,
      batchSize: config?.batchSize || 4,
      learningRate: config?.learningRate || 0.002,
      checkpointDir:
        config?.checkpointDir ||
        path.resolve("./storage_data/checkpoints/cineframe"),
      lossWeights: config?.lossWeights || {
        charbonnier: 1.0,
        edge: 0.3,
        ssim: 0.5,
        temporal: 0.4,
      },
    };
    this.checkpointDir = this.config.checkpointDir;
    ["best", "final"].forEach((sub) => {
      const p = path.join(this.checkpointDir, sub);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
  }

  public static async saveCheckpoint(model: tf.LayersModel, dir: string): Promise<void> {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await model.save(
      tf.io.withSaveHandler(async (artifacts) => {
        fs.writeFileSync(
          path.join(dir, "model_topology.json"),
          JSON.stringify(artifacts.modelTopology, null, 2),
          "utf-8"
        );
        fs.writeFileSync(
          path.join(dir, "weight_specs.json"),
          JSON.stringify(artifacts.weightSpecs, null, 2),
          "utf-8"
        );
        if (artifacts.weightData) {
          const buf = Array.isArray(artifacts.weightData)
            ? Buffer.concat(artifacts.weightData.map((ab) => Buffer.from(ab)))
            : Buffer.from(artifacts.weightData as ArrayBuffer);
          fs.writeFileSync(path.join(dir, "weights.bin"), buf);
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

  public static async loadCheckpoint(dir: string): Promise<tf.LayersModel> {
    const topologyPath = path.join(dir, "model_topology.json");
    const specsPath = path.join(dir, "weight_specs.json");
    const weightsPath = path.join(dir, "weights.bin");

    if (!fs.existsSync(topologyPath) || !fs.existsSync(weightsPath)) {
      throw new Error(`CineFrame checkpoint files not found at: ${dir}`);
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
   * Executes multi-stage training pipeline from randomly initialized weights
   */
  public async train(trainSamples?: CineFrameSample[], valSamples?: CineFrameSample[]): Promise<{
    model: tf.LayersModel;
    logs: CineFrameEpochLog[];
    bestValLoss: number;
  }> {
    console.log("=== INITIATING CINEFRAME TRAINING FROM RANDOM WEIGHTS ===");
    console.log(`Backend: ${tf.getBackend()} (JavaScript CPU)`);

    const loader = new CineFrameDatasetLoader();
    const splits = loader.getSplits();
    const train = trainSamples || splits.train;
    const val = valSamples || splits.val;

    console.log(
      `Dataset Partition: ${train.length} Training Sequences, ${val.length} Validation Sequences`
    );

    console.log("Initializing CINEFRAME architecture (HeNormal / GlorotUniform)...");
    const cf = new CineFrameModel();
    const model = cf.model;
    console.log(`Total Trainable Parameters: ${model.countParams().toLocaleString()}`);

    const optimizer = tf.train.adam(this.config.learningRate);
    const logs: CineFrameEpochLog[] = [];
    let bestValLoss = Infinity;

    for (let epoch = 1; epoch <= this.config.epochs; epoch++) {
      const epochStart = Date.now();
      const shuffled = [...train].sort(() => Math.random() - 0.5);

      let trainTotalSum = 0;
      let trainCharSum = 0;
      let trainEdgeSum = 0;
      let trainSsimSum = 0;
      let batchCount = 0;

      for (let i = 0; i < shuffled.length; i += this.config.batchSize) {
        const batchSamples = shuffled.slice(i, i + this.config.batchSize);
        if (batchSamples.length === 0) continue;

        const batch = CineFrameDatasetLoader.createBatch(batchSamples);

        let bLoss = 0;
        let bChar = 0;
        let bEdge = 0;
        let bSsim = 0;

        const { value: lossVal, grads } = tf.variableGrads(() => {
          const pred = model.predict(batch.inputs) as tf.Tensor4D;
          const losses = calculateCineFrameLosses(
            pred,
            batch.targets,
            undefined,
            undefined,
            this.config.lossWeights
          );
          bLoss = losses.totalLoss.dataSync()[0];
          bChar = losses.charbonnierLoss.dataSync()[0];
          bEdge = losses.edgeLoss.dataSync()[0];
          bSsim = losses.ssimLoss.dataSync()[0];
          return losses.totalLoss;
        });

        optimizer.applyGradients(grads as any);

        trainTotalSum += bLoss;
        trainCharSum += bChar;
        trainEdgeSum += bEdge;
        trainSsimSum += bSsim;
        batchCount++;

        batch.inputs.dispose();
        batch.targets.dispose();
        lossVal.dispose();
        tf.dispose(grads);
      }

      // Validation Pass
      let valTotalSum = 0;
      let valCharSum = 0;
      let valBatchCount = 0;

      for (let i = 0; i < val.length; i += this.config.batchSize) {
        const valBatchSamples = val.slice(i, i + this.config.batchSize);
        if (valBatchSamples.length === 0) continue;

        const valBatch = CineFrameDatasetLoader.createBatch(valBatchSamples);

        tf.tidy(() => {
          const vPred = model.predict(valBatch.inputs) as tf.Tensor4D;
          const vLosses = calculateCineFrameLosses(
            vPred,
            valBatch.targets,
            undefined,
            undefined,
            this.config.lossWeights
          );
          valTotalSum += vLosses.totalLoss.dataSync()[0];
          valCharSum += vLosses.charbonnierLoss.dataSync()[0];
          valBatchCount++;
        });

        valBatch.inputs.dispose();
        valBatch.targets.dispose();
      }

      const avgTrainTotal = trainTotalSum / batchCount;
      const avgTrainChar = trainCharSum / batchCount;
      const avgTrainEdge = trainEdgeSum / batchCount;
      const avgTrainSsim = trainSsimSum / batchCount;
      const avgValTotal = valTotalSum / valBatchCount;
      const avgValChar = valCharSum / valBatchCount;
      const durationSec = parseFloat(((Date.now() - epochStart) / 1000).toFixed(1));

      const logEntry: CineFrameEpochLog = {
        epoch,
        trainTotalLoss: avgTrainTotal,
        trainCharLoss: avgTrainChar,
        trainEdgeLoss: avgTrainEdge,
        trainSsimLoss: avgTrainSsim,
        valTotalLoss: avgValTotal,
        valCharLoss: avgValChar,
        durationSec,
      };
      logs.push(logEntry);

      console.log(
        `[Epoch ${epoch.toString().padStart(2, "0")}/${this.config.epochs}] ` +
          `Train Loss: ${avgTrainTotal.toFixed(4)} (Char: ${avgTrainChar.toFixed(4)}, Edge: ${avgTrainEdge.toFixed(4)}) | ` +
          `Val Loss: ${avgValTotal.toFixed(4)} (Char: ${avgValChar.toFixed(4)}) | ` +
          `${durationSec}s`
      );

      if (avgValTotal < bestValLoss) {
        bestValLoss = avgValTotal;
        await CineFrameTrainer.saveCheckpoint(model, path.join(this.checkpointDir, "best"));
      }
    }

    await CineFrameTrainer.saveCheckpoint(model, path.join(this.checkpointDir, "final"));
    fs.writeFileSync(
      path.join(this.checkpointDir, "training_history.json"),
      JSON.stringify(logs, null, 2),
      "utf-8"
    );

    return { model, logs, bestValLoss };
  }
}
