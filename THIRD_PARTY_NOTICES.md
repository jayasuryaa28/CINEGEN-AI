# CINEGEN AI – Third-Party Notices & Dependencies

This document provides notices and license information for open-source software packages utilized by CINEGEN AI.

---

## 1. Runtime & Machine Learning Dependencies

### TensorFlow.js (`@tensorflow/tfjs`)
- **License**: Apache License 2.0
- **Copyright**: The TensorFlow Authors
- **Description**: Hardware-agnostic neural network computation engine.

### Next.js (`next`)
- **License**: MIT License
- **Copyright**: Vercel, Inc.
- **Description**: React web framework and API route handler.

### React & React-DOM (`react`, `react-dom`)
- **License**: MIT License
- **Copyright**: Meta Platforms, Inc.
- **Description**: Frontend user interface library.

### BullMQ (`bullmq`)
- **License**: MIT License
- **Copyright**: Taskforce.sh Inc.
- **Description**: Resilient task queuing and distributed job scheduling.

### ioredis (`ioredis`)
- **License**: MIT License
- **Copyright**: Zihua Li
- **Description**: High-performance Redis client for Node.js.

### Lucide React (`lucide-react`)
- **License**: ISC License
- **Copyright**: Lucide Contributors
- **Description**: Open-source icon library.

### Tailwind CSS (`tailwindcss`)
- **License**: MIT License
- **Copyright**: Tailwind Labs, Inc.
- **Description**: Utility-first CSS styling framework.

---

## 2. External System Dependencies & Codec Compliance

### FFmpeg (`ffmpeg`, `ffprobe`)
- **Copyright**: The FFmpeg Developers
- **Upstream License**: LGPL v2.1+ (or GPL v2+ / GPL v3+ when compiled with GPL-enabled codecs such as `libx264`, `libx265`, or `xvidcore`).
- **Notice on Subprocess Execution & Distribution**:
  - CINEGEN AI's original application and TypeScript source code is licensed under the Apache License 2.0.
  - CINEGEN AI executes FFmpeg purely as an external command-line child process via standard OS process interfaces (`child_process.spawn`). CINEGEN AI contains no static or dynamic C/C++ library linkage against FFmpeg (`libavcodec`, `libavformat`, `libavutil`), nor does it modify FFmpeg source code.
  - **No FFmpeg Binaries Distributed**: CINEGEN AI does not package, distribute, or bundle FFmpeg binaries. Users must install their own compliant FFmpeg build on their operating system.
  - **Downstream Compliance Responsibility**: Any downstream distributor or user who packages, bundles, or redistributes a compiled FFmpeg binary alongside CINEGEN AI must independently ensure compliance with the specific build flags and licenses of that binary (e.g. GPL v2/v3 if compiled with `libx264`). CINEGEN AI provides no indemnification for downstream codec distribution.
