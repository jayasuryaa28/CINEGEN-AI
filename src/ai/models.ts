/**
 * CINEGEN AI — AI Model Contracts & Placeholder Adapters
 *
 * In Phase 1, these interfaces establish the contracts for the 7 original models.
 * Neural network weights and GPU execution are intentionally segregated so they
 * can be plugged in during Phase 2/3 without altering the orchestration layer.
 */

export interface ICineVisionModel {
  name: "CINEVISION";
  status: "placeholder" | "active";
  analyzeFrame(frameBuffer: Buffer): Promise<{
    hasScreenPerspective: boolean;
    corners: [number, number][];
    blurScore: number;
    noiseScore: number;
  }>;
}

export interface ICineFrameModel {
  name: "CINEFRAME";
  status: "placeholder" | "active";
  enhanceFrames(frames: Buffer[], targetWidth: number, targetHeight: number): Promise<Buffer[]>;
}

export interface INoiseNetModel {
  name: "NOISENET";
  status: "placeholder" | "active";
  suppressNoise(audioBuffer: Buffer): Promise<Buffer>;
}

export interface IStemNetModel {
  name: "STEMNET";
  status: "placeholder" | "active";
  separateStems(audioBuffer: Buffer): Promise<{
    dialogue: Buffer;
    music: Buffer;
    effects: Buffer;
  }>;
}

export interface IEchoNetModel {
  name: "ECHONET";
  status: "placeholder" | "active";
  dereverberate(audioBuffer: Buffer): Promise<Buffer>;
}

export interface IVoiceNetModel {
  name: "VOICENET";
  status: "placeholder" | "active";
  enhanceSpeech(dialogueBuffer: Buffer): Promise<Buffer>;
}

export interface ICineSyncModel {
  name: "CINESYNC";
  status: "placeholder" | "active";
  calculateOffset(videoFrames: Buffer[], audioBuffer: Buffer): Promise<number>; // offset in ms
}

import { TrainedCineVision } from "./cinevision/adapter";
import { TrainedCineFrame } from "./cineframe/adapter";
import {
  TrainedNoiseNet,
  TrainedStemNet,
  TrainedEchoNet,
  TrainedVoiceNet,
} from "./audio/adapter";
import { TrainedCineSync } from "./cinesync/adapter";

// -------------------------------------------------------------
// Modular Model Adapters (Production Foundation)
// -------------------------------------------------------------

export {
  TrainedCineVision,
  TrainedCineFrame,
  TrainedNoiseNet,
  TrainedStemNet,
  TrainedEchoNet,
  TrainedVoiceNet,
  TrainedCineSync,
};

export class PlaceholderCineVision implements ICineVisionModel {
  public readonly name = "CINEVISION";
  public readonly status = "placeholder" as const;

  async analyzeFrame(_frameBuffer: Buffer) {
    return {
      hasScreenPerspective: false,
      corners: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as [number, number][],
      blurScore: 0.1,
      noiseScore: 0.1,
    };
  }
}

export class PlaceholderCineFrame implements ICineFrameModel {
  public readonly name = "CINEFRAME";
  public readonly status = "placeholder" as const;

  async enhanceFrames(frames: Buffer[], _targetWidth: number, _targetHeight: number) {
    // Placeholder preserves frames while model is in training
    return frames;
  }
}

export class PlaceholderNoiseNet implements INoiseNetModel {
  public readonly name = "NOISENET";
  public readonly status = "placeholder" as const;

  async suppressNoise(audioBuffer: Buffer) {
    return audioBuffer;
  }
}

export class PlaceholderStemNet implements IStemNetModel {
  public readonly name = "STEMNET";
  public readonly status = "placeholder" as const;

  async separateStems(audioBuffer: Buffer) {
    return {
      dialogue: audioBuffer,
      music: Buffer.alloc(0),
      effects: Buffer.alloc(0),
    };
  }
}

export class PlaceholderEchoNet implements IEchoNetModel {
  public readonly name = "ECHONET";
  public readonly status = "placeholder" as const;

  async dereverberate(audioBuffer: Buffer) {
    return audioBuffer;
  }
}

export class PlaceholderVoiceNet implements IVoiceNetModel {
  public readonly name = "VOICENET";
  public readonly status = "placeholder" as const;

  async enhanceSpeech(dialogueBuffer: Buffer) {
    return dialogueBuffer;
  }
}

export class PlaceholderCineSync implements ICineSyncModel {
  public readonly name = "CINESYNC";
  public readonly status = "placeholder" as const;

  async calculateOffset(_videoFrames: Buffer[], _audioBuffer: Buffer) {
    return 0; // Synchronized
  }
}

export const aiRegistry = {
  cinevision: new TrainedCineVision(),
  cineframe: new TrainedCineFrame(),
  noisenet: new TrainedNoiseNet(),
  stemnet: new TrainedStemNet(),
  echonet: new TrainedEchoNet(),
  voicenet: new TrainedVoiceNet(),
  cinesync: new TrainedCineSync(),
};
