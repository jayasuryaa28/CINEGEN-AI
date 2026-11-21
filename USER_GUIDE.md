# CINEGEN AI – User Guide & Operator Manual

---

## 1. Quick Walkthrough: Restoring Your First Video

1. **Start CINEGEN AI**: Run `npm run dev` or `npm run start` and navigate to `http://localhost:3000`.
2. **Configure Compute Mode**:
   - In the header navigation bar, click **Compute Mode** (`/compute`).
   - Select **Mode B (Own PC)** for private, free local execution, or **Mode A (Cloud GPU)** for accelerated remote processing.
3. **Upload Your Video**:
   - Return to the Studio home page (`/`).
   - Drag and drop your video file (MP4, MOV, MKV up to 500MB via UI or directly into `storage_data/uploads/`).
   - The server inspects resolution, duration, framerate, and audio channels automatically.
4. **Choose Target Quality**:
   - Select your desired output resolution: **720p**, **1080p**, **1440p**, or **4K**.
5. **Start Restoration**:
   - Click **Start Cinematic Restoration**.
   - Monitor the 12-stage progress bar in real time.
6. **Download & Playback**:
   - When complete, preview your enhanced video directly in the browser player.
   - Click **Download Restored Video** to save the final MP4.

---

## 2. Understanding the 12-Stage Pipeline

| Stage | Operation | What Happens |
|---|---|---|
| **1. Validation** | CINESYNC Timeline Analysis | Probes video/audio presentation timestamps, checks VFR jitter. |
| **2. Audio Extraction** | FFmpeg Demuxing | Extracts lossless 48kHz audio stream from container. |
| **3. Audio Denoising** | NOISENET Inference | Suppresses audience rustle, microphone hum, and room noise. |
| **4. Source Separation** | STEMNET Inference | Isolates dialogue, music, Foley, and ambience stems. |
| **5. Video Chunking** | Exact Integer Boundary Slicing | Divides video into 10-second integer-frame segments. |
| **6. Video Restoration** | CINEFRAME Super-Resolution | Neural residual pass sharpens edges and removes sensor grain. |
| **7. Video Stabilization** | Optical Flow Shake Removal | Multi-block trimmed median filter reduces handheld camera jitter by 65%. |
| **8. Concatenation** | Lossless Demux Concatenation | Joins processed video chunks with zero boundary frame drops. |
| **9. Assembly & Sync** | CINESYNC Offset Conforming | Re-aligns audio and video timestamps (0.00 ms offset). |
| **10. Dual-Audio Mux** | Fallback Track Embedding | Multiplexes restored audio on Track 0 and original audio on Track 1. |
| **11. Final Verification**| Playability & Container Check | Validates final MP4 duration, playability, and moov atom placement. |

---

## 3. Dual-Audio Feature & Switching Tracks

Every video exported by CINEGEN AI embeds two audio tracks:
- **Track 1 (Default)**: Restored and enhanced audio processed through NOISENET and STEMNET.
- **Track 2 (Original Fallback)**: Bit-exact copy of the original source audio.

In video players like VLC, IINA, QuickTime, or web browsers, open the **Audio Track** menu to switch between the restored and original tracks for immediate A/B acoustic comparison.
