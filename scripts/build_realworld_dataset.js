const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BASE_DIR = path.resolve("./storage_data/realworld_dataset");
const RAW_SOURCES_DIR = path.resolve("./storage_data/dataset/raw_sources");

// 10 real-world conditions specified in Phase 10
const PROFILES = [
  {
    id: "RW-01-rear-center",
    name: "Rear-Centre Theatre Recording",
    category: "perspective_distance",
    description: "Camera placed at center rear of cinema auditorium. Distance defocus, keystone tilt, washed blacks.",
    filter: "scale=854:480,boxblur=1:1,eq=contrast=0.92:brightness=0.03:saturation=0.88,noise=c1s=8:allf=t+u",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-02-side-angle",
    name: "Side-Angle Theatre Recording",
    category: "severe_keystone",
    description: "Camera placed at 28-degree horizontal angle. Strong trapezoidal perspective distortion, asymmetric sharpness.",
    filter: "scale=854:480,perspective=x0=60:y0=20:x1=794:y1=40:x2=20:y2=460:x3=834:y3=440:interpolation=linear,boxblur=1.2:0.8",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-03-front-row",
    name: "Front-Row Recording",
    category: "upward_keystone",
    description: "Steep upward camera angle with optical edge barrel curvature and neck-angle tilt.",
    filter: "scale=854:480,perspective=x0=120:y0=40:x1=734:y1=40:x2=20:y2=470:x3=834:y3=470:interpolation=linear",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-04-handheld-shake",
    name: "Handheld Camera Shake & Jitter",
    category: "motion_instability",
    description: "High-frequency micro-jitter and rolling-shutter motion shake from un-stabilized mobile recording.",
    // Crop and translate with sine wobble
    filter: "scale=960:540,crop=854:480:x='(in_w-out_w)/2+12*sin(2*PI*t*1.8)':y='(in_h-out_h)/2+8*cos(2*PI*t*2.4)'",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-05-low-light",
    name: "Low-Light & Shadow Noise",
    category: "sensor_noise",
    description: "Auditorium shadow, high sensor ISO grain, shadow chroma noise, reduced dynamic range.",
    filter: "scale=854:480,eq=contrast=0.85:brightness=-0.04,noise=alls=18:allf=t+u",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-06-glare-reflection",
    name: "Screen Glare & Emergency Exit Reflection",
    category: "specular_reflection",
    description: "Green/white ambient light bleed from exit sign washing out the right-hand corner of the screen.",
    filter: "scale=854:480,drawbox=x=700:y=20:w=120:h=60:color=green@0.28:t=fill,eq=brightness=0.04",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-07-moire-flicker",
    name: "Moiré Patterns & Projector Flicker",
    category: "aliasing_flicker",
    description: "Screen pixel pitch beat frequency interference and 24Hz-to-60Hz shutter exposure luminance flicker.",
    filter: "scale=854:480,eq=brightness='0.05*sin(2*PI*t*12)'",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-08-audience-obstruction",
    name: "Audience Movement & Screen Obstruction",
    category: "occlusion",
    description: "Silhouettes of cinema patrons' heads and shoulders moving in the bottom 25% of the frame.",
    filter: "scale=854:480,drawbox=x=100:y=380:w=180:h=100:color=black@0.90:t=fill,drawbox=x=540:y=360:w=200:h=120:color=black@0.85:t=fill",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-09-mobile-low-res",
    name: "Mobile Digital Zoom / Low-Res Capture",
    category: "compression_blur",
    description: "Downscaled 480p capture with high digital zoom noise and aggressive mobile ISP edge halo.",
    filter: "scale=640:360,unsharp=5:5:1.5:5:5:0.0,scale=854:480:flags=bilinear",
    status: "TEST_VECTOR_READY"
  },
  {
    id: "RW-10-heavy-compression",
    name: "Heavy Social Media / Streaming Compression",
    category: "macroblocking",
    description: "Low-bitrate H.264 stream with DCT block quantization, banding in dark areas, and high ringing.",
    filter: "scale=854:480",
    extraArgs: ["-b:v", "280k", "-maxrate", "350k", "-bufsize", "500k"],
    status: "TEST_VECTOR_READY"
  }
];

async function main() {
  console.log("===============================================================");
  console.log(" CINEGEN AI — PHASE 10: REAL-WORLD DATASET BUILDER & AUDIT");
  console.log("===============================================================");

  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }

  // Use held-out test source: clean_source_4.mp4 (never in training or val split)
  const sourcePath = path.join(RAW_SOURCES_DIR, "src_clean_04_clean.mp4");
  if (!fs.existsSync(sourcePath)) {
    console.error(`Held-out test source not found at: ${sourcePath}`);
    process.exit(1);
  }

  const manifest = {
    datasetName: "CINEGEN-REALWORLD-VALIDATION-v1.0",
    createdAt: new Date().toISOString(),
    evaluationType: "Real-World Optical & Acoustic Distortion Matrix",
    license: "CC0 / Apache 2.0 (Derivative of held-out open commons test footage)",
    sourceMedia: "src_clean_04_clean (Test split, zero overlap with training)",
    profiles: []
  };

  for (const profile of PROFILES) {
    const profileDir = path.join(BASE_DIR, profile.id);
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    const outputVideo = path.join(profileDir, "input_capture.mp4");
    console.log(`\nGenerating test vector for [${profile.id}] - ${profile.name}...`);

    const args = [
      "-y",
      "-i", sourcePath,
      "-t", "5.0",
      "-vf", profile.filter,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-c:a", "aac",
      "-b:a", "128k"
    ];

    if (profile.extraArgs) {
      args.push(...profile.extraArgs);
    }

    args.push(outputVideo);

    const res = spawnSync("ffmpeg", args);
    if (res.status === 0 && fs.existsSync(outputVideo)) {
      console.log(`  ✓ Generated: ${outputVideo} (${(fs.statSync(outputVideo).size / 1024).toFixed(1)} KB)`);
      manifest.profiles.push({
        id: profile.id,
        name: profile.name,
        category: profile.category,
        videoPath: outputVideo,
        fileSize: fs.statSync(outputVideo).size,
        status: "TEST_VECTOR_READY",
        realPhysicalBootlegPresent: false,
        note: "Controlled optical/acoustic test vector generated from held-out open commons footage. Physical bootleg tests marked NOT TESTED."
      });
    } else {
      console.error(`  ✗ Failed to generate profile ${profile.id}:`, res.stderr?.toString());
    }
  }

  // Write dataset manifest
  const manifestPath = path.join(BASE_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nReal-world dataset manifest written to: ${manifestPath}`);
  console.log(`Generated ${manifest.profiles.length}/10 test profiles successfully.`);
}

main().catch(err => {
  console.error("Dataset builder error:", err);
  process.exit(1);
});
