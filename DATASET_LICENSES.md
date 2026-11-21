# CINEGEN AI – Dataset Licensing & Data Provenance

---

## 1. Dataset Overview

The CINEGEN AI training and benchmark dataset consists of:
1. **Clean High-Resolution Video Targets**: Open-access creative commons film sequences from the Blender Open Movie Project (CC-BY 3.0 / CC-BY 4.0) and CC0 stock footage (Pexels / Pixabay).
2. **Synthetic Degraded Pairs**: Programmatically degraded frames simulating theatre camera recordings (lens defocus, Gaussian sensor noise, luminance flicker, and geometric keystone distortion).
3. **Audio Stems**: Multi-track synthesized audio sequences consisting of isolated dialogue, music, sound effects, and audience noise.

---

## 2. Licensing by Component

| Dataset Component | Source Origin | License | Redistribution & Attribution Restrictions |
|---|---|:---:|---|
| **Clean Video Targets** | Blender Foundation / Open Commons | CC-BY 3.0 / CC-BY 4.0 / CC0 | Requires attribution to respective creators (see Section 3) |
| **Degraded Paired Frames** | Programmatically synthesized | CC0 1.0 Universal | Free public domain dedication |
| **Paired Audio Stems** | Procedurally synthesized | CC0 1.0 Universal | Free public domain dedication |
| **Annotation Manifests** | CINEGEN AI Metadata | Apache 2.0 | Free redistribution with project attribution |

---

## 3. Open Creative Commons Media Attributions

CINEGEN AI acknowledges and credits the following open-source creative works utilized for benchmarking and training pair synthesis:

- **Elephants Dream** (2006) — (c) copyright 2006, Blender Foundation / Netherlands Media Art Institute / www.elephantsdream.org — Licensed under CC-BY 2.5 / CC-BY 3.0.
- **Big Buck Bunny** (2008) — (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org — Licensed under Creative Commons Attribution 3.0.
- **Sintel** (2010) — (c) copyright 2010, Blender Foundation / durian.blender.org — Licensed under Creative Commons Attribution 3.0.
- **Tears of Steel** (2012) — (c) copyright 2012, Blender Foundation / mango.blender.org — Licensed under Creative Commons Attribution 3.0.

Note: Raw source video files (`clean_source_*.mp4`) are excluded from repository tracking via `.gitignore` to minimize clone size. Developers generating datasets locally must preserve these attributions.

---

## 4. Ethical Use & Anti-Piracy Guidelines

CINEGEN AI's models and datasets are developed for legitimate media restoration, historical film preservation, independent cinema remastering, and archival recovery. The project does not endorse, facilitate, or condone the infringement of copyrighted theatrical motion pictures.
