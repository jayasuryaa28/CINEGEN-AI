# CINEGEN AI – Project Roadmap

This document outlines the strategic engineering roadmap for upcoming releases of CINEGEN AI.

---

## v1.1 – Hardware Acceleration & WebGPU
- [ ] **WebGPU Inference Backend**: Integrate `@tensorflow/tfjs-backend-webgpu` for native hardware acceleration on Windows (Direct3D 12), macOS (Metal), and Linux (Vulkan).
- [ ] **Apple Silicon Accelerate Framework**: Optimize matrix operations on M1/M2/M3/M4 unified memory architectures.
- [ ] **Multi-GPU Parallel Chunking**: Distribute simultaneous 10-second video chunks across multiple local or cloud GPUs.

---

## v1.2 – Advanced Acoustic Modeling
- [ ] **Diffusion-Based Dereverberation**: Retrain ECHONET with diffusion spectral modeling to achieve > +2.5 dB SDR on severe theatrical room acoustics.
- [ ] **Real-Time Dialogue Transcription**: Generate synchronized SubRip (`.srt`) and WebVTT subtitle tracks directly from STEMNET's isolated dialogue stem.
- [ ] **Dolby 5.1 & 7.1 Surround Upmixing**: Spatial audio expansion utilizing STEMNET's separated dialogue, Foley, and music stems.

---

## v1.3 – Collaborative Studio & Distributed Workers
- [ ] **Multi-Node Cluster Orchestrator**: Peer-to-peer job distribution across multiple local PC workers on a local network (LAN).
- [ ] **Batch Folder Ingestion**: Automated folder watching for film archives with automated queued restoration.
- [ ] **REST Webhook Notifications**: Dispatch webhooks to Discord, Slack, or web servers upon job completion.
