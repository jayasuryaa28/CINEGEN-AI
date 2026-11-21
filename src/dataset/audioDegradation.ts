import { spawn } from "child_process";
import fs from "fs";
import { AudioDegradationConfig } from "@/types/dataset";

export class AudioDegradationEngine {
  /**
   * Builds an FFmpeg audio filtergraph physically modeling room acoustic reflection,
   * crowd noise injection, phone microphone frequency roll-off, and non-linear saturation.
   */
  public buildAudioFiltergraph(config: AudioDegradationConfig): string {
    const filters: string[] = [];

    // 1. Frequency Attenuation (Bandpass: Simulates cheap microphone capsule limitations)
    // Low-cut removes sub-bass (typical of small smartphone mics)
    // High-cut rolls off top crispness
    if (config.frequencyAttenuationLowCut > 0) {
      filters.push(`highpass=f=${config.frequencyAttenuationLowCut}:poles=2`);
    }
    if (config.frequencyAttenuationHighCut > 0) {
      filters.push(`lowpass=f=${config.frequencyAttenuationHighCut}:poles=2`);
    }

    // 2. Room Acoustics: Reverberation & Echo Simulation
    // aecho parameters: in_gain:out_gain:delays:decays
    if (config.echoDelayMs > 0 && config.echoDecay > 0) {
      const delay = config.echoDelayMs;
      const decay = config.echoDecay;
      // Multi-tap reflection mimicking cinema wall bounce
      filters.push(
        `aecho=0.8:0.85:${delay}|${Math.round(delay * 1.8)}|${Math.round(delay * 2.6)}:${decay}|${(decay * 0.6).toFixed(2)}|${(decay * 0.3).toFixed(2)}`
      );
    }

    // 3. Dynamic Range Compression (Simulates automatic gain control in portable recorders)
    if (config.dynamicRangeCompression) {
      filters.push(
        `acompressor=threshold=-24dB:ratio=4:attack=20:release=250:makeup=2dB`
      );
    }

    // 4. Stereo Balance Disparity (Simulates sitting closer to one side of the theatre)
    if (config.stereoImbalance !== 0) {
      const leftGain = (1.0 - config.stereoImbalance).toFixed(2);
      const rightGain = (1.0 + config.stereoImbalance).toFixed(2);
      filters.push(`pan=stereo|c0=${leftGain}*c0|c1=${rightGain}*c1`);
    }

    // 5. Non-linear Transducer Saturation / Soft Overdrive
    if (config.clippingThreshold < 1.0) {
      const drive = (1.0 / config.clippingThreshold).toFixed(1);
      filters.push(`volume=${drive},alimiter=limit=0.95:level=true`);
    }

    return filters.length > 0 ? filters.join(",") : "anull";
  }

  /**
   * Synthetically degrades clean master audio into cinema-recorded audio,
   * incorporating acoustic impulse tails, crowd murmur, and hiss.
   */
  public async renderDegradedAudio(
    cleanAudioPath: string,
    outputDegradedAudioPath: string,
    config: AudioDegradationConfig,
    durationSec: number
  ): Promise<void> {
    if (!fs.existsSync(cleanAudioPath)) {
      throw new Error(`Clean audio file not found at: ${cleanAudioPath}`);
    }

    const baseFilter = this.buildAudioFiltergraph(config);

    // If crowd noise or mic hiss is requested, generate synthetic acoustic noise tracks via lavfi
    const hasNoise = config.crowdNoiseLevel > 0 || config.microphoneHissLevel > 0;

    return new Promise((resolve, reject) => {
      let args: string[] = [];

      if (!hasNoise) {
        // Direct single-stream acoustic filter
        args = [
          "-y",
          "-i",
          cleanAudioPath,
          "-af",
          baseFilter,
          "-c:a",
          "aac",
          "-b:a",
          config.compressionBitrate || "96k",
          "-ar",
          "48000",
          outputDegradedAudioPath,
        ];
      } else {
        // Complex filtergraph with synthetic crowd murmur + microphone thermal hiss
        // Input 0: clean master audio
        // Input 1: pink noise filtered into low-frequency crowd murmur
        // Input 2: white noise filtered into high-frequency microphone hiss
        const crowdVol = (config.crowdNoiseLevel * 0.15).toFixed(3);
        const hissVol = (config.microphoneHissLevel * 0.04).toFixed(3);

        const filterComplex = [
          `[0:a]${baseFilter}[clean_filtered]`,
          `[1:a]lowpass=f=800,volume=${crowdVol}[crowd]`,
          `[2:a]highpass=f=3500,volume=${hissVol}[hiss]`,
          `[clean_filtered][crowd][hiss]amix=inputs=3:duration=first:dropout_transition=2[out]`,
        ].join(";");

        args = [
          "-y",
          "-i",
          cleanAudioPath,
          "-f",
          "lavfi",
          "-i",
          `anoisesrc=d=${Math.ceil(durationSec)}:c=pink:r=48000`,
          "-f",
          "lavfi",
          "-i",
          `anoisesrc=d=${Math.ceil(durationSec)}:c=white:r=48000`,
          "-filter_complex",
          filterComplex,
          "-map",
          "[out]",
          "-c:a",
          "aac",
          "-b:a",
          config.compressionBitrate || "96k",
          "-ar",
          "48000",
          outputDegradedAudioPath,
        ];
      }

      const ffmpeg = spawn("ffmpeg", args);
      let errOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Audio degradation failed with code ${code}: ${errOutput}`));
        }
        resolve();
      });
    });
  }
}

export const audioDegradationEngine = new AudioDegradationEngine();
