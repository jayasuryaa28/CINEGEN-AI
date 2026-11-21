const { spawn } = require("child_process");
const fs = require("fs");

class FFmpegService {
  async probeVideo(filePath) {
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

          const videoStream = streams.find((s) => s.codec_type === "video");
          const audioStream = streams.find((s) => s.codec_type === "audio");

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

          const metadata = {
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
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe json output: ${e.message}`));
        }
      });
    });
  }

  async extractAudio(inputPath, outputPath) {
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

  async segmentVideo(inputPath, outputPattern, segmentDurationSec = 10) {
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
  async processChunk(inputChunkPath, outputChunkPath, targetWidth, targetHeight, options = {}) {
    return new Promise((resolve, reject) => {
      const filterParts = [];

      // 1. Perspective correction
      if (options.perspective && options.perspective.enabled && options.perspective.filterString) {
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

  async mergeVideoChunks(concatListFile, outputVideoOnly) {
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

  async multiplexFinalVideo(videoPath, audioPath, finalOutputPath) {
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

const ffmpegService = new FFmpegService();

module.exports = {
  FFmpegService,
  ffmpegService,
};
