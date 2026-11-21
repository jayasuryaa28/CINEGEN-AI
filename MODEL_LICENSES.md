# CINEGEN AI – Model Licensing & Provenance

---

## 1. Provenance & Originality Guarantee

All neural models included in CINEGEN AI were engineered, initialized, and trained strictly under cleanroom conditions:
- **Zero Pretrained Weights**: No weights or feature extractors were imported or transferred from proprietary, copyrighted, or commercial models.
- **Random Initialization**: All model layers were initialized using He Normal / Glorot Uniform distributions.
- **Pure JavaScript / TypeScript**: All network topologies, forward inference routines, and loss functions were authored natively for TensorFlow.js.

---

## 2. Model License Matrix

| Model Component | Primary Task | Weights Location | License | Commercial Use |
|---|---|---|:---:|:---:|
| **CINEVISION** | Screen detection, perspective & blur estimation | `storage_data/checkpoints/cinevision/best` | Apache 2.0 | Permitted |
| **CINEFRAME** | Video super-resolution & temporal restoration | `storage_data/checkpoints/cineframe/best` | Apache 2.0 | Permitted |
| **NOISENET** | Cinema audience & microphone denoising | `storage_data/checkpoints/audio_hardened/noisenet/best` | Apache 2.0 | Permitted |
| **STEMNET** | 3-stem harmonic audio source separation (Dialogue, Music, Sound Effects) | `storage_data/checkpoints/audio_hardened/stemnet/best` | Apache 2.0 | Permitted |
| **ECHONET** (Bypassed) | Room acoustic dereverberation | `storage_data/checkpoints/audio_hardened/echonet/best` | Apache 2.0 | Permitted |
| **VOICENET** (Bypassed) | Dialogue formant clarity enhancement | `storage_data/checkpoints/audio_hardened/voicenet/best` | Apache 2.0 | Permitted |

---

## 3. Terms of Use & Redistribution

You may freely redistribute, fine-tune, export, and embed these model checkpoints in open-source or commercial applications under the terms of the Apache License 2.0, provided that attribution is preserved.
