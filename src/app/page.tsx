"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Upload,
  Film,
  Sparkles,
  Download,
  AlertCircle,
  Clock,
  Layers,
  Volume2,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  ChevronDown,
  Cpu,
  XCircle,
} from "lucide-react";
import { VideoMetadata, OutputQuality, ProcessingJob } from "@/types";

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStatusText, setUploadStatusText] = useState<string>("");
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [activeUploadToken, setActiveUploadToken] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [quality, setQuality] = useState<OutputQuality>("1080p");
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const uploadCancelledRef = useRef<boolean>(false);

  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunk slices

  // Generates lightweight fingerprint across file edges and metadata
  const generateLightweightFingerprint = async (file: File): Promise<string> => {
    const headSize = Math.min(65536, file.size);
    const headBlob = file.slice(0, headSize);
    const tailStart = Math.max(0, file.size - 65536);
    const tailBlob = file.slice(tailStart, file.size);

    const headBuffer = await headBlob.arrayBuffer();
    const tailBuffer = await tailBlob.arrayBuffer();

    const metaStr = `${file.name}:${file.size}:${file.lastModified}:`;
    const enc = new TextEncoder();
    const metaBytes = enc.encode(metaStr);

    const combined = new Uint8Array(metaBytes.length + headBuffer.byteLength + tailBuffer.byteLength);
    combined.set(metaBytes, 0);
    combined.set(new Uint8Array(headBuffer), metaBytes.length);
    combined.set(new Uint8Array(tailBuffer), metaBytes.length + headBuffer.byteLength);

    if (typeof crypto !== "undefined" && crypto.subtle) {
      const hashBuf = await crypto.subtle.digest("SHA-256", combined);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      return `${file.name}-${file.size}-${file.lastModified}`;
    }
  };

  // Clean preview blob on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, [previewUrl]);

  // Handle file drop or selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setSelectedFile(file);
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);

    // Auto upload and inspect server-side using resumable binary chunk protocol
    await uploadAndInspect(file);
  };

  const handleCancelUpload = async () => {
    uploadCancelledRef.current = true;
    if (activeUploadId && activeUploadToken) {
      try {
        await fetch("/api/upload/cancel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-upload-token": activeUploadToken,
          },
          body: JSON.stringify({ uploadId: activeUploadId, uploadToken: activeUploadToken }),
        });
      } catch {}
    }
    setIsUploading(false);
    setUploadStatusText("Upload cancelled.");
    setUploadProgress(0);
    setActiveUploadId(null);
    setActiveUploadToken(null);
  };

  const uploadAndInspect = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    setMetadata(null);
    setActiveJob(null);
    setUploadProgress(0);
    setUploadStatusText("Initializing upload session...");
    uploadCancelledRef.current = false;

    // Client fingerprint and resilient storage key incorporating lastModified
    const fingerprint = await generateLightweightFingerprint(file);
    const savedKey = `cinegen_resumable_${file.name}_${file.size}_${file.lastModified}`;

    let savedSession: { uploadId: string; uploadToken: string } | null = null;
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(savedKey);
        if (raw) savedSession = JSON.parse(raw);
      } catch {}
    }

    let uploadId: string | null = savedSession?.uploadId || null;
    let uploadToken: string | null = savedSession?.uploadToken || null;
    let uploadedChunks: number[] = [];
    let chunkSize = CHUNK_SIZE;
    let totalChunks = Math.ceil(file.size / chunkSize);

    try {
      // 1. Check if an active upload session exists and is resumable
      if (uploadId && uploadToken) {
        try {
          const statusUrl = `/api/upload/status?uploadId=${uploadId}&filename=${encodeURIComponent(
            file.name
          )}&fileSize=${file.size}&lastModified=${file.lastModified}&fingerprint=${encodeURIComponent(fingerprint)}`;

          const statusRes = await fetch(statusUrl, {
            headers: { "x-upload-token": uploadToken },
          });

          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.status === "uploading" || statusData.status === "initialized") {
              uploadedChunks = statusData.uploadedChunks || [];
              chunkSize = statusData.chunkSize || CHUNK_SIZE;
              totalChunks = statusData.totalChunks || Math.ceil(file.size / chunkSize);
              setUploadStatusText(`Resuming upload (${uploadedChunks.length}/${totalChunks} chunks present)...`);
            } else {
              uploadId = null;
              uploadToken = null;
              if (typeof window !== "undefined") localStorage.removeItem(savedKey);
            }
          } else {
            uploadId = null;
            uploadToken = null;
            if (typeof window !== "undefined") localStorage.removeItem(savedKey);
          }
        } catch {
          uploadId = null;
          uploadToken = null;
        }
      }

      // 2. Initialize new session if not resuming
      if (!uploadId || !uploadToken) {
        const initRes = await fetch("/api/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            fileSize: file.size,
            chunkSize,
            lastModified: file.lastModified,
            fingerprint,
          }),
        });

        const initData = await initRes.json();
        if (!initRes.ok) {
          throw new Error(initData.error || "Failed to initialize upload session.");
        }

        uploadId = initData.uploadId;
        uploadToken = initData.uploadToken;
        if (!uploadId || !uploadToken) {
          throw new Error("Invalid upload session returned from server.");
        }
        chunkSize = initData.chunkSize;
        totalChunks = initData.totalChunks;
        if (typeof window !== "undefined") {
          localStorage.setItem(savedKey, JSON.stringify({ uploadId, uploadToken }));
        }
      }

      setActiveUploadId(uploadId);
      setActiveUploadToken(uploadToken);

      // 3. Upload missing binary chunks sequentially using File.slice()
      for (let i = 0; i < totalChunks; i++) {
        if (uploadCancelledRef.current) {
          return;
        }

        if (uploadedChunks.includes(i)) {
          setUploadProgress(Math.round((uploadedChunks.length / totalChunks) * 100));
          continue;
        }

        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const chunkBlob = file.slice(start, end);

        setUploadStatusText(
          `Uploading chunk ${i + 1} of ${totalChunks} (${Math.round((uploadedChunks.length / totalChunks) * 100)}%)`
        );

        let retries = 0;
        let success = false;
        while (retries < 3 && !success && !uploadCancelledRef.current) {
          try {
            const chunkRes = await fetch(`/api/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": chunkBlob.size.toString(),
                "x-upload-token": uploadToken,
              },
              body: chunkBlob,
            });

            if (!chunkRes.ok) {
              const errData = await chunkRes.json().catch(() => ({}));
              throw new Error(errData.error || `Chunk ${i} upload failed with status ${chunkRes.status}`);
            }

            success = true;
            uploadedChunks.push(i);
            const progress = Math.round((uploadedChunks.length / totalChunks) * 100);
            setUploadProgress(progress);
          } catch (chunkErr: any) {
            retries++;
            if (retries >= 3) {
              throw chunkErr;
            }
            await new Promise((r) => setTimeout(r, 1000 * retries));
          }
        }
      }

      if (uploadCancelledRef.current) {
        return;
      }

      // 4. Complete and verify upload
      setUploadStatusText("Finalizing upload & verifying media stream...");
      setUploadProgress(100);

      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-upload-token": uploadToken,
        },
        body: JSON.stringify({ uploadId, uploadToken }),
      });

      const completeData = await completeRes.json();
      if (!completeRes.ok) {
        throw new Error(completeData.error || "Failed to finalize and inspect video upload.");
      }

      if (typeof window !== "undefined") {
        localStorage.removeItem(savedKey);
      }

      setUploadedFilePath(completeData.filePath);
      setMetadata(completeData.metadata);
      setUploadStatusText("");
    } catch (err: any) {
      if (!uploadCancelledRef.current) {
        setUploadError(err.message || "Failed to upload and validate video.");
      }
    } finally {
      setIsUploading(false);
      setActiveUploadId(null);
      setActiveUploadToken(null);
    }
  };

  // Trigger processing job
  const handleGenerate = async () => {
    if (!uploadedFilePath || !metadata) return;

    setIsGenerating(true);
    setUploadError(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: uploadedFilePath,
          originalFilename: selectedFile?.name || metadata.filename,
          quality,
          metadata,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Could not start processing job.");
      }

      setActiveJob(data.job);
      startPollingJob(data.job.id);
    } catch (err: any) {
      setUploadError(err.message || "Failed to generate video.");
      setIsGenerating(false);
    }
  };

  // Poll job status until completion or failure
  const startPollingJob = (jobId: string) => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

    pollingTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();

        if (res.ok && data.job) {
          setActiveJob(data.job);

          if (data.job.status === "completed" || data.job.status === "failed") {
            if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
            setIsGenerating(false);
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 1500);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex-1 flex flex-col justify-between">
      {/* Header / Brand */}
      <header className="border-b border-cine-border/60 bg-cine-dark/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl electric-gradient flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Film className="w-5 h-5 text-cine-dark stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white">
              CINE<span className="electric-text">GEN</span> AI
            </h1>
            <p className="text-xs text-slate-400 font-medium tracking-tight">
              From Video to Cinematic Experience
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <a
            href="/compute"
            className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-950/40 text-purple-400 border border-purple-800/50 hover:bg-purple-900/50 transition-colors"
          >
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span>Compute Mode</span>
          </a>
          <a
            href="/dataset"
            className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-cyan-950/40 text-cyan-400 border border-cyan-800/50 hover:bg-cyan-900/50 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Dataset Studio (Phase 2)</span>
          </a>
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-cine-panel text-slate-300 border border-cine-border">
            v0.2.0-alpha
          </span>
        </div>
      </header>

      {/* Main Studio Viewport */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Upload & Inspection Area */}
          <div className="lg:col-span-7 space-y-6">
            {/* Upload Box */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 ${
                selectedFile
                  ? "border-cyan-500/50 bg-cyan-950/10"
                  : "border-cine-border hover:border-cyan-500/40 hover:bg-cine-panel/40 bg-cine-charcoal/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska,.mp4,.mov,.mkv"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-cine-panel border border-cine-border flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform shadow-inner">
                  {isUploading ? (
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                  ) : (
                    <Upload className="w-8 h-8" />
                  )}
                </div>

                <div>
                  <h3 className="text-base font-semibold text-white">
                    {selectedFile ? selectedFile.name : "Choose or drag a video file here"}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    MP4, MOV, or MKV • Max duration: 4 hours • Audio extracted automatically
                  </p>
                </div>

                {/* Progress Bar & Status for Resumable Uploads */}
                {isUploading && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-md pt-2 space-y-2 cursor-default"
                  >
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-cyan-400 truncate max-w-[280px]">
                        {uploadStatusText || "Uploading..."}
                      </span>
                      <span className="text-slate-300 font-bold">{uploadProgress}%</span>
                    </div>

                    <div className="w-full bg-slate-800/80 rounded-full h-2.5 overflow-hidden border border-slate-700/60 shadow-inner">
                      <div
                        className="h-2.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300 ease-out shadow-sm shadow-cyan-500/50"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelUpload();
                        }}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg hover:bg-red-900/40 hover:text-red-300 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Cancel Upload</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Error Message Alert */}
            {uploadError && (
              <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 flex items-start space-x-3 text-red-300">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
                <div className="text-sm">{uploadError}</div>
              </div>
            )}

            {/* Uploaded Video Preview Player */}
            {previewUrl && (
              <div className="cine-glass rounded-2xl overflow-hidden border border-cine-border">
                <div className="px-4 py-2.5 bg-cine-panel/80 border-b border-cine-border/60 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Film className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Uploaded Source Preview</span>
                  </span>
                  {metadata && (
                    <span className="text-xs text-slate-400">
                      {metadata.width} × {metadata.height} @ {metadata.framerate}fps
                    </span>
                  )}
                </div>
                <video
                  src={previewUrl}
                  controls
                  className="w-full max-h-[380px] bg-black object-contain"
                />
              </div>
            )}

            {/* Media Information Panel */}
            {metadata && (
              <div className="cine-glass rounded-2xl p-5 border border-cine-border">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                  Server Media Inspection
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-3 rounded-xl bg-cine-panel/60 border border-cine-border/50">
                    <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Duration</span>
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {metadata.durationFormatted}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-cine-panel/60 border border-cine-border/50">
                    <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Resolution</span>
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {metadata.width}x{metadata.height}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-cine-panel/60 border border-cine-border/50">
                    <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                      <Film className="w-3.5 h-3.5" />
                      <span>Video Codec</span>
                    </div>
                    <div className="text-sm font-semibold text-white uppercase">
                      {metadata.videoCodec}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-cine-panel/60 border border-cine-border/50">
                    <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Audio Stream</span>
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {metadata.hasAudio ? (
                        <span className="text-emerald-400 uppercase">
                          {metadata.audioCodec || "Stereo"}
                        </span>
                      ) : (
                        <span className="text-slate-500">None</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-right text-[11px] text-slate-400">
                  File Size: {formatFileSize(metadata.filesize)}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Execution, Quality Selection & Status */}
          <div className="lg:col-span-5 space-y-6">
            {/* Control Panel */}
            <div className="cine-glass rounded-2xl p-6 border border-cine-border space-y-6">
              {/* Output Quality Dropdown */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Target Output Quality
                </label>
                <div className="relative">
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as OutputQuality)}
                    disabled={isGenerating || isUploading}
                    className="w-full appearance-none bg-cine-panel border border-cine-border text-white text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-cyan-400 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <option value="720p">720p HD (1280 × 720)</option>
                    <option value="1080p">1080p Full HD (1920 × 1080) — Recommended</option>
                    <option value="1440p">1440p QHD (2560 × 1440)</option>
                    <option value="4K">4K Ultra HD (3840 × 2160)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <p className="text-[11px] text-slate-400">
                  CINEFRAME neural super-resolution, NOISENET audio denoising, and STEMNET separation.
                </p>
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={!uploadedFilePath || isUploading || isGenerating}
                className="w-full py-4 px-6 rounded-xl font-bold text-sm tracking-wider uppercase transition-all duration-300 flex items-center justify-center space-x-2 electric-gradient text-cine-dark hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none shadow-lg shadow-cyan-500/25"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Processing In Progress...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 fill-cine-dark stroke-cine-dark" />
                    <span>Generate Cinematic Video</span>
                  </>
                )}
              </button>

              {/* Workflow Pipeline Stepper */}
              <div className="border-t border-cine-border/60 pt-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 font-semibold">
                  Intended Workflow
                </div>
                <div className="text-xs text-slate-300 font-mono flex items-center justify-between px-2 py-1.5 rounded-lg bg-cine-dark/40 border border-cine-border/30">
                  <span>UPLOAD</span>
                  <span className="text-cyan-400">→</span>
                  <span>SELECT</span>
                  <span className="text-cyan-400">→</span>
                  <span>GENERATE</span>
                  <span className="text-cyan-400">→</span>
                  <span>DOWNLOAD</span>
                </div>
              </div>
            </div>

            {/* Active Job Real-Time Progress Indicator */}
            {activeJob && (
              <div className="cine-glass rounded-2xl p-6 border border-cine-border space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                    {activeJob.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : activeJob.status === "failed" ? (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    ) : (
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    )}
                    <span>Job Status: {activeJob.status.toUpperCase()}</span>
                  </div>
                  <span className="text-sm font-bold text-cyan-400 font-mono">
                    {activeJob.progress}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-cine-panel h-2.5 rounded-full overflow-hidden p-0.5 border border-cine-border">
                  <div
                    className="h-full rounded-full electric-gradient transition-all duration-500"
                    style={{ width: `${activeJob.progress}%` }}
                  />
                </div>

                {/* Current Stage Text */}
                <div className="text-xs text-slate-300">
                  <span className="text-slate-400">Stage: </span>
                  {activeJob.currentStage}
                </div>

                {activeJob.chunksTotal > 0 && (
                  <div className="text-[11px] text-slate-400 flex justify-between">
                    <span>Chunk Progress:</span>
                    <span>
                      {activeJob.chunksCompleted} of {activeJob.chunksTotal} chunks processed
                    </span>
                  </div>
                )}

                {/* AI Modules Status Notice */}
                <div className="p-3 rounded-xl bg-cine-panel/60 border border-cine-border text-[11px] text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-300">Modular AI Contracts:</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {Object.entries(activeJob.aiModulesStatus).map(([name, status]) => (
                      <span
                        key={name}
                        className="px-2 py-0.5 rounded bg-cine-dark text-[10px] uppercase font-mono text-cyan-300/80 border border-cine-border"
                      >
                        {name}: {status}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Final Video Preview & Download */}
                {activeJob.status === "completed" && (
                  <div className="pt-2 space-y-4">
                    <div className="rounded-xl overflow-hidden border border-emerald-500/40 bg-black">
                      <div className="px-3 py-1.5 bg-emerald-950/40 border-b border-emerald-900/60 text-[11px] font-semibold text-emerald-400 flex items-center justify-between">
                        <span>Enhanced Output Preview ({activeJob.outputQuality})</span>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <video
                        src={`/api/download/${activeJob.id}`}
                        controls
                        className="w-full max-h-[240px] object-contain"
                      />
                    </div>

                    <a
                      href={`/api/download/${activeJob.id}`}
                      download={`CINEGEN_${activeJob.id}_${activeJob.outputQuality}.mp4`}
                      className="w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase flex items-center justify-center space-x-2 bg-emerald-500 hover:bg-emerald-400 text-cine-dark transition-all duration-200 shadow-lg shadow-emerald-500/20"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Final Video (.MP4)</span>
                    </a>
                  </div>
                )}

                {/* Error Banner */}
                {activeJob.status === "failed" && (
                  <div className="p-3 rounded-xl bg-red-950/40 border border-red-800 text-xs text-red-300">
                    {activeJob.error || "The processing pipeline encountered an unrecoverable error."}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-cine-border/50 py-4 px-6 text-center text-xs text-slate-500">
        CINEGEN AI • Open-Source JavaScript Video & Audio Processing Engine • Apache 2.0 License
      </footer>
    </div>
  );
}
