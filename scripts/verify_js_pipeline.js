const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

async function probeVideo(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Not found: ${filePath}`);
  const stat = await fs.promises.stat(filePath);

  return new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    let output = "";
    probe.stdout.on("data", (d) => (output += d.toString()));
    probe.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed with code ${code}`));
      const data = JSON.parse(output);
      const videoStream = data.streams.find((s) => s.codec_type === "video");
      const audioStream = data.streams.find((s) => s.codec_type === "audio");
      resolve({
        filename: path.basename(filePath),
        filesize: stat.size,
        duration: parseFloat(data.format.duration || "0"),
        width: parseInt(videoStream.width || "0", 10),
        height: parseInt(videoStream.height || "0", 10),
        videoCodec: videoStream.codec_name,
        audioCodec: audioStream ? audioStream.codec_name : null,
        hasAudio: !!audioStream,
      });
    });
  });
}

async function extractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2",
      outputPath,
    ]);
    proc.on("close", (code) => (code === 0 ? resolve(outputPath) : reject(new Error("Audio extract failed"))));
  });
}

async function segmentVideo(inputPath, outPattern) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-c", "copy", "-map", "0:v:0",
      "-f", "segment", "-segment_time", "2", "-reset_timestamps", "1",
      outPattern,
    ]);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Segment failed"))));
  });
}

async function processChunk(inChunk, outChunk, targetW, targetH) {
  return new Promise((resolve, reject) => {
    const filter = `scale=${targetW}:${targetH}:flags=lanczos,unsharp=5:5:0.5:5:5:0.0`;
    const proc = spawn("ffmpeg", [
      "-y", "-i", inChunk,
      "-vf", filter,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-an",
      outChunk,
    ]);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Chunk process failed"))));
  });
}

async function mergeChunks(concatList, outVideo) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatList,
      "-c", "copy", outVideo,
    ]);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Merge failed"))));
  });
}

async function multiplexFinal(videoPath, audioPath, finalOut) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", videoPath, "-i", audioPath,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest",
      "-movflags", "+faststart", finalOut,
    ]);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Multiplex failed"))));
  });
}

async function main() {
  console.log("=== CINEGEN AI: VERIFYING END-TO-END VIDEO PIPELINE ===");

  const testVideo = path.resolve("./test_input.mp4");
  const scratchDir = path.resolve("./storage_data/test_run");
  const chunksDir = path.join(scratchDir, "chunks");

  if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

  // 1. Probe input
  console.log("\n[1/5] Server-side FFprobe Inspection...");
  const meta = await probeVideo(testVideo);
  console.log("Detected source:", meta);

  // 2. Audio extraction
  console.log("\n[2/5] Auto-Extracting 48kHz Master Audio...");
  const audioWav = path.join(scratchDir, "master.wav");
  await extractAudio(testVideo, audioWav);
  console.log("✓ Extracted master audio to:", audioWav);

  // 3. Video segmentation
  console.log("\n[3/5] Chunk-based Video Segmentation (Memory-Safe)...");
  const chunkPattern = path.join(chunksDir, "chunk_%03d.mp4");
  await segmentVideo(testVideo, chunkPattern);

  const chunkFiles = fs.readdirSync(chunksDir).filter((f) => f.startsWith("chunk_") && f.endsWith(".mp4")).sort();
  console.log(`✓ Created ${chunkFiles.length} independent video chunks.`);

  // 4. Upscaling each chunk to 1080p (Lanczos + Unsharp)
  console.log("\n[4/5] Processing Chunks to Target Resolution (1080p Full HD)...");
  const processedChunks = [];
  for (const chunk of chunkFiles) {
    const inC = path.join(chunksDir, chunk);
    const outC = path.join(chunksDir, `proc_${chunk}`);
    await processChunk(inC, outC, 1920, 1080);
    processedChunks.push(outC);
    console.log(`  -> Processed chunk ${chunk} to 1920x1080`);
  }

  // 5. Concat & Multiplex
  console.log("\n[5/5] Merging Chunks & Multiplexing Synchronized Audio...");
  const concatTxt = path.join(chunksDir, "concat.txt");
  fs.writeFileSync(concatTxt, processedChunks.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));

  const mergedVideo = path.join(scratchDir, "merged_video.mp4");
  await mergeChunks(concatTxt, mergedVideo);

  const finalMp4 = path.join(scratchDir, "CINEGEN_FINAL_1080p.mp4");
  await multiplexFinal(mergedVideo, audioWav, finalMp4);
  console.log("✓ Final enhanced MP4 rendered at:", finalMp4);

  // 6. Verify final result
  const finalMeta = await probeVideo(finalMp4);
  console.log("\n[VERIFICATION RESULT] Final Video Inspection:", finalMeta);

  if (finalMeta.width === 1920 && finalMeta.height === 1080 && finalMeta.hasAudio) {
    console.log("\n=======================================================");
    console.log("🎉 ALL PHASE 1 CORE PIPELINE CRITERIA CONFIRMED & PASSING!");
    console.log("=======================================================\n");
  } else {
    throw new Error("Verification failed against required specifications.");
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
