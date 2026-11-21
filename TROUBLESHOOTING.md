# CINEGEN AI – Troubleshooting Guide

---

## 1. Common Installation & Startup Issues

### Issue: `ffmpeg` or `ffprobe` not found
- **Symptom**: Console logs show `FFmpeg is not installed or accessible in local environment.`
- **Cause**: FFmpeg executable directory is not in your system `PATH`.
- **Solution**:
  - Windows: Verify `C:\ffmpeg\bin` (or your installation path) is listed in System Environment Variables under `Path`. Open a new command prompt and type `ffmpeg -version`.
  - macOS: Run `brew install ffmpeg`.
  - Linux: Run `sudo apt install -y ffmpeg`.

### Issue: EPERM or mkdir file lock during `npm run build`
- **Symptom**: `Error: EPERM: operation not permitted, mkdir '.next\server\...'` on Windows.
- **Cause**: Windows file locking race condition when Webpack worker threads attempt to create identical nested directories concurrently.
- **Solution**: CINEGEN AI includes an automated `prebuild` hook (`node scripts/prebuild.js`) and `cleanDistDir: false` configuration in `next.config.ts` to pre-generate directory structures and eliminate this race condition. If encountered during manual customization, running `npm run build` again cleanly completes the build.

---

## 2. Audio & Video Processing Issues

### Issue: Process seems slow on CPU
- **Symptom**: A 10-minute video takes 30–45 minutes to process.
- **Cause**: Neural network inference on CPU is computationally intensive.
- **Solution**:
  - Lower the target resolution to `720p` or `1080p`.
  - In `/compute`, verify Concurrency is set to `1 Worker` to prevent CPU throttling.
  - Connect a RunPod or Vast.ai personal API key to process on an RTX 4090 GPU in ~2.5 minutes.

### Issue: Out of Memory during large video chunking
- **Symptom**: Node.js process terminates or restarts.
- **Cause**: Free RAM dropped below 1.5GB while processing large 4K frames.
- **Solution**:
  - In `/compute`, set your **Memory Safety Floor** to `2.5 GB` or `3.0 GB`. CINEGEN AI will automatically throttle the batch size to `1` and invoke garbage collection.
  - Close background applications to free host RAM.

### Issue: Audio out of sync on original camera bootleg
- **Symptom**: Dialogue does not match mouth movements on input video.
- **Cause**: Variable Frame Rate (VFR) timestamp jitter or initial audio delay from recording device.
- **Solution**:
  - CINESYNC automatically detects and conforms VFR jitter to clean constant framerate (`fps=fps=N`) and offsets initial delay.
  - Inspect the CINESYNC Timeline Report in the job dashboard for detected offset details.
