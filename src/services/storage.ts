import fs from "fs";
import path from "path";

export interface IStorageService {
  saveUploadedFile(tempPath: string, filename: string): Promise<string>;
  getFilePath(relPath: string): string;
  createJobDirectory(jobId: string): Promise<string>;
  cleanupJobDirectory(jobId: string): Promise<void>;
  fileExists(filePath: string): boolean;
}

export class LocalStorageService implements IStorageService {
  private baseDir: string;
  private uploadDir: string;
  private processedDir: string;
  private jobsDir: string;

  constructor() {
    this.baseDir = path.resolve(process.env.STORAGE_LOCAL_DIR || "./storage_data");
    this.uploadDir = path.join(this.baseDir, "uploads");
    this.processedDir = path.join(this.baseDir, "processed");
    this.jobsDir = path.join(this.baseDir, "jobs");

    this.ensureDirs();
  }

  private ensureDirs() {
    [this.baseDir, this.uploadDir, this.processedDir, this.jobsDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  public async saveUploadedFile(tempPath: string, filename: string): Promise<string> {
    this.ensureDirs();
    const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const destination = path.join(this.uploadDir, safeName);
    try {
      await fs.promises.rename(tempPath, destination);
    } catch (e: any) {
      // Cross-device fallback or lock fallback
      await fs.promises.copyFile(tempPath, destination);
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
    }
    return destination;
  }

  public getFilePath(relPath: string): string {
    return path.resolve(this.baseDir, relPath);
  }

  public async createJobDirectory(jobId: string): Promise<string> {
    const jobPath = path.join(this.jobsDir, jobId);
    const chunksPath = path.join(jobPath, "chunks");
    const audioPath = path.join(jobPath, "audio");

    await fs.promises.mkdir(chunksPath, { recursive: true });
    await fs.promises.mkdir(audioPath, { recursive: true });

    return jobPath;
  }

  public async cleanupJobDirectory(jobId: string): Promise<void> {
    const jobPath = path.join(this.jobsDir, jobId);
    if (fs.existsSync(jobPath)) {
      await fs.promises.rm(jobPath, { recursive: true, force: true });
    }
  }

  public fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  public getProcessedDir(): string {
    return this.processedDir;
  }

  public getUploadDir(): string {
    return this.uploadDir;
  }
}

export const storageService = new LocalStorageService();
