import { spawn } from "child_process";
import fs from "fs";

export interface StreamTimelineInfo {
  codec: string;
  duration: number; // in seconds
  startTime: number; // in seconds
  ptsInitial: number; // presentation timestamp of first packet
}

export interface VideoTimelineInfo extends StreamTimelineInfo {
  width: number;
  height: number;
  fpsNominal: number;
  fpsAverage: number;
  frameCount: number;
  isVfr: boolean;
  maxFrameJitterMs: number;
  hasDiscontinuities: boolean;
}

export interface AudioTimelineInfo extends StreamTimelineInfo {
  sampleRate: number;
  channels: number;
  sampleCount: number;
}

export interface TimelineReport {
  filePath: string;
  formatDuration: number;
  video: VideoTimelineInfo | null;
  audio: AudioTimelineInfo | null;
  initialOffsetMs: number; // Audio PTS - Video PTS in ms (> 0 means audio starts after video)
  durationDiscrepancyMs: number; // Audio duration - Video duration in ms
  driftRate: number; // (Audio duration - Video duration) / Video duration
  driftMsPerHour: number;
  isAligned: boolean;
  syncRecommendation: "preserve" | "align_offset" | "conform_drift" | "audio_missing" | "video_missing";
  diagnostics: string[];
}

export class TimelineAnalyzer {
  /**
   * Run detailed timeline inspection via ffprobe
   */
  public async analyzeTimeline(filePath: string): Promise<TimelineReport> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found for timeline analysis: ${filePath}`);
    }

    const streamsData = await this.probeStreams(filePath);
    const formatData = streamsData.format || {};
    const streams = streamsData.streams || [];

    const vStream = streams.find((s: any) => s.codec_type === "video");
    const aStream = streams.find((s: any) => s.codec_type === "audio");

    let videoInfo: VideoTimelineInfo | null = null;
    let audioInfo: AudioTimelineInfo | null = null;
    const diagnostics: string[] = [];

    // Analyze Video Stream
    if (vStream) {
      const duration = parseFloat(vStream.duration || formatData.duration || "0");
      const startTime = parseFloat(vStream.start_time || "0");
      const frameCount = parseInt(vStream.nb_frames || "0", 10);

      let fpsNominal = 24;
      if (vStream.r_frame_rate) {
        const [n, d] = vStream.r_frame_rate.split("/").map(Number);
        if (d && d > 0) fpsNominal = Math.round((n / d) * 1000) / 1000;
      }

      let fpsAverage = fpsNominal;
      if (vStream.avg_frame_rate) {
        const [n, d] = vStream.avg_frame_rate.split("/").map(Number);
        if (d && d > 0) fpsAverage = Math.round((n / d) * 1000) / 1000;
      }

      // Packet-level PTS inspection for jitter & VFR detection
      const packetPts = await this.probePacketPts(filePath, "v:0", 60);
      let isVfr = false;
      let maxFrameJitterMs = 0;
      let hasDiscontinuities = false;
      const ptsInitial = packetPts.length > 0 ? packetPts[0] : startTime;

      if (packetPts.length >= 4) {
        const nominalDelta = fpsNominal > 0 ? 1 / fpsNominal : 1 / 24;
        const deltas: number[] = [];

        for (let i = 1; i < packetPts.length; i++) {
          const delta = packetPts[i] - packetPts[i - 1];
          deltas.push(delta);
          const jitter = Math.abs(delta - nominalDelta) * 1000;
          if (jitter > maxFrameJitterMs) maxFrameJitterMs = jitter;
          if (delta > nominalDelta * 2.5 || delta < 0) {
            hasDiscontinuities = true;
          }
        }

        // Variance in deltas indicates Variable Frame Rate
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const variance = deltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / deltas.length;
        if (variance > 1e-4 || Math.abs(fpsNominal - fpsAverage) > 0.1) {
          isVfr = true;
          diagnostics.push(`Variable Frame Rate (VFR) detected (nominal: ${fpsNominal} fps, avg: ${fpsAverage} fps, jitter: ${maxFrameJitterMs.toFixed(1)}ms).`);
        }
      }

      videoInfo = {
        codec: vStream.codec_name || "unknown",
        width: parseInt(vStream.width || "0", 10),
        height: parseInt(vStream.height || "0", 10),
        duration,
        startTime,
        ptsInitial,
        fpsNominal,
        fpsAverage,
        frameCount,
        isVfr,
        maxFrameJitterMs,
        hasDiscontinuities,
      };
    }

    // Analyze Audio Stream
    if (aStream) {
      const duration = parseFloat(aStream.duration || formatData.duration || "0");
      const startTime = parseFloat(aStream.start_time || "0");
      const sampleRate = parseInt(aStream.sample_rate || "48000", 10);
      const channels = parseInt(aStream.channels || "2", 10);
      const packetPts = await this.probePacketPts(filePath, "a:0", 60);
      const ptsInitial = packetPts.length > 0 ? packetPts[0] : startTime;
      const sampleCount = Math.round(duration * sampleRate);

      audioInfo = {
        codec: aStream.codec_name || "unknown",
        sampleRate,
        channels,
        duration,
        startTime,
        ptsInitial,
        sampleCount,
      };
    }

    // Audio-Video Differential Analysis
    let initialOffsetMs = 0;
    let durationDiscrepancyMs = 0;
    let driftRate = 0;
    let driftMsPerHour = 0;
    let syncRecommendation: TimelineReport["syncRecommendation"] = "preserve";

    if (videoInfo && audioInfo) {
      // Audio PTS minus Video PTS (> 0 means audio starts later than video)
      initialOffsetMs = Math.round((audioInfo.ptsInitial - videoInfo.ptsInitial) * 1000 * 100) / 100;
      durationDiscrepancyMs = Math.round((audioInfo.duration - videoInfo.duration) * 1000 * 100) / 100;

      if (videoInfo.duration > 0) {
        driftRate = (audioInfo.duration - videoInfo.duration) / videoInfo.duration;
        driftMsPerHour = Math.round(driftRate * 3600 * 1000 * 100) / 100;
      }

      // Check alignment criteria:
      // Offset within +/- 15ms is considered perfectly synchronized for cinema standards (1 frame @ 24fps = 41.7ms)
      const offsetAligned = Math.abs(initialOffsetMs) < 15;
      const durationAligned = Math.abs(durationDiscrepancyMs) < 40;

      if (offsetAligned && durationAligned && !videoInfo.isVfr && !videoInfo.hasDiscontinuities) {
        syncRecommendation = "preserve";
        diagnostics.push("Streams are naturally synchronized. Preserving original presentation timestamps.");
      } else if (!offsetAligned && durationAligned) {
        syncRecommendation = "align_offset";
        diagnostics.push(`Initial A/V offset of ${initialOffsetMs > 0 ? "+" : ""}${initialOffsetMs.toFixed(1)}ms detected. Alignment correction required.`);
      } else {
        syncRecommendation = "conform_drift";
        diagnostics.push(`Clock drift/duration mismatch (${durationDiscrepancyMs.toFixed(1)}ms total, ${driftMsPerHour.toFixed(1)}ms/hr) or VFR detected. Timeline conforming required.`);
      }
    } else if (!videoInfo) {
      syncRecommendation = "video_missing";
      diagnostics.push("Warning: Video stream missing from media container.");
    } else {
      syncRecommendation = "audio_missing";
      diagnostics.push("Notice: Media contains no audio stream.");
    }

    const isAligned = syncRecommendation === "preserve";
    const formatDuration = parseFloat(formatData.duration || "0");

    return {
      filePath,
      formatDuration,
      video: videoInfo,
      audio: audioInfo,
      initialOffsetMs,
      durationDiscrepancyMs,
      driftRate,
      driftMsPerHour,
      isAligned,
      syncRecommendation,
      diagnostics,
    };
  }

  private async probeStreams(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const args = [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        filePath,
      ];
      const proc = spawn("ffprobe", args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(`ffprobe streams inspection failed: ${stderr}`));
        try {
          resolve(JSON.parse(stdout));
        } catch (e: any) {
          reject(new Error(`Failed to parse ffprobe json: ${e.message}`));
        }
      });
    });
  }

  private async probePacketPts(filePath: string, streamSelector: string, maxPackets: number): Promise<number[]> {
    return new Promise((resolve) => {
      // First attempt decoded frame presentation timestamps (true display order with edit lists)
      const frameArgs = [
        "-v", "quiet",
        "-select_streams", streamSelector,
        "-show_entries", "frame=pts_time",
        "-read_intervals", "%+3",
        "-of", "csv=p=0:nk=1",
        filePath,
      ];
      const proc = spawn("ffprobe", frameArgs);
      let stdout = "";

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.on("close", () => {
        let ptsList: number[] = stdout
          .split("\n")
          .map((line) => parseFloat(line.split(",")[0].trim()))
          .filter((n) => !isNaN(n));

        if (ptsList.length === 0) {
          // Fallback to packet presentation timestamps if container lacks frame-level indexing
          const packetArgs = [
            "-v", "quiet",
            "-select_streams", streamSelector,
            "-show_entries", "packet=pts_time",
            "-read_intervals", "%+3",
            "-of", "csv=p=0:nk=1",
            filePath,
          ];
          const fallbackProc = spawn("ffprobe", packetArgs);
          let fbOut = "";
          fallbackProc.stdout.on("data", (d) => (fbOut += d.toString()));
          fallbackProc.on("close", () => {
            ptsList = fbOut
              .split("\n")
              .map((line) => parseFloat(line.split(",")[0].trim()))
              .filter((n) => !isNaN(n));
            ptsList.sort((a, b) => a - b);
            if (ptsList.length > 0 && ptsList[0] < 0 && ptsList[0] >= -0.05) {
              ptsList[0] = 0.0;
            }
            resolve(ptsList.slice(0, maxPackets));
          });
          return;
        }

        ptsList.sort((a, b) => a - b);
        if (ptsList.length > 0 && ptsList[0] < 0 && ptsList[0] >= -0.05) {
          ptsList[0] = 0.0;
        }
        resolve(ptsList.slice(0, maxPackets));
      });
    });
  }
}

export const timelineAnalyzer = new TimelineAnalyzer();
