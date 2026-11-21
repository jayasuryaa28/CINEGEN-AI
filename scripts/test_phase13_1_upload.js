/**
 * CINEGEN AI — Phase 13.1 Resumable Binary Chunk Upload Validation Test Suite
 *
 * Test Coverage:
 * 1. Small real MP4 chunked upload & playback metadata validation
 * 2. Interrupted upload and successful resume verification
 * 3. Idempotent duplicate chunk handling
 * 4. Security & validation: invalid index, invalid upload ID, user isolation, checksum mismatch
 * 5. Strict 4-hour video duration limit enforcement
 * 6. Cancellation and temporary file cleanup
 * 7. Memory profiling: Node.js RSS heap delta during large-scale chunk streaming
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { uploadManager } = require("../src/services/uploadManager");

const TEST_INPUT_MP4 = path.resolve("./storage_data/realworld_dataset/RW-01-rear-center/input_capture.mp4");
const CLEAN_SOURCE_MP4 = path.resolve("./clean_source_1.mp4");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function calculateFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function runUploadTestSuite() {
  console.log("===============================================================");
  console.log("   CINEGEN AI — PHASE 13.1 RESUMABLE UPLOAD PROTOCOL TESTS     ");
  console.log("===============================================================\n");

  const results = [];
  const sourceVideo = fs.existsSync(TEST_INPUT_MP4)
    ? TEST_INPUT_MP4
    : fs.existsSync(CLEAN_SOURCE_MP4)
    ? CLEAN_SOURCE_MP4
    : null;

  if (!sourceVideo) {
    console.error("[ERROR] No real test video file found for testing.");
    process.exit(1);
  }

  const sourceSize = fs.statSync(sourceVideo).size;
  const sourceSha256 = calculateFileSha256(sourceVideo);
  console.log(`[Test Environment Ready]`);
  console.log(`  Source Video: ${sourceVideo}`);
  console.log(`  File Size: ${(sourceSize / 1024).toFixed(1)} KB`);
  console.log(`  SHA-256: ${sourceSha256}\n`);

  // ==============================================================
  // Test 1: Real MP4 Multi-Chunk Upload and Playback Verification
  // ==============================================================
  console.log("--- Test 1: Real MP4 Chunked Upload & Integrity Validation ---");
  try {
    const chunkSize = 128 * 1024; // 128 KB chunk slices for multi-chunk test
    const initRes = await uploadManager.initSession({
      filename: "test_real_media.mp4",
      fileSize: sourceSize,
      chunkSize,
      expectedSha256: sourceSha256,
      userId: "user_test_1",
    });

    console.log(`  Initialized session: ${initRes.uploadId} (${initRes.totalChunks} chunks)`);

    const sourceBuf = fs.readFileSync(sourceVideo);
    for (let i = 0; i < initRes.totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(sourceSize, start + chunkSize);
      const sliceBuf = sourceBuf.subarray(start, end);

      const chunkRes = await uploadManager.writeChunk(
        initRes.uploadId,
        i,
        sliceBuf,
        sliceBuf.length,
        initRes.uploadToken
      );
      if (chunkRes.isDuplicate) {
        throw new Error(`Unexpected duplicate flag on initial upload for chunk ${i}`);
      }
    }

    const completeRes = await uploadManager.completeUpload(
      initRes.uploadId,
      initRes.uploadToken,
      sourceSha256
    );

    if (!completeRes.success || !fs.existsSync(completeRes.filePath)) {
      throw new Error("Final uploaded file missing on disk.");
    }

    if (completeRes.sha256 !== sourceSha256) {
      throw new Error(`SHA-256 mismatch! Expected ${sourceSha256}, got ${completeRes.sha256}`);
    }

    const m = completeRes.metadata;
    console.log(`  Uploaded File Verified: ${completeRes.filePath}`);
    console.log(`  Container Inspection: ${m.width}x${m.height} @ ${m.framerate}fps, Duration: ${m.durationFormatted}, Video: ${m.videoCodec}, Audio: ${m.audioCodec}`);

    // Verify playback capability with FFmpeg null sink
    const probeCheck = spawnSync(FFMPEG, ["-v", "error", "-i", completeRes.filePath, "-f", "null", "-"]);
    if (probeCheck.status !== 0) {
      throw new Error(`Playback verification failed: ${probeCheck.stderr.toString()}`);
    }

    results.push({ test: "1. Real MP4 Chunked Upload & Integrity", status: "PASSED", details: `${initRes.totalChunks} chunks, verified SHA-256` });
    console.log("  [PASSED] Test 1\n");
  } catch (err) {
    console.error(`  [FAILED] Test 1: ${err.message}\n`);
    results.push({ test: "1. Real MP4 Chunked Upload & Integrity", status: "FAILED", error: err.message });
  }

  // ==============================================================
  // Test 2: Interrupted Upload & Successful Resume
  // ==============================================================
  console.log("--- Test 2: Interrupted Upload and Resumption ---");
  try {
    const chunkSize = 64 * 1024; // 64 KB slices
    const initRes = await uploadManager.initSession({
      filename: "test_resumed_media.mp4",
      fileSize: sourceSize,
      chunkSize,
      userId: "user_test_2",
    });

    const sourceBuf = fs.readFileSync(sourceVideo);
    const halfChunks = Math.floor(initRes.totalChunks / 2);

    // Upload first 50% of chunks
    for (let i = 0; i < halfChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(sourceSize, start + chunkSize);
      await uploadManager.writeChunk(initRes.uploadId, i, sourceBuf.subarray(start, end), end - start, initRes.uploadToken);
    }

    // Simulate interruption: inspect session status
    const statusBefore = await uploadManager.getSessionStatus(initRes.uploadId, initRes.uploadToken);
    if (statusBefore.uploadedChunks.length !== halfChunks) {
      throw new Error(`Interruption status mismatch: expected ${halfChunks} chunks, got ${statusBefore.uploadedChunks.length}`);
    }
    console.log(`  Interrupted at ${statusBefore.progress}% (${statusBefore.uploadedChunks.length}/${statusBefore.totalChunks} chunks)`);

    // Attempting completion before resumption must fail
    let prematureCompleted = false;
    try {
      await uploadManager.completeUpload(initRes.uploadId, initRes.uploadToken, undefined);
      prematureCompleted = true;
    } catch (prematureErr) {
      console.log(`  Premature completion correctly blocked: ${prematureErr.message}`);
    }
    if (prematureCompleted) {
      throw new Error("Premature completeUpload should have thrown for missing chunks.");
    }

    // Resume: upload remaining chunks
    for (let i = halfChunks; i < initRes.totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(sourceSize, start + chunkSize);
      await uploadManager.writeChunk(initRes.uploadId, i, sourceBuf.subarray(start, end), end - start, initRes.uploadToken);
    }

    const completeRes = await uploadManager.completeUpload(initRes.uploadId, initRes.uploadToken, undefined);
    if (completeRes.sha256 !== sourceSha256) {
      throw new Error(`Resumed upload SHA-256 mismatch! Got ${completeRes.sha256}`);
    }

    results.push({ test: "2. Interrupted Upload & Resume", status: "PASSED", details: `Resumed from ${halfChunks}/${initRes.totalChunks} chunks, perfect SHA-256 match` });
    console.log("  [PASSED] Test 2\n");
  } catch (err) {
    console.error(`  [FAILED] Test 2: ${err.message}\n`);
    results.push({ test: "2. Interrupted Upload & Resume", status: "FAILED", error: err.message });
  }

  // ==============================================================
  // Test 3: Idempotent Duplicate Chunk Handling
  // ==============================================================
  console.log("--- Test 3: Idempotent Duplicate Chunk Handling ---");
  try {
    const chunkSize = 128 * 1024;
    const initRes = await uploadManager.initSession({
      filename: "test_duplicate_chunks.mp4",
      fileSize: sourceSize,
      chunkSize,
      userId: "user_test_3",
    });

    const sourceBuf = fs.readFileSync(sourceVideo);

    // Upload chunk 0
    const res0a = await uploadManager.writeChunk(initRes.uploadId, 0, sourceBuf.subarray(0, chunkSize), chunkSize, initRes.uploadToken);
    if (res0a.isDuplicate) throw new Error("First upload of chunk 0 should not be duplicate.");

    // Duplicate upload of chunk 0
    const res0b = await uploadManager.writeChunk(initRes.uploadId, 0, sourceBuf.subarray(0, chunkSize), chunkSize, initRes.uploadToken);
    if (!res0b.isDuplicate) throw new Error("Second upload of chunk 0 must return isDuplicate: true.");
    console.log("  Duplicate chunk 0 successfully identified without file corruption.");

    // Complete rest of chunks
    for (let i = 1; i < initRes.totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(sourceSize, start + chunkSize);
      await uploadManager.writeChunk(initRes.uploadId, i, sourceBuf.subarray(start, end), end - start, initRes.uploadToken);
    }

    const completeRes = await uploadManager.completeUpload(initRes.uploadId, initRes.uploadToken, sourceSha256);
    if (completeRes.sha256 !== sourceSha256) {
      throw new Error("Duplicate chunk corrupted the final file SHA-256!");
    }

    results.push({ test: "3. Duplicate Chunk Idempotency", status: "PASSED", details: "Handled duplicate without corrupting offset or checksum" });
    console.log("  [PASSED] Test 3\n");
  } catch (err) {
    console.error(`  [FAILED] Test 3: ${err.message}\n`);
    results.push({ test: "3. Duplicate Chunk Idempotency", status: "FAILED", error: err.message });
  }

  // ==============================================================
  // Test 4: Validation & Security Rejections
  // ==============================================================
  console.log("--- Test 4: Security & Validation Rejections ---");
  try {
    const initRes = await uploadManager.initSession({
      filename: "test_security.mp4",
      fileSize: 1024 * 1024,
      chunkSize: 512 * 1024,
      userId: "user_alpha",
    });

    // 4a: Invalid uploadId
    let invalidIdCaught = false;
    try {
      await uploadManager.writeChunk("non-existent-upload-id", 0, Buffer.alloc(100), 100, initRes.uploadToken);
    } catch (e) {
      invalidIdCaught = true;
      console.log(`  Invalid uploadId rejected: ${e.message}`);
    }
    if (!invalidIdCaught) throw new Error("Expected invalid uploadId to be rejected.");

    // 4b: Invalid chunk index
    let invalidIndexCaught = false;
    try {
      await uploadManager.writeChunk(initRes.uploadId, 999, Buffer.alloc(100), 100, initRes.uploadToken);
    } catch (e) {
      invalidIndexCaught = true;
      console.log(`  Out-of-range chunk index rejected: ${e.message}`);
    }
    if (!invalidIndexCaught) throw new Error("Expected out-of-range index to be rejected.");

    // 4c: Mismatched ownership / forged token
    let ownershipBlocked = false;
    try {
      await uploadManager.writeChunk(initRes.uploadId, 0, Buffer.alloc(100), 100, "forged_token_00000000000000000000000000000000");
    } catch (e) {
      ownershipBlocked = true;
      console.log(`  Cross-user chunk access rejected: ${e.message}`);
    }
    if (!ownershipBlocked) throw new Error("Expected cross-user chunk write to be blocked.");

    // 4d: Checksum mismatch on completion
    await uploadManager.writeChunk(initRes.uploadId, 0, Buffer.alloc(512 * 1024), 512 * 1024, initRes.uploadToken);
    await uploadManager.writeChunk(initRes.uploadId, 1, Buffer.alloc(512 * 1024), 512 * 1024, initRes.uploadToken);

    let checksumFailed = false;
    try {
      await uploadManager.completeUpload(initRes.uploadId, initRes.uploadToken, "0000000000000000000000000000000000000000000000000000000000000000");
    } catch (e) {
      checksumFailed = true;
      console.log(`  Forged checksum rejected: ${e.message}`);
    }
    if (!checksumFailed) throw new Error("Expected forged checksum to fail.");

    // Clean up
    await uploadManager.cancelUpload(initRes.uploadId, initRes.uploadToken);

    results.push({ test: "4. Security & Validation Rejections", status: "PASSED", details: "All 4 rejection vectors verified" });
    console.log("  [PASSED] Test 4\n");
  } catch (err) {
    console.error(`  [FAILED] Test 4: ${err.message}\n`);
    results.push({ test: "4. Security & Validation Rejections", status: "FAILED", error: err.message });
  }

  // ==============================================================
  // Test 5: Strict 4-Hour Duration Limit Enforcement
  // ==============================================================
  console.log("--- Test 5: Strict 4-Hour Duration Limit Enforcement ---");
  try {
    const tempDir = path.resolve("./storage_data/test_phase13_temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    console.log("  Synthesizing 4h 05m duration test container...");
    const longVideoPath = path.join(tempDir, "exceeds_4h.mp4");
    if (!fs.existsSync(longVideoPath) || fs.statSync(longVideoPath).size < 1000) {
      spawnSync(FFMPEG, [
        "-y",
        "-f", "lavfi",
        "-i", "color=c=black:s=64x64:r=0.01:d=14410",
        "-f", "lavfi",
        "-i", "anullsrc=r=1000:cl=mono",
        "-t", "14410",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "aac",
        "-t", "14410",
        longVideoPath,
      ]);
    }

    const longStat = fs.statSync(longVideoPath);
    console.log(`  Synthesized long test media: ${longVideoPath} (${(longStat.size / 1024).toFixed(1)} KB)`);

    const initRes = await uploadManager.initSession({
      filename: "long_movie_test.mp4",
      fileSize: longStat.size,
      chunkSize: longStat.size,
      userId: "user_test_5",
    });

    const fileBuf = fs.readFileSync(longVideoPath);
    await uploadManager.writeChunk(initRes.uploadId, 0, fileBuf, fileBuf.length, initRes.uploadToken);

    let durationRejected = false;
    try {
      await uploadManager.completeUpload(initRes.uploadId, initRes.uploadToken, undefined);
    } catch (e) {
      if (e.message.includes("exceeds maximum allowed limit of 4 hours")) {
        durationRejected = true;
        console.log(`  4-Hour duration limit successfully triggered: ${e.message}`);
      } else {
        throw e;
      }
    }

    if (!durationRejected) {
      throw new Error("Expected video > 4 hours to be rejected, but it passed!");
    }

    // Verify staging file was automatically unlinked
    const stagingExists = fs.existsSync(path.join("./storage_data/uploads/.staging", `upload_${initRes.uploadId}.mp4.part`));
    if (stagingExists) {
      throw new Error("Staging file was not cleaned up after duration limit rejection.");
    }
    console.log("  Staging file cleaned up safely after rejection.");

    results.push({ test: "5. 4-Hour Duration Enforcement", status: "PASSED", details: "Rejected 14,410s container and unlinked staging file" });
    console.log("  [PASSED] Test 5\n");
  } catch (err) {
    console.error(`  [FAILED] Test 5: ${err.message}\n`);
    results.push({ test: "5. 4-Hour Duration Enforcement", status: "FAILED", error: err.message });
  }

  // ==============================================================
  // Test 6: Cancellation and Temporary-File Cleanup
  // ==============================================================
  console.log("--- Test 6: Cancellation and Temporary-File Cleanup ---");
  try {
    const initRes = await uploadManager.initSession({
      filename: "test_cancel_me.mp4",
      fileSize: 5 * 1024 * 1024,
      chunkSize: 1024 * 1024,
      userId: "user_test_6",
    });

    // Write chunk 0
    await uploadManager.writeChunk(initRes.uploadId, 0, Buffer.alloc(1024 * 1024, 0xaa), 1024 * 1024, initRes.uploadToken);

    const stagingPath = path.join("./storage_data/uploads/.staging", `upload_${initRes.uploadId}.mp4.part`);
    const sessionPath = path.join("./storage_data/uploads/.sessions", `${initRes.uploadId}.json`);

    if (!fs.existsSync(stagingPath)) {
      throw new Error("Staging file should exist prior to cancellation.");
    }

    const cancelRes = await uploadManager.cancelUpload(initRes.uploadId, initRes.uploadToken);
    if (!cancelRes.cancelled) throw new Error("cancelUpload failed to return cancelled: true.");

    if (fs.existsSync(stagingPath)) {
      throw new Error("Staging file still exists after cancellation!");
    }
    if (fs.existsSync(sessionPath)) {
      throw new Error("Session file still exists after cancellation!");
    }

    console.log("  Staging file and session files unlinked completely.");

    // Test abandoned session cleanup
    const abandonedInit = await uploadManager.initSession({
      filename: "test_abandoned.mp4",
      fileSize: 1024 * 1024,
      chunkSize: 1024 * 1024,
      userId: "user_abandoned",
    });
    // Force old timestamp
    const abSessionPath = path.join("./storage_data/uploads/.sessions", `${abandonedInit.uploadId}.json`);
    const sessionData = JSON.parse(fs.readFileSync(abSessionPath, "utf-8"));
    sessionData.updatedAt = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    fs.writeFileSync(abSessionPath, JSON.stringify(sessionData, null, 2));

    const cleaned = await uploadManager.cleanupAbandoned(24 * 3600 * 1000);
    console.log(`  Sweeper cleaned ${cleaned} abandoned session(s).`);
    if (cleaned === 0) throw new Error("Expected at least 1 abandoned session to be cleaned.");

    results.push({ test: "6. Cancellation & File Cleanup", status: "PASSED", details: "Zero leftover temporary files, sweeper verified" });
    console.log("  [PASSED] Test 6\n");
  } catch (err) {
    console.error(`  [FAILED] Test 6: ${err.message}\n`);
    results.push({ test: "6. Cancellation & File Cleanup", status: "FAILED", error: err.message });
  }

  // ==============================================================
  // Test 7: Memory Profiling: RSS Heap Delta on Large Stream Upload
  // ==============================================================
  console.log("--- Test 7: Memory Profiling: Large-Scale Chunk Streaming ---");
  try {
    if (global.gc) global.gc();

    const baselineMemory = process.memoryUsage();
    const baselineRssMB = baselineMemory.rss / (1024 * 1024);
    const baselineHeapMB = baselineMemory.heapUsed / (1024 * 1024);

    console.log(`  Initial Process Memory: RSS = ${baselineRssMB.toFixed(2)} MB, Heap = ${baselineHeapMB.toFixed(2)} MB`);

    // Stream 20 chunks of 10 MB = 200 MB simulated high-speed upload
    const TOTAL_SIMULATED_SIZE = 200 * 1024 * 1024; // 200 MB
    const SIM_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
    const TOTAL_CHUNKS = 20;

    const initRes = await uploadManager.initSession({
      filename: "simulated_large_transfer.mp4",
      fileSize: TOTAL_SIMULATED_SIZE,
      chunkSize: SIM_CHUNK_SIZE,
      userId: "user_mem_test",
    });

    let peakRssMB = baselineRssMB;
    let peakHeapMB = baselineHeapMB;

    // Single reusable 10MB chunk buffer representing incoming network chunks
    const chunkBuffer = Buffer.alloc(SIM_CHUNK_SIZE, 0x42);

    for (let c = 0; c < TOTAL_CHUNKS; c++) {
      await uploadManager.writeChunk(initRes.uploadId, c, chunkBuffer, SIM_CHUNK_SIZE, initRes.uploadToken);

      const currentMem = process.memoryUsage();
      const currentRss = currentMem.rss / (1024 * 1024);
      const currentHeap = currentMem.heapUsed / (1024 * 1024);

      if (currentRss > peakRssMB) peakRssMB = currentRss;
      if (currentHeap > peakHeapMB) peakHeapMB = currentHeap;

      if (c % 5 === 0 || c === TOTAL_CHUNKS - 1) {
        console.log(`    Chunk ${c + 1}/${TOTAL_CHUNKS} (Total ${( (c + 1) * 10).toFixed(0)} MB streamed) — Current RSS: ${currentRss.toFixed(2)} MB (Peak: ${peakRssMB.toFixed(2)} MB)`);
      }
    }

    const rssDeltaMB = peakRssMB - baselineRssMB;
    const heapDeltaMB = peakHeapMB - baselineHeapMB;
    console.log(`  [Memory Results]:`);
    console.log(`    Baseline RSS: ${baselineRssMB.toFixed(2)} MB`);
    console.log(`    Peak RSS:     ${peakRssMB.toFixed(2)} MB`);
    console.log(`    RSS Delta:    ${rssDeltaMB.toFixed(2)} MB`);
    console.log(`    Peak Heap:    ${peakHeapMB.toFixed(2)} MB`);

    // Clean up test staging file
    await uploadManager.cancelUpload(initRes.uploadId, initRes.uploadToken);

    if (rssDeltaMB > 64.0) {
      throw new Error(`Excessive RSS memory growth: ${rssDeltaMB.toFixed(2)} MB exceeds 64 MB ceiling!`);
    }

    results.push({
      test: "7. Large Upload Memory Isolation",
      status: "PASSED",
      details: `200 MB streamed in 10MB chunks; RSS delta: ${rssDeltaMB.toFixed(2)} MB (Limit: 64 MB)`,
    });
    console.log("  [PASSED] Test 7\n");
  } catch (err) {
    console.error(`  [FAILED] Test 7: ${err.message}\n`);
    results.push({ test: "7. Large Upload Memory Isolation", status: "FAILED", error: err.message });
  }

  // ==============================================================
  // Test Summary
  // ==============================================================
  console.log("===============================================================");
  console.log("             PHASE 13.1 TEST EXECUTION SUMMARY                 ");
  console.log("===============================================================");
  let passedCount = 0;
  for (const r of results) {
    const mark = r.status === "PASSED" ? "✓" : "✗";
    console.log(`${mark} [${r.status}] ${r.test} - ${r.details || r.error}`);
    if (r.status === "PASSED") passedCount++;
  }
  console.log(`\nResult: ${passedCount}/${results.length} tests passed.`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runUploadTestSuite().catch((e) => {
  console.error("Test harness unhandled exception:", e);
  process.exit(1);
});
