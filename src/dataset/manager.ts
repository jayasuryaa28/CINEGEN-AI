import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { ffmpegService } from "@/services/ffmpeg";
import { videoDegradationEngine } from "./videoDegradation";
import { audioDegradationEngine } from "./audioDegradation";
import { datasetValidator } from "./validator";
import { PRESET_DEGRADATION_PROFILES } from "./profiles";
import {
  DatasetManifest,
  DatasetSamplePair,
  DatasetSplit,
  DegradationProfile,
  QualityValidationReport,
} from "@/types/dataset";

export class DatasetManager {
  private baseDir: string;
  private manifestPath: string;

  constructor() {
    this.baseDir = path.resolve(process.env.STORAGE_LOCAL_DIR || "./storage_data", "dataset");
    this.manifestPath = path.join(this.baseDir, "dataset_manifest.json");
    this.ensureDirs();
  }

  private ensureDirs() {
    ["raw_sources", "clean_targets", "degraded_samples"].forEach((sub) => {
      const p = path.join(this.baseDir, sub);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
  }

  /**
   * Loads or initializes the dataset manifest
   */
  public getManifest(): DatasetManifest {
    this.ensureDirs();
    if (fs.existsSync(this.manifestPath)) {
      try {
        const raw = fs.readFileSync(this.manifestPath, "utf-8");
        return JSON.parse(raw);
      } catch (e) {
        console.warn("Could not read manifest, reinitializing:", e);
      }
    }

    const initial: DatasetManifest = {
      manifestVersion: "1.0.0",
      datasetName: "CINEGEN-THEATRE-PAIRED-v1",
      description: "Paired clean and synthetic theatre-degraded video/audio dataset for training from scratch.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      license: "Creative Commons Zero (CC0) / Apache 2.0",
      totalPairs: 0,
      splits: { train: 0, val: 0, test: 0 },
      sources: [],
      samples: [],
    };
    this.saveManifest(initial);
    return initial;
  }

  private saveManifest(manifest: DatasetManifest) {
    manifest.updatedAt = new Date().toISOString();
    manifest.totalPairs = manifest.samples.length;
    manifest.splits = {
      train: manifest.samples.filter((s) => s.split === "train").length,
      val: manifest.samples.filter((s) => s.split === "val").length,
      test: manifest.samples.filter((s) => s.split === "test").length,
    };
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  /**
   * Imports an authorized clean source video and registers it with an assigned split.
   * Dataset split is strictly assigned at the SOURCE level to prevent data leakage.
   */
  public async importSourceVideo(
    sourceFilePath: string,
    license: string = "Public Domain / CC-BY",
    forcedSplit?: DatasetSplit
  ): Promise<{ sourceId: string; split: DatasetSplit; metadata: any }> {
    if (!fs.existsSync(sourceFilePath)) {
      throw new Error(`Source file does not exist: ${sourceFilePath}`);
    }

    const metadata = await ffmpegService.probeVideo(sourceFilePath);
    const sourceId = `src_${uuidv4().substring(0, 8)}`;

    const manifest = this.getManifest();

    // Deterministic split assignment by source if not forced (80% train, 10% val, 10% test)
    let assignedSplit: DatasetSplit = forcedSplit || "train";
    if (!forcedSplit) {
      const sourceCount = manifest.sources.length;
      if (sourceCount % 10 === 8) assignedSplit = "val";
      else if (sourceCount % 10 === 9) assignedSplit = "test";
      else assignedSplit = "train";
    }

    const destFileName = `${sourceId}_clean${path.extname(sourceFilePath)}`;
    const destPath = path.join(this.baseDir, "raw_sources", destFileName);
    await fs.promises.copyFile(sourceFilePath, destPath);

    // Extract clean 48kHz master audio target
    const cleanAudioDest = path.join(this.baseDir, "clean_targets", `${sourceId}_clean.wav`);
    await ffmpegService.extractAudio(destPath, cleanAudioDest);

    manifest.sources.push({
      sourceId,
      filename: path.basename(sourceFilePath),
      duration: metadata.duration,
      assignedSplit,
      license,
    });

    this.saveManifest(manifest);

    return { sourceId, split: assignedSplit, metadata };
  }

  /**
   * Generates a degraded sample paired with the clean source reference.
   */
  public async generateDegradedPair(
    sourceId: string,
    profileOrPresetId: string | DegradationProfile
  ): Promise<DatasetSamplePair> {
    const manifest = this.getManifest();
    const source = manifest.sources.find((s) => s.sourceId === sourceId);
    if (!source) {
      throw new Error(`Source not found in manifest: ${sourceId}`);
    }

    let profile: DegradationProfile;
    if (typeof profileOrPresetId === "string") {
      const found = PRESET_DEGRADATION_PROFILES.find((p) => p.id === profileOrPresetId);
      if (!found) throw new Error(`Unknown preset degradation profile: ${profileOrPresetId}`);
      profile = found;
    } else {
      profile = profileOrPresetId;
    }

    const pairId = `pair_${uuidv4().substring(0, 8)}`;
    const cleanVideoPath = path.join(
      this.baseDir,
      "raw_sources",
      `${sourceId}_clean.mp4`
    );
    const cleanAudioPath = path.join(
      this.baseDir,
      "clean_targets",
      `${sourceId}_clean.wav`
    );

    // Degraded paths
    const degradedVideoPath = path.join(
      this.baseDir,
      "degraded_samples",
      `${pairId}_deg_${profile.id}.mp4`
    );
    const degradedAudioPath = path.join(
      this.baseDir,
      "degraded_samples",
      `${pairId}_deg_${profile.id}.aac`
    );

    // Render synthetic video degradation
    await videoDegradationEngine.renderDegradedVideo(
      cleanVideoPath,
      degradedVideoPath,
      profile.video
    );

    // Render synthetic audio degradation
    await audioDegradationEngine.renderDegradedAudio(
      cleanAudioPath,
      degradedAudioPath,
      profile.audio,
      source.duration
    );

    // Probe resulting files for metadata integrity
    const cleanMeta = await ffmpegService.probeVideo(cleanVideoPath);
    const degMeta = await ffmpegService.probeVideo(degradedVideoPath);

    const pair: DatasetSamplePair = {
      pairId,
      sourceId,
      split: source.assignedSplit,
      license: source.license,
      cleanTarget: {
        sampleId: `${sourceId}_clean`,
        videoPath: cleanVideoPath,
        audioPath: cleanAudioPath,
        width: cleanMeta.width,
        height: cleanMeta.height,
        duration: cleanMeta.duration,
        framerate: cleanMeta.framerate,
        videoCodec: cleanMeta.videoCodec,
        audioCodec: cleanMeta.audioCodec || "pcm_s16le",
      },
      degradedSample: {
        sampleId: `${pairId}_deg`,
        videoPath: degradedVideoPath,
        audioPath: degradedAudioPath,
        width: degMeta.width,
        height: degMeta.height,
        duration: degMeta.duration,
        framerate: degMeta.framerate,
        videoCodec: degMeta.videoCodec,
        audioCodec: "aac",
      },
      degradationProfileApplied: profile,
      createdAt: new Date().toISOString(),
    };

    manifest.samples.push(pair);
    this.saveManifest(manifest);

    return pair;
  }

  /**
   * Run automated validation across all samples in the dataset
   */
  public async validateDataset(): Promise<QualityValidationReport> {
    const manifest = this.getManifest();
    return datasetValidator.validateDataset(manifest.samples);
  }

  /**
   * Export summary statistics
   */
  public getStatistics() {
    const manifest = this.getManifest();
    return {
      name: manifest.datasetName,
      totalPairs: manifest.totalPairs,
      splits: manifest.splits,
      totalSources: manifest.sources.length,
      license: manifest.license,
      profilesUsed: Array.from(new Set(manifest.samples.map((s) => s.degradationProfileApplied.name))),
    };
  }
}

export const datasetManager = new DatasetManager();
