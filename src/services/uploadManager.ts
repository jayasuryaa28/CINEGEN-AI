import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { storageService } from "./storage";
import { ffmpegService } from "./ffmpeg";
import {
  UploadSession,
  UploadInitRequest,
  UploadInitResponse,
  UploadChunkResponse,
  UploadStatusResponse,
  UploadCompleteResponse,
  UploadCancelResponse,
  VideoMetadata,
} from "@/types";

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".mkv"];
const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const MIN_CHUNK_SIZE = 64 * 1024; // 64 KB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024 * 1024; // 50 GB
const MAX_DURATION_SECONDS = 4 * 60 * 60; // 4 hours (14,400s)
const DISK_SAFETY_BUFFER_BYTES = 100 * 1024 * 1024; // 100 MB buffer

/**
 * CINEGEN AI — Upload Infrastructure Manager (Phase 13.1.3 Fully Hardened)
 *
 * Hardening Specs:
 * 1. Lifecycle Lock: Prevents completion vs cleanup vs cancellation race conditions.
 * 2. Finalizing State: Protects multi-gigabyte checksum verification and media probing.
 * 3. Completed Metadata Retention: Configurable retention period with active job guards.
 * 4. Resource Exhaustion Guards: Global concurrency limits, chunk payload bounds, and IP rate limiting.
 * 5. Strict Topology Enforcement: Rejects unsupported clustered or serverless deployments at boot.
 */
export class UploadManager {
  private baseDir: string;
  private stagingDir: string;
  private sessionsDir: string;

  // Concurrency and write tracking per upload
  private activeChunkLocks = new Set<string>(); // key: `${uploadId}:${chunkIndex}`
  private activeUploadWrites = new Map<string, number>(); // key: uploadId -> count of active write streams
  private activeWriteStreams = new Map<string, Set<fs.WriteStream>>(); // key: uploadId -> active fs.WriteStream instances
  private simulatedFreeDiskBytes: number | null = null; // Internal test hook for safe capacity testing

  // Phase 13.1.2/13.1.3: Disk Reservation Ledger & Lifecycle Mutexes
  private activeReservations = new Map<string, number>(); // key: uploadId -> reserved unwritten bytes
  private initMutex: Promise<void> = Promise.resolve();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastAutoCleanupTime = 0;

  // Phase 13.1.3: Per-Session Lifecycle Lock & Global Limits
  private activeLifecycleLocks = new Set<string>(); // key: uploadId (for complete, cancel, cleanup)
  private globalActiveWriteStreams = 0;
  private ipRateLimiter = new Map<string, { count: number; resetTime: number }>();

  // Configurable limits
  public maxActiveSessions: number;
  public maxConcurrentChunkWrites: number;
  public maxChunkSize: number;
  public maxInitPerMinutePerIp: number;
  public completedSessionRetentionMs: number;
  public maxRateLimitEntries: number;

  constructor() {
    this.baseDir = storageService.getUploadDir();
    this.stagingDir = path.join(this.baseDir, ".staging");
    this.sessionsDir = path.join(this.baseDir, ".sessions");

    this.maxActiveSessions = parseInt(process.env.MAX_ACTIVE_SESSIONS || "100", 10);
    this.maxConcurrentChunkWrites = parseInt(process.env.MAX_CONCURRENT_CHUNK_WRITES || "50", 10);
    this.maxChunkSize = parseInt(process.env.MAX_CHUNK_SIZE || (100 * 1024 * 1024).toString(), 10); // 100 MB
    this.maxInitPerMinutePerIp = parseInt(process.env.MAX_INIT_PER_MINUTE_PER_IP || "20", 10);
    this.completedSessionRetentionMs = parseInt(
      process.env.COMPLETED_SESSION_RETENTION_MS || (7 * 24 * 60 * 60 * 1000).toString(),
      10
    ); // 7 days
    this.maxRateLimitEntries = parseInt(process.env.MAX_RATE_LIMIT_ENTRIES || "10000", 10);

    this.ensureDirs();
    this.verifyDeploymentTopology();
    this.recoverInterruptedFinalizingSessions();
    this.restoreReservationsFromDisk();

    // Start background cleanup sweeper every 10 minutes (unref so it does not block process exit)
    this.cleanupInterval = setInterval(() => {
      this.cleanupAbandoned().catch(() => {});
    }, 10 * 60 * 1000);
    if (this.cleanupInterval && typeof (this.cleanupInterval as any).unref === "function") {
      (this.cleanupInterval as any).unref();
    }
  }

  public stopBackgroundSweeper(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  public recoverInterruptedFinalizingSessions(): void {
    this.ensureDirs();
    try {
      const files = fs.readdirSync(this.sessionsDir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const fullPath = path.join(this.sessionsDir, f);
        try {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const session: UploadSession = JSON.parse(raw);
          if (session.status === "finalizing") {
            // Guard: Never alter sessions referenced by active processing jobs
            if (this.isReferencedByActiveJob(session.uploadId, session.filename)) {
              continue;
            }
            session.status = "failed";
            session.error = "Upload finalization was interrupted by unexpected server restart. Please re-upload.";
            session.updatedAt = new Date().toISOString();
            fs.writeFileSync(fullPath, JSON.stringify(session, null, 2), "utf-8");
          }
        } catch {}
      }
    } catch {}
  }

  public verifyDeploymentTopology(): void {
    const allowUnsupported = process.env.ALLOW_UNSUPPORTED_TOPOLOGY === "true";
    if (allowUnsupported) {
      console.warn(
        "[UploadManager WARNING]: ALLOW_UNSUPPORTED_TOPOLOGY=true is set. Bypassing deployment topology checks."
      );
      return;
    }

    // 1. Strict failure for multi-instance cluster deployment
    if (process.env.NODE_APP_INSTANCE && parseInt(process.env.NODE_APP_INSTANCE, 10) > 0) {
      throw new Error(
        "FATAL: Unsupported deployment topology detected: multi-instance cluster worker (NODE_APP_INSTANCE > 0). " +
          "CINEGEN AI upload architecture strictly requires a single stateful Node.js process. " +
          "Clustering breaks in-memory chunk mutexes and reservation ledgers. " +
          "Run in single-process mode or explicitly set ALLOW_UNSUPPORTED_TOPOLOGY=true if intentional."
      );
    }

    // 2. Strict failure for serverless environments
    if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) {
      throw new Error(
        "FATAL: Unsupported deployment topology detected: serverless execution environment (AWS Lambda / Vercel). " +
          "CINEGEN AI requires persistent local filesystem storage and a stateful single-process Node.js runtime. " +
          "Serverless execution is not supported. Set ALLOW_UNSUPPORTED_TOPOLOGY=true only if intentional."
      );
    }

    // 3. Configuration check for explicit mode
    if (
      process.env.CINEGEN_DEPLOYMENT_MODE &&
      process.env.CINEGEN_DEPLOYMENT_MODE !== "single-process-local"
    ) {
      throw new Error(
        `FATAL: Unsupported CINEGEN_DEPLOYMENT_MODE: '${process.env.CINEGEN_DEPLOYMENT_MODE}'. Supported mode: 'single-process-local'.`
      );
    }
  }

  public acquireLifecycleLock(uploadId: string): boolean {
    if (this.activeLifecycleLocks.has(uploadId)) {
      return false;
    }
    this.activeLifecycleLocks.add(uploadId);
    return true;
  }

  public releaseLifecycleLock(uploadId: string): void {
    this.activeLifecycleLocks.delete(uploadId);
  }

  public isLifecycleLocked(uploadId: string): boolean {
    return this.activeLifecycleLocks.has(uploadId);
  }

  public pruneIpRateLimiter(now: number = Date.now(), maxEntries: number = this.maxRateLimitEntries): void {
    // 1. Remove entries whose 1-minute window has expired
    for (const [ip, record] of this.ipRateLimiter.entries()) {
      if (now > record.resetTime) {
        this.ipRateLimiter.delete(ip);
      }
    }

    // 2. If still exceeding maxEntries, evict oldest entries by resetTime
    if (this.ipRateLimiter.size > maxEntries) {
      const sorted = Array.from(this.ipRateLimiter.entries()).sort(
        (a, b) => a[1].resetTime - b[1].resetTime
      );
      const excess = this.ipRateLimiter.size - maxEntries;
      for (let i = 0; i < excess; i++) {
        this.ipRateLimiter.delete(sorted[i][0]);
      }
    }
  }

  public checkIpRateLimit(clientIp: string): boolean {
    const now = Date.now();

    // Trigger cleanup when approaching capacity or probabilistically
    if (this.ipRateLimiter.size >= this.maxRateLimitEntries * 0.8 || Math.random() < 0.05) {
      this.pruneIpRateLimiter(now);
    }

    const record = this.ipRateLimiter.get(clientIp);
    if (!record || now > record.resetTime) {
      if (this.ipRateLimiter.size >= this.maxRateLimitEntries) {
        this.pruneIpRateLimiter(now, Math.max(0, this.maxRateLimitEntries - 1));
      }
      this.ipRateLimiter.set(clientIp, { count: 1, resetTime: now + 60000 });
      return true;
    }
    if (record.count >= this.maxInitPerMinutePerIp) {
      return false;
    }
    record.count++;
    return true;
  }

  public setSimulatedFreeDiskBytes(bytes: number | null): void {
    this.simulatedFreeDiskBytes = bytes;
  }

  public getActiveReservedBytes(): number {
    let total = 0;
    for (const bytes of this.activeReservations.values()) {
      total += bytes;
    }
    return total;
  }

  public getReservation(uploadId: string): number {
    return this.activeReservations.get(uploadId) || 0;
  }

  public releaseReservation(uploadId: string): void {
    this.activeReservations.delete(uploadId);
  }

  private updateReservation(uploadId: string, remainingBytes: number): void {
    if (remainingBytes <= 0) {
      this.activeReservations.delete(uploadId);
    } else {
      this.activeReservations.set(uploadId, remainingBytes);
    }
  }

  public restoreReservationsFromDisk(): void {
    this.ensureDirs();
    try {
      const files = fs.readdirSync(this.sessionsDir);
      const now = Date.now();
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const raw = fs.readFileSync(path.join(this.sessionsDir, f), "utf-8");
          const session: UploadSession = JSON.parse(raw);
          if (session.status === "initialized" || session.status === "uploading" || session.status === "finalizing") {
            const expTime = session.expiresAt ? new Date(session.expiresAt).getTime() : 0;
            if (expTime > now) {
              let uploadedBytes = session.uploadedBytes || 0;
              if (session.chunksDir && fs.existsSync(session.chunksDir)) {
                const doneFiles = fs.readdirSync(session.chunksDir).filter((df) => df.endsWith(".done"));
                uploadedBytes = doneFiles.reduce((acc, df) => {
                  const idx = parseInt(df.replace(".done", ""), 10);
                  const isLast = idx === session.totalChunks - 1;
                  const size = isLast
                    ? session.fileSize - (session.totalChunks - 1) * session.chunkSize
                    : session.chunkSize;
                  return acc + size;
                }, 0);
              }
              const remaining = Math.max(0, session.fileSize - uploadedBytes);
              if (remaining > 0) {
                this.activeReservations.set(session.uploadId, remaining);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  private async runInitExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.initMutex;
    this.initMutex = next;
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  public getAvailableDiskBytes(targetDir: string): number {
    if (this.simulatedFreeDiskBytes !== null) {
      return this.simulatedFreeDiskBytes;
    }
    try {
      const stats = fs.statfsSync(targetDir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  private ensureDirs() {
    [this.baseDir, this.stagingDir, this.sessionsDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  public getSessionPath(uploadId: string): string {
    return path.join(this.sessionsDir, `${uploadId}.json`);
  }

  public async loadSession(uploadId: string): Promise<UploadSession> {
    const sessionPath = this.getSessionPath(uploadId);
    if (!fs.existsSync(sessionPath)) {
      throw new Error(`Upload session '${uploadId}' not found.`);
    }
    const raw = await fs.promises.readFile(sessionPath, "utf-8");
    const session: UploadSession = JSON.parse(raw);

    // Refresh uploaded chunks from atomic per-chunk completion files
    session.uploadedChunks = await this.getAtomicUploadedChunks(session.chunksDir);
    session.uploadedBytes = session.uploadedChunks.reduce((acc, idx) => {
      const isLast = idx === session.totalChunks - 1;
      const size = isLast
        ? session.fileSize - (session.totalChunks - 1) * session.chunkSize
        : session.chunkSize;
      return acc + size;
    }, 0);

    // Enforce expiresAt inside every session access
    if (session.status !== "completed" && session.status !== "cancelled") {
      const expTime = session.expiresAt ? new Date(session.expiresAt).getTime() : 0;
      if (expTime > 0 && Date.now() > expTime) {
        session.status = "expired";
        this.releaseReservation(session.uploadId);
        await this.saveSession(session).catch(() => {});
        throw new Error(`Upload session '${uploadId}' has expired.`);
      }
    }

    return session;
  }

  private async saveSession(session: UploadSession): Promise<void> {
    const sessionPath = this.getSessionPath(session.uploadId);
    await fs.promises.writeFile(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  }

  public async getAtomicUploadedChunks(chunksDir: string): Promise<number[]> {
    if (!fs.existsSync(chunksDir)) return [];
    try {
      const files = await fs.promises.readdir(chunksDir);
      return files
        .filter((f) => f.endsWith(".done"))
        .map((f) => parseInt(f.replace(".done", ""), 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  private async markChunkDone(chunksDir: string, chunkIndex: number): Promise<void> {
    if (!fs.existsSync(chunksDir)) {
      await fs.promises.mkdir(chunksDir, { recursive: true });
    }
    const chunkDoneFile = path.join(chunksDir, `${chunkIndex}.done`);
    await fs.promises.writeFile(chunkDoneFile, "", "utf-8");
  }

  public validateToken(session: UploadSession, providedToken?: string): void {
    if (!providedToken) {
      throw new Error("Unauthorized: missing uploadToken. Every upload operation requires a valid session token.");
    }

    try {
      const bufExpected = Buffer.from(session.uploadTokenHash, "hex");
      const bufProvided = crypto.createHash("sha256").update(providedToken).digest();

      if (
        bufExpected.length === 0 ||
        bufExpected.length !== bufProvided.length ||
        !crypto.timingSafeEqual(bufExpected, bufProvided)
      ) {
        throw new Error("Unauthorized: invalid uploadToken for this upload session.");
      }
    } catch (err: any) {
      if (err.message && err.message.startsWith("Unauthorized:")) throw err;
      throw new Error("Unauthorized: malformed uploadToken.");
    }
  }

  public async initSession(req: UploadInitRequest): Promise<UploadInitResponse> {
    this.ensureDirs();

    // Trigger opportunistic auto-cleanup if > 60s has passed
    if (Date.now() - this.lastAutoCleanupTime > 60000) {
      this.lastAutoCleanupTime = Date.now();
      this.cleanupAbandoned().catch(() => {});
    }

    const { filename, fileSize } = req;
    if (!filename || typeof filename !== "string") {
      throw new Error("Invalid filename provided.");
    }
    if (!fileSize || typeof fileSize !== "number" || fileSize <= 0) {
      throw new Error("Invalid file size provided. File size must be greater than 0.");
    }
    if (fileSize > MAX_TOTAL_SIZE) {
      throw new Error(
        `File size (${(fileSize / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds maximum allowed limit of 50 GB.`
      );
    }

    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file format '${ext}'. Supported formats: MP4, MOV, MKV.`);
    }

    // Resource Protection: Active session limit check
    if (this.activeReservations.size >= this.maxActiveSessions) {
      throw new Error(
        `Server busy: maximum active upload sessions limit reached (${this.maxActiveSessions}). Please try again later.`
      );
    }

    let chunkSize = req.chunkSize || DEFAULT_CHUNK_SIZE;
    if (chunkSize < MIN_CHUNK_SIZE) chunkSize = MIN_CHUNK_SIZE;
    if (chunkSize > this.maxChunkSize) chunkSize = this.maxChunkSize;

    const totalChunks = Math.ceil(fileSize / chunkSize);
    const uploadId = uuidv4();
    const uploadToken = crypto.randomBytes(32).toString("hex");
    const uploadTokenHash = crypto.createHash("sha256").update(uploadToken).digest("hex");

    const sanitizedName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stagingPath = path.join(this.stagingDir, `upload_${uploadId}${ext}.part`);
    const chunksDir = path.join(this.sessionsDir, `${uploadId}_chunks`);
    const userId = req.userId || "local-user";

    // Atomically evaluate active session limit & disk capacity considering current active reservations
    await this.runInitExclusive(async () => {
      if (this.activeReservations.size >= this.maxActiveSessions) {
        throw new Error(
          `Server busy: maximum active upload sessions limit reached (${this.maxActiveSessions}). Please try again later.`
        );
      }

      const physicalAvailable = this.getAvailableDiskBytes(this.stagingDir);
      const currentReserved = this.getActiveReservedBytes();
      const effectiveAvailable = physicalAvailable - currentReserved;
      const requiredBytes = fileSize + DISK_SAFETY_BUFFER_BYTES;

      if (effectiveAvailable < requiredBytes) {
        const effGB = (effectiveAvailable / (1024 * 1024 * 1024)).toFixed(2);
        const reqGB = (fileSize / (1024 * 1024 * 1024)).toFixed(2);
        throw new Error(
          `Insufficient physical disk capacity (active reservations considered): ${effGB} GB effective available, but ${reqGB} GB required.`
        );
      }

      this.activeReservations.set(uploadId, fileSize);
    });

    await fs.promises.mkdir(chunksDir, { recursive: true });

    // Pre-allocate staging file on disk with safe rollback on allocation failure
    try {
      const handle = await fs.promises.open(stagingPath, "w+");
      try {
        await handle.truncate(fileSize);
      } finally {
        await handle.close();
      }
    } catch (allocErr) {
      this.releaseReservation(uploadId);
      throw allocErr;
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const session: UploadSession = {
      uploadId,
      uploadTokenHash,
      filename: sanitizedName,
      fileSize,
      lastModified: req.lastModified,
      fingerprint: req.fingerprint,
      totalChunks,
      chunkSize,
      uploadedChunks: [],
      uploadedBytes: 0,
      stagingPath,
      chunksDir,
      expectedSha256: req.expectedSha256,
      userId,
      status: "initialized",
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    try {
      await this.saveSession(session);
    } catch (saveErr) {
      this.releaseReservation(uploadId);
      await fs.promises.unlink(stagingPath).catch(() => {});
      throw saveErr;
    }

    return {
      uploadId,
      uploadToken,
      chunkSize,
      totalChunks,
      status: "initialized",
    };
  }

  public async getSessionStatus(
    uploadId: string,
    uploadToken?: string,
    validationParams?: { filename?: string; fileSize?: number; lastModified?: number; fingerprint?: string }
  ): Promise<UploadStatusResponse> {
    const session = await this.loadSession(uploadId);
    this.validateToken(session, uploadToken);

    if (validationParams) {
      if (validationParams.fileSize !== undefined && validationParams.fileSize !== session.fileSize) {
        throw new Error(
          `Resume file identity mismatch: expected file size ${session.fileSize} bytes, but provided file is ${validationParams.fileSize} bytes.`
        );
      }
      if (
        session.lastModified !== undefined &&
        validationParams.lastModified !== undefined &&
        session.lastModified !== validationParams.lastModified
      ) {
        throw new Error("Resume file identity mismatch: file lastModified timestamp has changed since initial upload.");
      }
      if (
        session.fingerprint !== undefined &&
        validationParams.fingerprint !== undefined &&
        session.fingerprint !== validationParams.fingerprint
      ) {
        throw new Error("Resume file identity mismatch: lightweight file fingerprint does not match initial upload.");
      }
    }

    const progress =
      session.totalChunks > 0
        ? Math.round((session.uploadedChunks.length / session.totalChunks) * 100)
        : 0;

    return {
      uploadId: session.uploadId,
      filename: session.filename,
      fileSize: session.fileSize,
      lastModified: session.lastModified,
      fingerprint: session.fingerprint,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedChunks: session.uploadedChunks,
      uploadedBytes: session.uploadedBytes,
      progress,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  public async writeChunk(
    uploadId: string,
    chunkIndex: number,
    stream: NodeJS.ReadableStream | ReadableStream<Uint8Array> | Buffer,
    reportedLength?: number,
    uploadToken?: string
  ): Promise<UploadChunkResponse> {
    const session = await this.loadSession(uploadId);
    this.validateToken(session, uploadToken);

    if (session.status === "completed") {
      throw new Error("Cannot write chunk to a completed upload.");
    }
    if (session.status === "cancelled") {
      throw new Error("Cannot write chunk to a cancelled upload.");
    }
    if (session.status === "expired") {
      throw new Error("Upload session has expired.");
    }
    if (session.status === "finalizing") {
      throw new Error("Upload session is currently finalizing. Further writes are prohibited.");
    }

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new Error(
        `Invalid chunk index ${chunkIndex}. Expected integer between 0 and ${session.totalChunks - 1}.`
      );
    }

    const offset = chunkIndex * session.chunkSize;
    const isLastChunk = chunkIndex === session.totalChunks - 1;
    const expectedChunkSize = isLastChunk
      ? session.fileSize - (session.totalChunks - 1) * session.chunkSize
      : session.chunkSize;

    // Resource Protection: Payload size bounds check
    if (reportedLength !== undefined) {
      if (reportedLength > this.maxChunkSize) {
        throw new Error(
          `Payload Too Large: chunk payload length (${reportedLength}) exceeds maximum allowed limit (${this.maxChunkSize}).`
        );
      }
      if (reportedLength > expectedChunkSize) {
        throw new Error(
          `Chunk payload length (${reportedLength}) exceeds expected size (${expectedChunkSize}).`
        );
      }
    }

    // Resource Protection: Global concurrent chunk writes guard
    if (this.globalActiveWriteStreams >= this.maxConcurrentChunkWrites) {
      throw new Error(
        `Server busy: maximum server-wide concurrent chunk writes exceeded (${this.maxConcurrentChunkWrites}). Please retry shortly.`
      );
    }
    this.globalActiveWriteStreams++;

    const chunkLockKey = `${uploadId}:${chunkIndex}`;
    while (this.activeChunkLocks.has(chunkLockKey)) {
      await new Promise((r) => setTimeout(r, 20));
    }
    this.activeChunkLocks.add(chunkLockKey);

    const activeCount = (this.activeUploadWrites.get(uploadId) || 0) + 1;
    this.activeUploadWrites.set(uploadId, activeCount);

    let nodeReadable: NodeJS.ReadableStream;
    if (Buffer.isBuffer(stream)) {
      nodeReadable = Readable.from([stream]);
    } else if (stream && typeof (stream as any).getReader === "function") {
      nodeReadable = Readable.fromWeb(stream as any);
    } else {
      nodeReadable = stream as NodeJS.ReadableStream;
    }

    let fileWriteStream: fs.WriteStream | null = null;
    let isDuplicate = false;

    try {
      isDuplicate = session.uploadedChunks.includes(chunkIndex);

      fileWriteStream = fs.createWriteStream(session.stagingPath, {
        flags: "r+",
        start: offset,
      });

      if (!this.activeWriteStreams.has(uploadId)) {
        this.activeWriteStreams.set(uploadId, new Set());
      }
      this.activeWriteStreams.get(uploadId)!.add(fileWriteStream);

      let bytesWritten = 0;
      nodeReadable.on("data", (chunk: Buffer | Uint8Array) => {
        bytesWritten += chunk.length;
        if (bytesWritten > this.maxChunkSize) {
          fileWriteStream?.destroy(
            new Error(
              `Payload Too Large: chunk payload exceeded maximum allowed limit (${this.maxChunkSize}).`
            )
          );
        }
      });

      await pipeline(nodeReadable, fileWriteStream);

      if (bytesWritten === 0 && expectedChunkSize > 0) {
        throw new Error(`Chunk ${chunkIndex} received 0 bytes.`);
      }

      await this.markChunkDone(session.chunksDir, chunkIndex);

      const uploadedChunks = await this.getAtomicUploadedChunks(session.chunksDir);
      const uploadedBytes = uploadedChunks.reduce((acc, idx) => {
        const isLast = idx === session.totalChunks - 1;
        const size = isLast
          ? session.fileSize - (session.totalChunks - 1) * session.chunkSize
          : session.chunkSize;
        return acc + size;
      }, 0);

      session.uploadedChunks = uploadedChunks;
      session.uploadedBytes = uploadedBytes;
      session.status = "uploading";
      session.updatedAt = new Date().toISOString();
      await this.saveSession(session);

      const remainingBytes = Math.max(0, session.fileSize - uploadedBytes);
      this.updateReservation(uploadId, remainingBytes);
    } catch (err: any) {
      if (err.code === "ENOSPC" || err.message?.includes("ENOSPC")) {
        this.releaseReservation(uploadId);
        session.status = "failed";
        session.error = "Storage space exhausted during chunk upload (ENOSPC).";
        await this.saveSession(session).catch(() => {});
        throw new Error("Storage space exhausted during chunk upload (ENOSPC). Upload failed safely.");
      }
      throw err;
    } finally {
      this.activeChunkLocks.delete(chunkLockKey);
      this.globalActiveWriteStreams = Math.max(0, this.globalActiveWriteStreams - 1);

      const current = this.activeUploadWrites.get(uploadId) || 1;
      if (current <= 1) {
        this.activeUploadWrites.delete(uploadId);
      } else {
        this.activeUploadWrites.set(uploadId, current - 1);
      }

      if (fileWriteStream && this.activeWriteStreams.has(uploadId)) {
        this.activeWriteStreams.get(uploadId)!.delete(fileWriteStream);
      }
    }

    const uploadedChunks = await this.getAtomicUploadedChunks(session.chunksDir);
    const uploadedBytes = uploadedChunks.reduce((acc, idx) => {
      const isLast = idx === session.totalChunks - 1;
      const size = isLast
        ? session.fileSize - (session.totalChunks - 1) * session.chunkSize
        : session.chunkSize;
      return acc + size;
    }, 0);

    const progress =
      session.totalChunks > 0 ? Math.round((uploadedChunks.length / session.totalChunks) * 100) : 0;

    return {
      uploadId: session.uploadId,
      chunkIndex,
      totalChunks: session.totalChunks,
      uploadedBytes,
      progress,
      isDuplicate,
    };
  }

  public async completeUpload(
    uploadId: string,
    uploadToken?: string,
    clientSha256?: string
  ): Promise<UploadCompleteResponse> {
    // Acquire per-session lifecycle lock to prevent cleanup vs completion race
    while (!this.acquireLifecycleLock(uploadId)) {
      await new Promise((r) => setTimeout(r, 20));
    }

    try {
      const session = await this.loadSession(uploadId);
      this.validateToken(session, uploadToken);

      if (session.status === "completed") {
        throw new Error("Upload is already completed.");
      }
      if (session.status === "cancelled") {
        throw new Error("Upload session has been cancelled.");
      }
      if (session.status === "expired") {
        throw new Error("Upload session has expired.");
      }
      if (session.status === "finalizing") {
        throw new Error("Upload session is already finalizing.");
      }

      // Guard: Prevent completing upload while chunk writes are still active
      const inFlightWrites = this.activeUploadWrites.get(uploadId) || 0;
      if (inFlightWrites > 0) {
        throw new Error(
          `Cannot complete upload: ${inFlightWrites} chunk write(s) are still actively streaming to disk.`
        );
      }

      // Verify all chunks are accounted for atomically
      const uploadedChunks = await this.getAtomicUploadedChunks(session.chunksDir);
      const missingChunks: number[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        if (!uploadedChunks.includes(i)) {
          missingChunks.push(i);
        }
      }

      if (missingChunks.length > 0) {
        throw new Error(
          `Cannot complete upload: ${missingChunks.length} chunk(s) missing. Missing indices: ${missingChunks.slice(0, 10).join(", ")}${missingChunks.length > 10 ? "..." : ""}`
        );
      }

      if (!fs.existsSync(session.stagingPath)) {
        throw new Error(`Staging file not found: ${session.stagingPath}`);
      }
      const stat = await fs.promises.stat(session.stagingPath);
      if (stat.size !== session.fileSize) {
        throw new Error(
          `File size discrepancy on disk: expected ${session.fileSize} bytes, found ${stat.size} bytes.`
        );
      }

      // Mark status as 'finalizing' before entering long checksum and probe operations
      session.status = "finalizing";
      session.updatedAt = new Date().toISOString();
      await this.saveSession(session);

      // Stream SHA-256 calculation
      const calculatedSha256 = await this.calculateFileSha256(session.stagingPath);
      session.calculatedSha256 = calculatedSha256;

      const expectedHash = clientSha256 || session.expectedSha256;
      if (expectedHash && expectedHash.toLowerCase() !== calculatedSha256.toLowerCase()) {
        throw new Error(
          `SHA-256 integrity check failed. Expected: ${expectedHash}, calculated: ${calculatedSha256}.`
        );
      }

      // Deep inspection via FFprobe
      let metadata: VideoMetadata;
      try {
        metadata = await ffmpegService.probeVideo(session.stagingPath);
      } catch (probeErr: any) {
        throw new Error(`Corrupt or unreadable media file: ${probeErr.message}`);
      }

      // 4-hour strict constraint
      if (metadata.duration > MAX_DURATION_SECONDS) {
        await fs.promises.unlink(session.stagingPath).catch(() => {});
        if (fs.existsSync(session.chunksDir)) {
          await fs.promises.rm(session.chunksDir, { recursive: true, force: true }).catch(() => {});
        }
        this.releaseReservation(uploadId);
        session.status = "failed";
        session.error = `Video duration exceeds maximum allowed limit of 4 hours (${metadata.durationFormatted} detected).`;
        await this.saveSession(session);
        throw new Error(session.error);
      }

      // Move completed staging file to persistent storage
      const finalPath = await storageService.saveUploadedFile(session.stagingPath, session.filename);

      // Clean up staging file and chunk markers
      if (fs.existsSync(session.stagingPath)) {
        await fs.promises.unlink(session.stagingPath).catch(() => {});
      }
      if (fs.existsSync(session.chunksDir)) {
        await fs.promises.rm(session.chunksDir, { recursive: true, force: true }).catch(() => {});
      }

      this.releaseReservation(uploadId);

      const now = new Date().toISOString();
      session.status = "completed";
      session.completedAt = now;
      session.updatedAt = now;
      await this.saveSession(session);

      return {
        success: true,
        filePath: finalPath,
        metadata,
        sha256: calculatedSha256,
      };
    } finally {
      this.releaseLifecycleLock(uploadId);
    }
  }

  public async cancelUpload(uploadId: string, uploadToken?: string): Promise<UploadCancelResponse> {
    while (!this.acquireLifecycleLock(uploadId)) {
      await new Promise((r) => setTimeout(r, 20));
    }

    try {
      const session = await this.loadSession(uploadId);
      this.validateToken(session, uploadToken);

      this.releaseReservation(uploadId);

      const activeStreams = this.activeWriteStreams.get(uploadId);
      if (activeStreams) {
        for (const stream of activeStreams) {
          stream.destroy();
        }
        this.activeWriteStreams.delete(uploadId);
      }
      this.activeUploadWrites.delete(uploadId);

      if (fs.existsSync(session.chunksDir)) {
        await fs.promises.rm(session.chunksDir, { recursive: true, force: true }).catch(() => {});
      }

      if (fs.existsSync(session.stagingPath)) {
        await fs.promises.unlink(session.stagingPath).catch(() => {});
      }

      session.status = "cancelled";
      session.updatedAt = new Date().toISOString();
      await this.saveSession(session);

      const sessionPath = this.getSessionPath(uploadId);
      if (fs.existsSync(sessionPath)) {
        await fs.promises.unlink(sessionPath).catch(() => {});
      }

      return {
        cancelled: true,
        uploadId,
      };
    } finally {
      this.releaseLifecycleLock(uploadId);
    }
  }

  public isReferencedByActiveJob(uploadId: string, filename: string): boolean {
    const jobsFile = path.resolve(process.env.STORAGE_LOCAL_DIR || "./storage_data", "jobs_store.json");
    if (!fs.existsSync(jobsFile)) return false;
    try {
      const raw = fs.readFileSync(jobsFile, "utf-8");
      const jobs = JSON.parse(raw);
      if (!Array.isArray(jobs)) return false;
      return jobs.some(
        (j: any) =>
          (j.status === "queued" || j.status === "processing") &&
          j.inputPath &&
          (j.inputPath.includes(uploadId) || j.inputPath.includes(filename))
      );
    } catch {
      return false;
    }
  }

  public async cleanupAbandoned(
    maxAgeMs: number = 24 * 60 * 60 * 1000,
    completedRetentionMs: number = this.completedSessionRetentionMs
  ): Promise<number> {
    this.ensureDirs();
    let cleanedCount = 0;
    const now = Date.now();

    const sessionFiles = await fs.promises.readdir(this.sessionsDir);
    for (const f of sessionFiles) {
      if (!f.endsWith(".json")) continue;
      const fullPath = path.join(this.sessionsDir, f);
      try {
        const raw = await fs.promises.readFile(fullPath, "utf-8");
        const session: UploadSession = JSON.parse(raw);

        const age = now - new Date(session.updatedAt || session.createdAt).getTime();
        const isExpired = session.expiresAt ? now > new Date(session.expiresAt).getTime() : false;

        // Lifecycle and active write guards: NEVER delete sessions actively completing or writing
        if (this.activeLifecycleLocks.has(session.uploadId)) {
          continue;
        }
        if (session.status === "finalizing") {
          const finalizingAge = now - new Date(session.updatedAt || session.createdAt).getTime();
          if (finalizingAge > 5 * 60 * 1000 || isExpired) {
            if (!this.isReferencedByActiveJob(session.uploadId, session.filename)) {
              session.status = "failed";
              session.error = "Upload finalization timed out or was interrupted.";
              session.updatedAt = new Date().toISOString();
              await this.saveSession(session).catch(() => {});
            }
          }
          continue;
        }
        const activeWrites = this.activeUploadWrites.get(session.uploadId) || 0;
        if (activeWrites > 0) {
          continue;
        }

        // Cleanup completed sessions after retention expiration (Issue 2)
        if (session.status === "completed") {
          const completedAt = session.completedAt || session.updatedAt || session.createdAt;
          const completedAge = now - new Date(completedAt).getTime();
          if (completedAge > completedRetentionMs) {
            if (!this.isReferencedByActiveJob(session.uploadId, session.filename)) {
              if (this.acquireLifecycleLock(session.uploadId)) {
                try {
                  if (session.chunksDir && fs.existsSync(session.chunksDir)) {
                    await fs.promises.rm(session.chunksDir, { recursive: true, force: true }).catch(() => {});
                  }
                  await fs.promises.unlink(fullPath).catch(() => {});
                  cleanedCount++;
                } finally {
                  this.releaseLifecycleLock(session.uploadId);
                }
              }
            }
          }
          continue;
        }

        // Cleanup expired / cancelled / failed / abandoned incomplete sessions
        if (
          age > maxAgeMs ||
          isExpired ||
          session.status === "cancelled" ||
          session.status === "failed" ||
          session.status === "expired"
        ) {
          if (this.acquireLifecycleLock(session.uploadId)) {
            try {
              this.releaseReservation(session.uploadId);

              if (fs.existsSync(session.stagingPath)) {
                await fs.promises.unlink(session.stagingPath).catch(() => {});
              }
              if (session.chunksDir && fs.existsSync(session.chunksDir)) {
                await fs.promises.rm(session.chunksDir, { recursive: true, force: true }).catch(() => {});
              }
              await fs.promises.unlink(fullPath).catch(() => {});
              cleanedCount++;
            } finally {
              this.releaseLifecycleLock(session.uploadId);
            }
          }
        }
      } catch {
        await fs.promises.unlink(fullPath).catch(() => {});
        cleanedCount++;
      }
    }

    // Sweep orphaned .part files in staging directory
    const stagingFiles = await fs.promises.readdir(this.stagingDir);
    for (const sf of stagingFiles) {
      if (!sf.endsWith(".part")) continue;
      const partPath = path.join(this.stagingDir, sf);
      try {
        const stat = await fs.promises.stat(partPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          let isPartActive = false;
          for (const uploadId of this.activeUploadWrites.keys()) {
            if (sf.includes(uploadId)) {
              isPartActive = true;
              break;
            }
          }
          if (!isPartActive) {
            for (const lockId of this.activeLifecycleLocks) {
              if (sf.includes(lockId)) {
                isPartActive = true;
                break;
              }
            }
          }
          if (!isPartActive) {
            for (const f of sessionFiles) {
              if (f.endsWith(".json")) {
                const sId = f.replace(/\.json$/, "");
                if (sf.includes(sId)) {
                  try {
                    const sRaw = await fs.promises.readFile(path.join(this.sessionsDir, f), "utf-8");
                    const sData = JSON.parse(sRaw);
                    if (sData.status === "uploading" || sData.status === "finalizing") {
                      isPartActive = true;
                      break;
                    }
                  } catch {}
                }
              }
            }
          }
          if (!isPartActive) {
            await fs.promises.unlink(partPath).catch(() => {});
            cleanedCount++;
          }
        }
      } catch {}
    }

    return cleanedCount;
  }

  public calculateFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", (err) => reject(err));
    });
  }
}

/**
 * Resolves the client IP address according to secure proxy validation rules.
 *
 * Reverse Proxy Configuration Requirements when TRUST_PROXY=true:
 * 1. Single-hop reverse proxy (e.g. Nginx, Caddy, Apache):
 *    - Preferred: proxy_set_header X-Real-IP $remote_addr;
 *    - Standard:  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 * 2. Multi-hop reverse proxy:
 *    - Configure TRUSTED_PROXY_HOPS (default: 1) to match the number of trusted reverse proxy hops.
 * 3. Security Policy:
 *    - If 'x-real-ip' is present, it is trusted as the single-hop proxy's verified remote address.
 *    - For 'x-forwarded-for', arbitrary client-supplied leftmost tokens are NOT trusted.
 *      The verified client IP is extracted from the rightmost hop (tokens.length - TRUSTED_PROXY_HOPS).
 * 4. When TRUST_PROXY is false or unset:
 *    - All forwarded proxy headers are ignored to prevent spoofing by untrusted clients.
 *    - Returns "direct-client".
 */
export function getClientIp(req: Request | any): string {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (!trustProxy || !req || !req.headers) {
    return "direct-client";
  }

  const getHeader = (name: string): string | null => {
    if (typeof req.headers.get === "function") {
      return req.headers.get(name);
    }
    return req.headers[name] || req.headers[name.toLowerCase()] || null;
  };

  const realIp = getHeader("x-real-ip");
  if (realIp && typeof realIp === "string" && realIp.trim().length > 0) {
    return realIp.trim();
  }

  const forwarded = getHeader("x-forwarded-for");
  if (forwarded && typeof forwarded === "string" && forwarded.trim().length > 0) {
    const tokens = forwarded
      .split(",")
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0);
    if (tokens.length > 0) {
      const hops = parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10);
      const targetIndex = Math.max(0, tokens.length - hops);
      return tokens[targetIndex];
    }
  }

  return "direct-client";
}

export const uploadManager = new UploadManager();
