import { spawn } from "child_process";
import fs from "fs";
import { VideoDegradationConfig } from "@/types/dataset";

export class VideoDegradationEngine {
  /**
   * Builds an FFmpeg complex filtergraph mathematically modeling the physical
   * phenomenon of an unauthorized recording in a cinema/theatre.
   */
  public buildFiltergraph(config: VideoDegradationConfig): string {
    const filters: string[] = [];

    // 1. Perspective & Keystone Distortion
    // Models off-axis camera angle using perspective 4-point bilinear mapping
    if (config.perspectiveIntensity > 0 || config.keystoneDistortion) {
      const p = config.perspectiveIntensity;
      // Coordinates normalized: x0:y0:x1:y1:x2:y2:x3:y3 (top-left, top-right, bottom-left, bottom-right)
      // Displace top edge and lateral edges inward
      const x0 = (p * 0.15).toFixed(3);
      const y0 = (p * 0.10).toFixed(3);
      const x1 = (1.0 - p * 0.15).toFixed(3);
      const y1 = (p * 0.05).toFixed(3);
      const x2 = (p * 0.02).toFixed(3);
      const y2 = (1.0).toFixed(3);
      const x3 = (1.0 - p * 0.02).toFixed(3);
      const y3 = (1.0).toFixed(3);

      filters.push(
        `perspective=x0=${x0}*W:y0=${y0}*H:x1=${x1}*W:y1=${y1}*H:x2=${x2}*W:y2=${y2}*H:x3=${x3}*W:y3=${y3}*H:interpolation=cubic`
      );
    }

    // 2. Camera Tremor / Handheld Shake
    // Simulates natural handheld involuntary micro-movements
    if (config.cameraShake) {
      const speed = config.cameraShakeSpeed || 2.0;
      filters.push(
        `crop=w=in_w-32:h=in_h-24:x='16+10*sin(2*PI*${speed}*t)+4*cos(2*PI*${speed*1.7}*t)':y='12+8*cos(2*PI*${speed*1.3}*t)'`
      );
    }

    // 3. Projector Beat / Flicker
    // Models shutter beat frequency between camera CMOS rolling shutter and projector frame cycle
    if (config.flickerFrequency > 0 && config.flickerAmplitude > 0) {
      const freq = config.flickerFrequency;
      const amp = config.flickerAmplitude;
      filters.push(
        `eq=brightness='${config.brightnessShift}+${amp}*sin(2*PI*${freq}*t)':contrast=${config.contrastScale}`
      );
    } else if (config.brightnessShift !== 0 || config.contrastScale !== 1.0) {
      filters.push(`eq=brightness=${config.brightnessShift}:contrast=${config.contrastScale}`);
    }

    // 4. Color Cast / Spectral Tint
    // Simulates lens coating, projector bulb aging, or digital sensor white balance error
    if (config.colorShift) {
      const { r, g, b } = config.colorShift;
      filters.push(`colorchannelmixer=rr=${r}:gg=${g}:bb=${b}`);
    }

    // 5. Defocus Blur & Optical Softening
    if (config.defocusBlurRadius > 0) {
      filters.push(`boxblur=${config.defocusBlurRadius}:${config.defocusBlurRadius}`);
    }

    // 6. Sensor Shot & Thermal Noise
    if (config.sensorNoiseAmount > 0) {
      const noise = Math.min(100, Math.floor(config.sensorNoiseAmount * 40));
      filters.push(`noise=alls=${noise}:allf=t+u`);
    }

    // 7. Simulated Moiré / Pixel-Mesh Alias
    // Adds high-frequency interference lines when camera sensor aligns with projector matrix pixels
    if (config.moirePattern) {
      filters.push(`drawgrid=width=8:height=8:thickness=1:color=black@0.05`);
    }

    // 8. Simulated Cinema Audience Occlusion (Silhouettes in foreground bottom edge)
    if (config.simulatedOcclusion) {
      // Draw smooth dark curved vignette / silhouette simulating audience heads in the foreground
      filters.push(
        `vignette=angle=PI/4:x0=w/2:y0=h*0.85:mode=backward`
      );
    }

    // 9. Frame-rate Reduction (Simulates dropped frames or low-FPS recording mode)
    if (config.degradedFramerate > 0) {
      filters.push(`fps=${config.degradedFramerate}`);
    }

    // 10. Downscaling to degraded resolution
    filters.push(`scale=${config.downscaleWidth}:${config.downscaleHeight}:flags=bilinear`);

    return filters.join(",");
  }

  /**
   * Applies the degradation filtergraph to a clean source video, saving the degraded output.
   */
  public async renderDegradedVideo(
    inputCleanPath: string,
    outputDegradedPath: string,
    config: VideoDegradationConfig
  ): Promise<void> {
    if (!fs.existsSync(inputCleanPath)) {
      throw new Error(`Clean source video not found at: ${inputCleanPath}`);
    }

    const filtergraph = this.buildFiltergraph(config);

    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        inputCleanPath,
        "-vf",
        filtergraph,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        config.compressionCrf.toString(),
        "-pix_fmt",
        "yuv420p",
        "-an", // Video-only; audio is degraded through the dedicated audio engine
        outputDegradedPath,
      ];

      const ffmpeg = spawn("ffmpeg", args);
      let errOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errOutput += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Video degradation rendering failed (code ${code}): ${errOutput}`));
        }
        resolve();
      });
    });
  }
}

export const videoDegradationEngine = new VideoDegradationEngine();
