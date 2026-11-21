# CINESYNC — Audio-Video Synchronization & Media Integration Engine

CINESYNC is the core media synchronization and integration engine of CINEGEN AI. It unifies the outputs of CINEVISION (screen geometry), CINEFRAME (video restoration & super-resolution), and the hardened Audio AI system (NOISENET & STEMNET) into broadcast-compliant, perfectly synchronized multimedia deliverables.

---

## 1. Architecture Overview

```
                                  +-----------------------+
                                  |   Raw Uploaded Media  |
                                  +-----------+-----------+
                                              |
                       +----------------------+----------------------+
                       |                                             |
           +-----------v-----------+                     +-----------v-----------+
           |  Video Stream (Demux) |                     |  Audio Stream (Demux) |
           +-----------+-----------+                     +-----------+-----------+
                       |                                             |
           +-----------v-----------+                     +-----------v-----------+
           |       CINEVISION      |                     |   NOISENET / STEMNET  |
           |   Geometry & Quality  |                     |   Speech / Separation |
           +-----------+-----------+                     +-----------+-----------+
                       |                                             |
           +-----------v-----------+                     +-----------v-----------+
           |       CINEFRAME       |                     |    Restored Master    |
           | Super-Res & Sharpness |                     |   Audio Track (48kHz) |
           +-----------+-----------+                     +-----------+-----------+
                       \                                             /
                        \                                           /
                         +-----------------+-----------------------+
                                           |
                               +-----------v-----------+
                               |     CINESYNC ENGINE   |
                               |  Timeline & Sync Plan |
                               +-----------+-----------+
                                           |
                         +-----------------+-----------------------+
                         |                                         |
             +-----------v-----------+                 +-----------v-----------+
             |    Master Track 1     |                 |    Fallback Track 2   |
             |   Restored Audio      |                 |    Original Audio     |
             |  (AAC 320k, 48 kHz)   |                 |      (Bit-for-Bit)    |
             +-----------+-----------+                 +-----------+-----------+
                         \                                         /
                          \                                       /
                           +---------------+---------------------+
                                           |
                               +-----------v-----------+
                               | Final MP4 Media File  |
                               |  (FastStart Web/Play) |
                               +-----------------------+
```

---

## 2. Core Modules

### `TimelineAnalyzer` (`src/ai/cinesync/timeline.ts`)
- **Container & Stream Metadata:** Inspects video/audio codecs, nominal vs average FPS, dimensions, channels, sample rate, and durations.
- **PTS Presentation Order Inspection:** Probes true decoded presentation timestamps (`frame=pts_time`) rather than decode/DTS order, correctly accounting for H.264 B-frames.
- **VFR & Jitter Detection:** Calculates frame interval variance and maximum jitter. If variance exceeds $10^{-4}$ or nominal/average FPS differs by $> 0.1$, flags Variable Frame Rate (`isVfr: true`).
- **Initial Offset & Priming Normalization:** Computes $(PTS_{audio} - PTS_{video}) \times 1000$ in milliseconds. Normalizes AAC encoder priming delays ($[-30\text{ ms}, 0\text{ ms}]$) using container edit lists (`elst`).
- **Clock Drift Measurement:** Measures drift rate and drift rate in ms/hour:
  $$\text{driftRate} = \frac{\text{Duration}_{audio} - \text{Duration}_{video}}{\text{Duration}_{video}}$$

### `CineSyncEngine` (`src/ai/cinesync/engine.ts`)
- **Audio-Visual Cross-Correlation (`calculateOffset`):** Computes visual scene motion energy against audio RMS envelope over sliding lag windows to estimate synchronization offset.
- **Rule-Based Sync Plan Synthesis (`buildSyncPlan`):**
  - **Preserve:** When $|\Delta t| < 15\text{ ms}$ and not VFR, streams are preserved without resampling.
  - **Align Offset:** When $|\Delta t| \ge 15\text{ ms}$, applies `atrim` (to advance delayed audio) or `adelay` (to delay early audio).
  - **Conform Drift / VFR:** Applies `aresample=async=1000:first_pts=0` and `fps=fps=targetFps`.
- **Chunk Boundary Partitioning (`calculateChunkBoundaries`):**
  Computes integer frame and sample boundaries across arbitrary video lengths (up to 4 hours) guaranteeing:
  - $\text{chunk}[i].\text{endFrame} == \text{chunk}[i+1].\text{startFrame}$
  - $\text{chunk}[i].\text{endSample} == \text{chunk}[i+1].\text{startSample}$
  - Zero dropped frames, zero duplicated frames, zero sample discontinuities.
- **Media Assembly with Dual Audio Fallback (`assembleFinalMedia`):**
  Multiplexes restored video, CINEGEN Master Audio (Track 1, `aac 320k`), and Original Source Audio as fallback (Track 2, `copy`), applying `+faststart` for instant web streaming.

### `CineSyncValidator` (`src/ai/cinesync/validator.ts`)
Automated compliance checker validating:
1. Video stream presence and decoding playability.
2. Master audio stream presence and decoding playability.
3. Fallback audio track accessibility.
4. Duration preservation within $\le 0.15$ seconds.
5. Monotonic timestamp continuity (no packet gaps or negative steps).
6. Synchronization offset within cinema tolerance ($\le 25.0$ ms).
7. Audio clipping ($< 0.999$) and silent gap absence ($RMS > 10^{-4}$).

---

## 3. Usage & Integration

```typescript
import { timelineAnalyzer } from "./src/ai/cinesync/timeline";
import { cineSyncEngine } from "./src/ai/cinesync/engine";
import { cineSyncValidator } from "./src/ai/cinesync/validator";

// 1. Analyze Timeline
const timeline = await timelineAnalyzer.analyzeTimeline("input.mp4");

// 2. Synthesize Plan
const syncPlan = cineSyncEngine.buildSyncPlan(timeline);

// 3. Assemble Media with Fallback Stream
const exportResult = await cineSyncEngine.assembleFinalMedia({
  restoredVideoPath: "restored_video.mp4",
  processedAudioPath: "restored_master_audio.wav",
  originalSourcePath: "input.mp4",
  finalOutputPath: "final_master.mp4",
  syncPlan,
});

// 4. Validate Final Export
const audit = await cineSyncValidator.validateFinalExport("final_master.mp4", timeline.formatDuration);
console.log(`Audit result: ${audit.isValid ? "PASS" : "FAIL"}`);
```
