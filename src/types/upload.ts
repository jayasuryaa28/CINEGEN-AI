import { VideoMetadata } from "./index";

export type UploadStatus = "initialized" | "uploading" | "finalizing" | "completed" | "cancelled" | "failed" | "expired";

export interface UploadSession {
  uploadId: string;
  uploadTokenHash: string; // Cryptographic SHA-256 hash; raw plaintext token is never persisted on disk
  filename: string;
  fileSize: number;
  lastModified?: number;
  fingerprint?: string;
  totalChunks: number;
  chunkSize: number;
  uploadedChunks: number[];
  uploadedBytes: number;
  stagingPath: string;
  chunksDir: string; // Atomic per-chunk completion files
  expectedSha256?: string;
  calculatedSha256?: string;
  userId: string;
  status: UploadStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt: string;
  error?: string;
}

export interface UploadInitRequest {
  filename: string;
  fileSize: number;
  lastModified?: number;
  fingerprint?: string;
  chunkSize?: number;
  expectedSha256?: string;
  userId?: string;
}

export interface UploadInitResponse {
  uploadId: string;
  uploadToken: string; // Required for all subsequent chunk/status/complete/cancel calls
  chunkSize: number;
  totalChunks: number;
  status: UploadStatus;
}

export interface UploadChunkResponse {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  uploadedBytes: number;
  progress: number;
  isDuplicate: boolean;
}

export interface UploadStatusResponse {
  uploadId: string;
  filename: string;
  fileSize: number;
  lastModified?: number;
  fingerprint?: string;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  uploadedBytes: number;
  progress: number;
  status: UploadStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UploadCompleteRequest {
  uploadId: string;
  uploadToken?: string;
  clientSha256?: string;
  userId?: string;
}

export interface UploadCompleteResponse {
  success: boolean;
  filePath: string;
  metadata: VideoMetadata;
  sha256: string;
}

export interface UploadCancelResponse {
  cancelled: boolean;
  uploadId: string;
}
