# CINEGEN AI — Phase 12 Open-Source Licensing & Intellectual Property Audit

**Status:** Completed & Audited  
**Date:** 2026-11-21  
**Project Path:** ``  

---

## 1. Executive Summary

A comprehensive legal and licensing audit was conducted across source code, third-party libraries, system utilities, model weights, and training datasets to verify compatibility under the **Apache License 2.0**.

---

## 2. Licensing Inventory by Category

### 2.1 Project Source Code
- **License:** Apache License 2.0
- **Copyright:** (c) 2026 CINEGEN AI Contributors
- **Status:** All original TypeScript, JavaScript, CSS, and documentation files are licensed under Apache 2.0.

### 2.2 Third-Party npm Dependencies
All direct runtime and development dependencies were verified for Apache 2.0 compatibility:

| Package | Version | License | Compatibility with Apache 2.0 |
| :--- | :--- | :---: | :---: |
| `@tensorflow/tfjs` | `^4.22.0` | Apache-2.0 | Fully Compatible |
| `next` | `15.1.7` | MIT | Permissive / Compatible |
| `react` | `^19.0.0` | MIT | Permissive / Compatible |
| `react-dom` | `^19.0.0` | MIT | Permissive / Compatible |
| `lucide-react` | `^0.475.0` | ISC | Permissive / Compatible |
| `clsx` | `^2.1.1` | MIT | Permissive / Compatible |
| `tailwind-merge` | `^3.0.1` | MIT | Permissive / Compatible |
| `uuid` | `^11.1.0` | MIT | Permissive / Compatible |
| `bullmq` | `^5.41.0` | MIT | Permissive / Compatible |
| `ioredis` | `^5.5.0` | MIT | Permissive / Compatible |
| `typescript` | `^5.7.3` | Apache-2.0 | Fully Compatible |
| `tailwindcss` | `^3.4.17` | MIT | Permissive / Compatible |
| `postcss` | `^8.5.2` | MIT | Permissive / Compatible |
| `autoprefixer` | `^10.4.20` | MIT | Permissive / Compatible |

### 2.3 External Media Tools (FFmpeg & FFprobe)
- **License:** LGPL v2.1+ / GPL v2+ (depending on build options).
- **Redistribution Policy:** CINEGEN AI communicates with FFmpeg strictly via standard command-line subprocess execution (`child_process.spawn`). CINEGEN AI does not link against FFmpeg binaries or modify FFmpeg source code. Users supply their own compliant FFmpeg build on their operating system.
- **Compliance:** Full compliance with LGPL/GPL requirements as an external independent program.

### 2.4 Model Checkpoints & Weights
- **Provenance:** All models (CINEVISION, CINEFRAME, NOISENET, STEMNET, ECHONET, VOICENET) were initialized with He Normal / Glorot Uniform random weights and trained natively in JavaScript/TypeScript using synthetic and open creative commons datasets.
- **Pretrained Weights:** **Zero.** No proprietary, commercial, or copyrighted weights were imported.
- **License:** Apache License 2.0 (commercial use permitted).

### 2.5 Training & Evaluation Datasets
- **Clean Ground-Truth Targets:** Open Creative Commons media (Blender Open Movie Project CC-BY 3.0, Pexels/Pixabay CC0 media).
- **Synthetic Degraded Pairs:** Procedurally synthesized degradation (defocus, sensor noise, keystone, audio noise) dedicated to the public domain under CC0 1.0 Universal.
- **Restrictions:** CINEGEN AI does not redistribute unauthorized or copyrighted theatrical film masters.

---

## 3. Legal & Anti-Piracy Statement

CINEGEN AI is engineered exclusively for legitimate media restoration, historical archive preservation, independent filmmaking, and educational research. The developers do not endorse, facilitate, or condone the infringement of copyrighted theatrical motion pictures.
