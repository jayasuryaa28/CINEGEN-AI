# CINEGEN AI – Release Notes (v1.0.0-rc1)

We are thrilled to announce the Release Candidate of **CINEGEN AI v1.0.0-rc1**, an open-source, full-stack neural media restoration suite engineered entirely in **JavaScript and TypeScript**.

---

## Highlights

### 1. Pure JavaScript / TypeScript Architecture
CINEGEN AI eliminates the need for Python runtimes, external AI APIs, or proprietary SDKs. Neural inference, audio DSP, video slicing, and web orchestration run natively in Node.js via TensorFlow.js.

### 2. Dual Compute Engine: Own PC or Personal Cloud GPU
- **Own PC Mode**: 100% private, zero-cost processing on your computer's CPU or GPU with automated memory safety and dynamic batch sizing.
- **Cloud GPU Mode**: Connect your personal RunPod or Vast.ai account using your own API key. Pay provider rates directly (~$0.20 to $0.34/hr for RTX 3090/4090) with zero markup.

### 3. CINEFRAME Video Restoration & Super-Resolution
Our multi-scale residual CNN achieves **+7.36 dB PSNR** over standard sharpening filters and **0.9911 SSIM** without edge ringing or temporal flicker.

### 4. NOISENET & STEMNET Audio AI
- **NOISENET**: +1.66 dB SDR gain suppressing audience noise, mic hiss, and electrical hum while preserving speech intelligibility.
- **STEMNET**: 4-stem harmonic separation into dialogue, music, Foley, and ambience with 50.0 dB energy conservation.

### 5. CINESYNC & Dual-Audio Fallback
Guarantees 0.00 ms audio-video presentation timestamp offset across variable and constant frame rate inputs. Every export bundles the enhanced audio as primary track 0 and the bit-exact original audio as track 1 for instant comparison in any player.

### 6. Zero-Trust Security & Cost Protection
- Server-side **AES-256-GCM** encryption at rest.
- Interactive user approval gate required prior to any cloud provisioning.
- Double-check teardown verification to prevent orphaned instances and runaway billing.
- Automatic cloud-to-local fallback if remote cloud instances fail.

---

## Upgrade & Installation

```bash
git clone https://github.com/cinegen-ai/cinegen-ai.git
cd cinegen-ai
npm install
cp .env.example .env
npm run build
npm run start
```
Open `http://localhost:3000` to begin restoring video.
