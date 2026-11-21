const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { uploadManager } = require("../src/services/uploadManager.js");

async function runHardeningTests() {
  console.log("==================================================================");
  console.log("  CINEGEN AI — PHASE 13.1.1 UPLOAD INFRASTRUCTURE HARDENING TEST  ");
  console.log("==================================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    } else {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    }
  }

  const testTempDir = path.resolve("./storage_data/hardening_tests");
  if (!fs.existsSync(testTempDir)) fs.mkdirSync(testTempDir, { recursive: true });

  // -------------------------------------------------------------------------
  // TEST A: Concurrent Chunk Writes (20 concurrent chunks to one session)
  // -------------------------------------------------------------------------
  console.log(">>> TEST A: Concurrent Chunk Writes (Atomic Per-Chunk Records)");
  {
    const totalChunks = 20;
    const chunkSize = 64 * 1024; // 64 KB
    const fileSize = totalChunks * chunkSize;
    const testFile = path.join(testTempDir, "concurrent_test.mp4");

    const chunkBuffers = [];
    for (let i = 0; i < totalChunks; i++) {
      const buf = crypto.randomBytes(chunkSize);
      chunkBuffers.push(buf);
    }
    const fullBuffer = Buffer.concat(chunkBuffers);
    const fullSha256 = crypto.createHash("sha256").update(fullBuffer).digest("hex");

    const sessionInit = await uploadManager.initSession({
      filename: "concurrent_test.mp4",
      fileSize,
      chunkSize,
      expectedSha256: fullSha256,
      lastModified: 1700000000000,
      fingerprint: "test-fingerprint-a",
    });

    assert(sessionInit.uploadId != null, "Session initialized with uploadId");
    assert(sessionInit.uploadToken != null, "Session initialized with 256-bit uploadToken");

    // Fire all 20 chunk uploads concurrently
    const writePromises = chunkBuffers.map((buf, idx) => {
      const stream = Readable.from(buf);
      return uploadManager.writeChunk(sessionInit.uploadId, idx, stream, buf.length, sessionInit.uploadToken);
    });

    const results = await Promise.all(writePromises);
    assert(results.length === 20, "All 20 concurrent chunk write promises resolved");

    const status = await uploadManager.getSessionStatus(sessionInit.uploadId, sessionInit.uploadToken);
    assert(status.uploadedChunks.length === 20, `All 20 chunks recorded (found: ${status.uploadedChunks.length})`);
    for (let i = 0; i < 20; i++) {
      assert(status.uploadedChunks.includes(i), `Chunk index ${i} is present in recorded chunks`);
    }

    // Clean up session
    await uploadManager.cancelUpload(sessionInit.uploadId, sessionInit.uploadToken);
  }

  // -------------------------------------------------------------------------
  // TEST B: Duplicate Concurrent Requests for the Same Chunk
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST B: Duplicate Concurrent Requests for the Same Chunk");
  {
    const chunkSize = 128 * 1024;
    const totalChunks = 2;
    const fileSize = totalChunks * chunkSize;
    const chunk0 = crypto.randomBytes(chunkSize);
    const chunk1 = crypto.randomBytes(chunkSize);
    const fullBuffer = Buffer.concat([chunk0, chunk1]);
    const fullSha256 = crypto.createHash("sha256").update(fullBuffer).digest("hex");

    const sessionInit = await uploadManager.initSession({
      filename: "duplicate_chunk_test.mp4",
      fileSize,
      chunkSize,
      expectedSha256: fullSha256,
      lastModified: 1700000001000,
      fingerprint: "test-fingerprint-b",
    });

    // Launch 3 simultaneous writes for chunk 0
    const dupWrites = [
      uploadManager.writeChunk(sessionInit.uploadId, 0, Readable.from(chunk0), chunkSize, sessionInit.uploadToken),
      uploadManager.writeChunk(sessionInit.uploadId, 0, Readable.from(chunk0), chunkSize, sessionInit.uploadToken),
      uploadManager.writeChunk(sessionInit.uploadId, 0, Readable.from(chunk0), chunkSize, sessionInit.uploadToken),
    ];

    const dupResults = await Promise.all(dupWrites);
    assert(dupResults.length === 3, "All duplicate chunk writes handled gracefully");

    // Write chunk 1
    await uploadManager.writeChunk(sessionInit.uploadId, 1, Readable.from(chunk1), chunkSize, sessionInit.uploadToken);

    const status = await uploadManager.getSessionStatus(sessionInit.uploadId, sessionInit.uploadToken);
    assert(status.uploadedChunks.length === 2, `Exactly 2 unique chunk indices recorded: ${status.uploadedChunks}`);

    // Verify file on disk matches byte-for-byte
    const session = await uploadManager.loadSession(sessionInit.uploadId);
    const onDiskContent = await fs.promises.readFile(session.stagingPath);
    const onDiskSha = crypto.createHash("sha256").update(onDiskContent).digest("hex");
    assert(onDiskSha === fullSha256, `Data intact despite duplicate writes: SHA-256 matches ${onDiskSha}`);

    await uploadManager.cancelUpload(sessionInit.uploadId, sessionInit.uploadToken);
  }

  // -------------------------------------------------------------------------
  // TEST C: Completion Blocked While Chunk Writes are Active
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST C: Completion Blocked While Chunk Writes are Active");
  {
    const chunkSize = 256 * 1024;
    const totalChunks = 2;
    const fileSize = totalChunks * chunkSize;
    const chunk0 = crypto.randomBytes(chunkSize);
    const chunk1 = crypto.randomBytes(chunkSize);

    const sessionInit = await uploadManager.initSession({
      filename: "active_write_test.mp4",
      fileSize,
      chunkSize,
      lastModified: 1700000002000,
      fingerprint: "test-fingerprint-c",
    });

    // Write chunk 0
    await uploadManager.writeChunk(sessionInit.uploadId, 0, Readable.from(chunk0), chunkSize, sessionInit.uploadToken);

    // Create a slow stream for chunk 1 that pauses before finishing
    let slowChunkResolve;
    const slowStream = new Readable({
      read() {
        // do not push immediately, delay
      }
    });

    const activeWritePromise = uploadManager.writeChunk(
      sessionInit.uploadId,
      1,
      slowStream,
      chunkSize,
      sessionInit.uploadToken
    );

    // Attempt completion while chunk 1 is in-flight
    let caughtCompletionError = null;
    try {
      await uploadManager.completeUpload(sessionInit.uploadId, sessionInit.uploadToken);
    } catch (err) {
      caughtCompletionError = err;
    }

    assert(caughtCompletionError != null, "completeUpload threw error while chunk write was active");
    assert(
      caughtCompletionError.message.includes("actively streaming"),
      `Error correctly identifies active streams: "${caughtCompletionError.message}"`
    );

    // Now push data and complete slow stream
    slowStream.push(chunk1);
    slowStream.push(null);
    await activeWritePromise;

    // Clean up
    await uploadManager.cancelUpload(sessionInit.uploadId, sessionInit.uploadToken);
  }

  // -------------------------------------------------------------------------
  // TEST D: Cancellation During Active Chunk Write & Lock Release
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST D: Cancellation During Active Chunk Write & Resource Release");
  {
    const chunkSize = 256 * 1024;
    const totalChunks = 2;
    const fileSize = totalChunks * chunkSize;

    const sessionInit = await uploadManager.initSession({
      filename: "cancel_active_test.mp4",
      fileSize,
      chunkSize,
      lastModified: 1700000003000,
      fingerprint: "test-fingerprint-d",
    });

    const hangingStream = new Readable({
      read() {}
    });

    const hangingPromise = uploadManager.writeChunk(
      sessionInit.uploadId,
      0,
      hangingStream,
      chunkSize,
      sessionInit.uploadToken
    ).catch(err => {
      // Stream aborted on cancel
      return { aborted: true, error: err.message };
    });

    // Cancel while stream is hanging
    const cancelResult = await uploadManager.cancelUpload(sessionInit.uploadId, sessionInit.uploadToken);
    assert(cancelResult.cancelled === true, "cancelUpload succeeded during active in-flight write");

    const abortedOutcome = await hangingPromise;
    assert(abortedOutcome.aborted === true, "Active stream was aborted upon cancellation");

    // Verify session files and chunks dir are completely deleted
    const sessionJsonExists = fs.existsSync(uploadManager.getSessionPath(sessionInit.uploadId));
    assert(!sessionJsonExists, "session.json deleted after cancellation");

    // Verify chunk locks and active writes are empty
    assert(uploadManager.activeUploadWrites.get(sessionInit.uploadId) === undefined, "activeUploadWrites tracking cleared for cancelled session");
    assert(uploadManager.activeChunkLocks.size === 0, "activeChunkLocks released cleanly");
  }

  // -------------------------------------------------------------------------
  // TEST E: Insufficient Physical Disk Capacity Rejection
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST E: Physical Disk Free Space Validation");
  {
    // Simulate low free space (1 MB) via adapter hook
    uploadManager.setSimulatedFreeDiskBytes(1 * 1024 * 1024);

    let caughtDiskError = null;
    try {
      await uploadManager.initSession({
        filename: "giant_file.mp4",
        fileSize: 500 * 1024 * 1024, // 500 MB required
        chunkSize: 10 * 1024 * 1024,
      });
    } catch (err) {
      caughtDiskError = err;
    } finally {
      // Reset simulator hook
      uploadManager.setSimulatedFreeDiskBytes(null);
    }

    assert(caughtDiskError != null, "initSession rejected upload when free disk space is insufficient");
    assert(
      caughtDiskError.message.includes("Insufficient physical disk capacity"),
      `Clear disk capacity error returned: "${caughtDiskError.message}"`
    );
  }

  // -------------------------------------------------------------------------
  // TEST F: Resume File Identity Validation
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST F: Resume File Identity Validation");
  {
    const chunkSize = 64 * 1024;
    const totalChunks = 4;
    const fileSize = totalChunks * chunkSize;
    const lastModified = 1715000000000;
    const fingerprint = "sha256-fingerprint-identity-f";

    const sessionInit = await uploadManager.initSession({
      filename: "identity_test.mp4",
      fileSize,
      chunkSize,
      lastModified,
      fingerprint,
    });

    // Write chunk 0
    await uploadManager.writeChunk(
      sessionInit.uploadId,
      0,
      Readable.from(crypto.randomBytes(chunkSize)),
      chunkSize,
      sessionInit.uploadToken
    );

    // Subtest F1: Resuming with exact matching parameters succeeds
    const statusSuccess = await uploadManager.getSessionStatus(
      sessionInit.uploadId,
      sessionInit.uploadToken,
      {
        filename: "identity_test.mp4",
        fileSize,
        lastModified,
        fingerprint,
      }
    );
    assert(statusSuccess.uploadedChunks.includes(0), "Resume with matching file succeeded and returned chunk 0");

    // Subtest F2: Resuming with modified lastModified is rejected
    let caughtLastModifiedError = null;
    try {
      await uploadManager.getSessionStatus(
        sessionInit.uploadId,
        sessionInit.uploadToken,
        {
          filename: "identity_test.mp4",
          fileSize,
          lastModified: 1715999999999, // changed
          fingerprint,
        }
      );
    } catch (err) {
      caughtLastModifiedError = err;
    }
    assert(caughtLastModifiedError != null, "Resume rejected when lastModified timestamp changed");
    assert(
      caughtLastModifiedError.message.includes("lastModified timestamp has changed"),
      `Error identifies timestamp mismatch: "${caughtLastModifiedError.message}"`
    );

    // Subtest F3: Resuming with modified fileSize is rejected
    let caughtSizeError = null;
    try {
      await uploadManager.getSessionStatus(
        sessionInit.uploadId,
        sessionInit.uploadToken,
        {
          filename: "identity_test.mp4",
          fileSize: fileSize + 1024, // changed
          lastModified,
          fingerprint,
        }
      );
    } catch (err) {
      caughtSizeError = err;
    }
    assert(caughtSizeError != null, "Resume rejected when fileSize changed");
    assert(
      caughtSizeError.message.includes("expected file size"),
      `Error identifies size mismatch: "${caughtSizeError.message}"`
    );

    // Subtest F4: Resuming with modified fingerprint is rejected
    let caughtFingerprintError = null;
    try {
      await uploadManager.getSessionStatus(
        sessionInit.uploadId,
        sessionInit.uploadToken,
        {
          filename: "identity_test.mp4",
          fileSize,
          lastModified,
          fingerprint: "tampered-or-different-content-fingerprint",
        }
      );
    } catch (err) {
      caughtFingerprintError = err;
    }
    assert(caughtFingerprintError != null, "Resume rejected when fingerprint changed");
    assert(
      caughtFingerprintError.message.includes("lightweight file fingerprint does not match"),
      `Error identifies fingerprint mismatch: "${caughtFingerprintError.message}"`
    );

    await uploadManager.cancelUpload(sessionInit.uploadId, sessionInit.uploadToken);
  }

  // -------------------------------------------------------------------------
  // TEST G: Authentication & Unguessable Token Security
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST G: Unguessable Token Security & Cryptographic Validation");
  {
    const chunkSize = 64 * 1024;
    const sessionInit = await uploadManager.initSession({
      filename: "auth_test.mp4",
      fileSize: 128 * 1024,
      chunkSize,
    });

    const forgedToken = crypto.randomBytes(32).toString("hex");

    // Subtest G1: Chunk write with missing token
    let g1Err = null;
    try {
      await uploadManager.writeChunk(sessionInit.uploadId, 0, Readable.from(crypto.randomBytes(chunkSize)), chunkSize, undefined);
    } catch (err) {
      g1Err = err;
    }
    assert(g1Err != null && g1Err.message.includes("missing uploadToken"), "Chunk write rejected without token");

    // Subtest G2: Chunk write with forged token
    let g2Err = null;
    try {
      await uploadManager.writeChunk(sessionInit.uploadId, 0, Readable.from(crypto.randomBytes(chunkSize)), chunkSize, forgedToken);
    } catch (err) {
      g2Err = err;
    }
    assert(g2Err != null && g2Err.message.includes("invalid uploadToken"), "Chunk write rejected with forged token");

    // Subtest G3: Status query with missing token
    let g3Err = null;
    try {
      await uploadManager.getSessionStatus(sessionInit.uploadId, undefined);
    } catch (err) {
      g3Err = err;
    }
    assert(g3Err != null && g3Err.message.includes("missing uploadToken"), "Status query rejected without token");

    // Subtest G4: Status query with forged token
    let g4Err = null;
    try {
      await uploadManager.getSessionStatus(sessionInit.uploadId, forgedToken);
    } catch (err) {
      g4Err = err;
    }
    assert(g4Err != null && g4Err.message.includes("invalid uploadToken"), "Status query rejected with forged token");

    // Subtest G5: Completion with forged token
    let g5Err = null;
    try {
      await uploadManager.completeUpload(sessionInit.uploadId, forgedToken);
    } catch (err) {
      g5Err = err;
    }
    assert(g5Err != null && g5Err.message.includes("invalid uploadToken"), "Complete upload rejected with forged token");

    // Subtest G6: Cancellation with forged token
    let g6Err = null;
    try {
      await uploadManager.cancelUpload(sessionInit.uploadId, forgedToken);
    } catch (err) {
      g6Err = err;
    }
    assert(g6Err != null && g6Err.message.includes("invalid uploadToken"), "Cancel upload rejected with forged token");

    // Valid cancel cleans up
    await uploadManager.cancelUpload(sessionInit.uploadId, sessionInit.uploadToken);
  }

  console.log("\n==================================================================");
  console.log(`  PHASE 13.1.1 HARDENING TESTS PASSED: ${passedTests} / ${totalTests} assertions  `);
  console.log("==================================================================\n");
}

runHardeningTests().catch((err) => {
  console.error("\n[FATAL] Hardening test suite failed:", err);
  process.exit(1);
});
