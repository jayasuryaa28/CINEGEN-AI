import { spawn } from "child_process";
import fs from "fs";
import { VideoMetadata } from "@/types";

export class FFmpegService {
  /**
   * Run ffprobe to inspect video metadata
   */
  public async probeVideo(filePath: string): Promise<VideoMetadata> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Video file not found at path: ${filePath}`);
    }

    const stat = await fs.promises.stat(filePath);

    return new Promise((resolve, reject) => {
      const args = [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ];

      const probe = spawn("ffprobe", args);
      let output = "";
      let errOutput = "";

      probe.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });

      probe.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      probe.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe failed with code ${code}: ${errOutput}`));
        }

        try {
          const data = JSON.parse(output);
          const format = data.format || {};
          const streams = data.streams || [];

          const videoStream = streams.find((s: any) => s.codec_type === "video");
          const audioStream = streams.find((s: any) => s.codec_type === "audio");

          if (!videoStream) {
            return reject(new Error("No valid video stream found in uploaded file."));
          }

          const duration = parseFloat(format.duration || videoStream.duration || "0");
          const width = parseInt(videoStream.width || "0", 10);
          const height = parseInt(videoStream.height || "0", 10);

          let framerate = 24;
          if (videoStream.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
            if (den && den > 0) {
              framerate = Math.round((num / den) * 100) / 100;
            }
          }

          const hours = Math.floor(duration / 3600);
          const minutes = Math.floor((duration % 3600) / 60);
          const seconds = Math.floor(duration % 60);
          const durationFormatted = [
            hours.toString().padStart(2, "0"),
            minutes.toString().padStart(2, "0"),
            seconds.toString().padStart(2, "0"),
          ].join(":");

          const metadata: VideoMetadata = {
            filename: filePath.split(/[/\\]/).pop() || "unknown",
            filesize: stat.size,
            format: (format.format_name || "unknown").split(",")[0],
            duration,
            durationFormatted,
            width,
            height,
            framerate,
            videoCodec: videoStream.codec_name || "unknown",
            audioCodec: audioStream ? audioStream.codec_name : null,
            hasAudio: !!audioStream,
            bitrate: parseInt(format.bit_rate || "0", 10),
          };

          resolve(metadata);
        } catch (e: any) {
          reject(new Error(`Failed to parse ffprobe json output: ${e.message}`));
        }
      });
    });
  }

  /**
   * Extract audio automatically from video into a high-fidelity 48kHz stereo WAV file
   */
  public async extractAudio(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        outputPath,
      ];

      const ffmpeg = spawn("ffmpeg", args);
      let errOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Audio extraction failed with code ${code}: ${errOutput}`));
        }
        resolve(outputPath);
      });
    });
  }

  /**
   * Segment video into manageable chunks (e.g. 10s to 30s)
   */
  public async segmentVideo(
    inputPath: string,
    outputPattern: string,
    segmentDurationSec: number = 10
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        inputPath,
        "-c",
        "copy",
        "-map",
        "0:v:0",
        "-f",
        "segment",
        "-segment_time",
        segmentDurationSec.toString(),
        "-reset_timestamps",
        "1",
        outputPattern,
      ];

      const ffmpeg = spawn("ffmpeg", args);
      let errOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Video segmentation failed with code ${code}: ${errOutput}`));
        }
        resolve();
      });
    });
  }

  /**
   * Process and upscale a video chunk to target resolution with FFmpeg filtergraph.
   * Filter order:
   * 1. Perspective correction (if enabled and validated)
   * 2. Scaling (Lanczos)
   * 3. Unsharp masking
   */
  public async processChunk(
    inputChunkPath: string,
    outputChunkPath: string,
    targetWidth: number,
    targetHeight: number,
    options?: {
      perspective?: {
        enabled: boolean;
        filterString?: string;
        corners?: [number, number][];
        interpolation?: "cubic" | "linear";
        reason?: string;
      };
    }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const filterParts: string[] = [];

      // 1. Perspective correction
      if (options?.perspective?.enabled && options.perspective.filterString) {
        filterParts.push(options.perspective.filterString);
      }

      // 2. Scaling
      filterParts.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos`);

      // 3. Unsharp masking
      filterParts.push(`unsharp=5:5:0.5:5:5:0.0`);

      const filter = filterParts.join(",");

      const args = [
        "-y",
        "-i",
        inputChunkPath,
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-an",
        outputChunkPath,
      ];

      const ffmpeg = spawn("ffmpeg", args);
      let errOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Chunk processing failed: ${errOutput}`));
        }
        resolve();
      });
    });
  }

  /**
   * Merge processed chunks via concat demuxer
   */
  public async mergeVideoChunks(concatListFile: string, outputVideoOnly: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListFile,
        "-c",
        "copy",
        outputVideoOnly,
      ];

      const ffmpeg = spawn("ffmpeg", args);
      let errOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Chunk merging failed: ${errOutput}`));
        }
        resolve();
      });
    });
  }

  /**
   * Multiplex final processed video and enhanced audio stream with timestamp sync
   */
  public async multiplexFinalVideo(
    videoPath: string,
    audioPath: string | null,
    finalOutputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ["-y", "-i", videoPath];

      if (audioPath && fs.existsSync(audioPath)) {
        args.push("-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest");
      } else {
        args.push("-c:v", "copy", "-an");
      }

      args.push("-movflags", "+faststart", finalOutputPath);

      const ffmpeg = spawn("ffmpeg", args);
      let errOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Final multiplexing failed: ${errOutput}`));
        }
        resolve();
      });
    });
  }
}

export const ffmpegService = new FFmpegService();
