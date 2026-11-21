/**
 * CINEGEN AI — Core Domain Types
 */

export type OutputQuality = "720p" | "1080p" | "1440p" | "4K";

export interface VideoMetadata {
  filename: string;
  filesize: number; // in bytes
  format: string; // e.g. "mp4", "mov", "mkv"
  duration: number; // in seconds
  durationFormatted: string; // e.g. "01:45:22"
  width: number;
  height: number;
  framerate: number;
  videoCodec: string;
  audioCodec: string | null;
  hasAudio: boolean;
  bitrate: number;
}

export type JobStatus =
  | "queued"
  | "validating"
  | "extracting_audio"
  | "segmenting_chunks"
  | "processing_audio"
  | "processing_video"
  | "merging_chunks"
  | "multiplexing"
  | "completed"
  | "failed"
  | "paused";

export interface ProcessingJob {
  id: string;
  originalFilename: string;
  inputFilePath: string;
  outputQuality: OutputQuality;
  targetResolution: { width: number; height: number };
  metadata: VideoMetadata;
  status: JobStatus;
  progress: number; // 0 - 100
  currentStage: string;
  chunksTotal: number;
  chunksCompleted: number;
  completedChunkIndices?: number[];
  extractedAudioPath?: string;
  processedAudioPath?: string;
  outputVideoPath?: string;
  error?: string;
  syncReport?: any;
  hasFallbackStream?: boolean;
  computeProviderUsed?: string;
  metrics?: {
    executionTimeMs?: number;
    peakMemoryMB?: number;
    averageChunkTimeMs?: number;
    provider?: string;
  };
  aiModulesStatus: {
    cinevision: "placeholder" | "active";
    cineframe: "placeholder" | "active";
    noisenet: "placeholder" | "active";
    stemnet: "placeholder" | "active";
    echonet: "placeholder" | "active";
    voicenet: "placeholder" | "active";
    cinesync: "placeholder" | "active";
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ChunkMetadata {
  index: number;
  startTime: number; // seconds
  duration: number; // seconds
  inputSegmentPath: string;
  outputSegmentPath: string;
  status: "pending" | "processing" | "completed" | "failed";
}

export * from "./upload";

