# CINEGEN AI — Phase 2: Dataset Engineering & Synthetic Theatre Degradation Documentation

> **Platform:** CINEGEN AI (Open-source JavaScript AI Platform)  
> **Status:** Phase 2 Complete & Verified  
> **Rule Adherence:** Pure JavaScript / Node.js. No Python. No external AI APIs. No pre-trained weights.

---

## 1. Dataset Architecture & Objectives

To train CINEGEN AI models (such as `CINEVISION`, `CINEFRAME`, `NOISENET`, `STEMNET`, etc.) from **randomly initialized weights** without external pretrained weights or third-party APIs, the platform requires mathematically rigorous, paired datasets:

```
[Clean Master Source Video (1080p/4K) + 48kHz Stereo Audio]
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
   [Clean Ground Truth Target]   [Synthetic Degradation Engine]
     - Full resolution (1080p)     - Video degradation pipeline
     - 48kHz uncompressed audio    - Audio degradation pipeline
                                         │
                                         ▼
                               [Degraded Training Sample]
                                 - Distorted perspective / keystone
                                 - Camera shake & motion blur
                                 - Projector flicker & sensor noise
                                 - Bandpass mic cut & room echo
                                 - Synthesized crowd ambience
```

### Zero Data Leakage Protocol
All dataset splits (`train`, `val`, `test`) are assigned **strictly at the source video level**, not the sample level. If a video source is designated for `test`, none of its degraded permutations will ever appear in `train` or `val`.

---

## 2. Synthetic Degradation Capabilities

### Video Degradation Engine (`src/dataset/videoDegradation.ts`)
| Degradation Feature | Physical Phenomenon Modeled | FFmpeg / JS Mathematical Implementation |
| :--- | :--- | :--- |
| **Perspective & Keystone** | Off-center cinema seat viewing angles | Bilinear 4-point perspective warp with cubic interpolation. |
| **Camera Tremor / Shake** | Involuntary micro-tremors in handheld phone/camcorder | Multi-harmonic sinusoidal dynamic crop offset (`sin(2πft) + cos(2πf't)`). |
| **Projector Flicker / Beat** | Beat frequency between camera rolling shutter and cinema projector | Periodic luminance multiplier (`eq=brightness='B + A*sin(2πft)':contrast=C`). |
| **Defocus & Motion Blur** | Lens focus hunting & slow shutter exposure | Symmetrical multi-pass optical box blur (`boxblur=r:r`). |
| **Sensor Noise** | Low-light CMOS sensor shot & thermal read noise | Dynamic temporal noise injection (`noise=alls=N:allf=t+u`). |
| **Moiré Pattern** | Pixel grid interference between projector matrix and camera sensor | High-frequency orthogonal grid overlay (`drawgrid`). |
| **Simulated Occlusion** | Audience heads/seats partially obscuring screen in foreground | Backward non-linear curved bottom vignette (`vignette=angle=PI/4:y0=h*0.85`). |
| **Color Cast** | Projector lamp aging or auto-white balance drift | Linear color channel scaling (`colorchannelmixer=rr=R:gg=G:bb=B`). |
| **Compression & Downscale** | Low-bitrate recording & downsampling | High CRF H.264 macroblocking (`-crf 32-40`) + bilinear downscale. |

### Audio Degradation Engine (`src/dataset/audioDegradation.ts`)
| Degradation Feature | Physical Phenomenon Modeled | FFmpeg / Audio DSP Implementation |
| :--- | :--- | :--- |
| **Acoustic Reverberation** | Large cinema hall reflection tail (RT60 up to 2.5s) | Multi-tap acoustic delay network (`aecho=0.8:0.85:delays:decays`). |
| **Microphone Bandpass** | Tiny microphone capsule frequency limitations | Dual-pole highpass (low-cut @ 120-220Hz) and lowpass (high-cut @ 5.5-7.5kHz). |
| **Dynamic Range Compression** | Automatic Gain Control (AGC) pumping in portable recorders | Differentiable non-linear dynamic range compressor (`acompressor`). |
| **Transducer Saturation** | Loud audio transients overloading microphone pre-amp | Overdrive volume boost with hard brickwall limiting (`alimiter`). |
| **Crowd & Hiss Injection** | Audience shuffling, whispering, air-con, and preamp hiss | Multi-source filtered pink noise (murmur) and white noise (thermal hiss) mixing via `amix`. |

---

## 3. Dataset Management Tools

### 1. Graphical Dataset Studio Interface
- Available directly in the application at **`/dataset`**
- **Live Statistics:** Total pairs, train/val/test split distribution, authorized sources, and license status.
- **Side-by-Side Video & Audio Player:** Synchronized comparison of clean master ground truth against degraded training samples.
- **One-Click Integrity Validator:** Runs automated sanity checks across all sample pairs.

### 2. Command-Line Dataset Tool (`scripts/dataset_cli.js`)
```bash
# List all registered sources and paired samples
node scripts/dataset_cli.js list

# Import an authorized clean video source (auto-extracts 48kHz audio target)
node scripts/dataset_cli.js import <videoPath> "License String" [train|val|test]

# Generate a degraded sample pair using a specific profile
node scripts/dataset_cli.js generate <sourceId> auditorium_rear_center

# Run automated deep quality checks across all pairs
node scripts/dataset_cli.js validate

# Export a clean, reproducible dataset manifest
node scripts/dataset_cli.js export storage_data/dataset/export.json
```

---

## 4. Verification & Integrity Checklist

- [x] **Import clean source video:** Extracts master 48kHz stereo WAV and registers source with split.
- [x] **Extract audio automatically:** Zero user manual audio upload required.
- [x] **Render multiple degraded versions:** Synthetic perspective, keystone, blur, noise, flicker, room echo, crowd noise, and mic attenuation rendered deterministically.
- [x] **Preserve clean ground truth targets:** Clean videos and audio targets stored with cryptographic sample IDs.
- [x] **Generate complete metadata:** Manifest records every degradation coefficient, timestamps, resolutions, and codecs.
- [x] **Validate dataset integrity:** `datasetValidator` inspects file existence, duration matches, valid resolutions, and non-empty audio streams.
- [x] **Export reproducible manifest:** Full JSON dataset manifests exported with zero data leakage.
