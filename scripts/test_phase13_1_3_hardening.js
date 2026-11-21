/**
 * CINEGEN AI — Phase 13.1.3 Final Upload Reliability Hardening Verification Suite
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { uploadManager, UploadManager, getClientIp } = require("../src/services/uploadManager.js");

async function runPhase13_1_3Tests() {
  console.log("==================================================================");
  console.log("  CINEGEN AI — PHASE 13.1.3 FINAL RELIABILITY HARDENING TESTS    ");
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

  // Pre-test cleanup
  await uploadManager.cleanupAbandoned(0, 0);
  uploadManager.activeReservations.clear();

  // -------------------------------------------------------------------------
  // TEST 1: Cleanup vs Completion Race at Expiration Boundary
  // -------------------------------------------------------------------------
  console.log(">>> TEST 1: Cleanup vs Completion Race with Lifecycle Lock");
  {
    // Generate valid test MP4 chunk
    const testVideo = path.resolve("./clean_source_1.mp4");
    if (!fs.existsSync(testVideo)) {
      throw new Error(`Test source video not found at: ${testVideo}`);
    }
    const stat = fs.statSync(testVideo);
    const fullBuf = fs.readFileSync(testVideo);
    const fullSha256 = crypto.createHash("sha256").update(fullBuf).digest("hex");

    const sessionInit = await uploadManager.initSession({
      filename: "test_race_completion.mp4",
      fileSize: stat.size,
      chunkSize: stat.size,
      expectedSha256: fullSha256,
    });

    // Write the complete chunk
    await uploadManager.writeChunk(
      sessionInit.uploadId,
      0,
      fullBuf,
      stat.size,
      sessionInit.uploadToken
    );

    // Set expiration to right now to trigger expiration threshold
    const sessPath = uploadManager.getSessionPath(sessionInit.uploadId);
    const sessData = JSON.parse(fs.readFileSync(sessPath, "utf-8"));
    sessData.expiresAt = new Date(Date.now() + 50).toISOString(); // expires in 50ms
    fs.writeFileSync(sessPath, JSON.stringify(sessData, null, 2));

    // Launch completion and cleanup concurrently
    const completePromise = uploadManager.completeUpload(
      sessionInit.uploadId,
      sessionInit.uploadToken,
      fullSha256
    );

    // Concurrently trigger cleanup
    const cleanupPromise = uploadManager.cleanupAbandoned(0, 0);

    const [completeRes, cleanedCount] = await Promise.all([completePromise, cleanupPromise]);

    assert(completeRes.success === true, "completeUpload succeeded despite concurrent cleanup sweep");
    assert(fs.existsSync(completeRes.filePath), "Finalized video exists in storage");

    // Verify session completed and was not deleted mid-flight
    const completedSession = await uploadManager.loadSession(sessionInit.uploadId);
    assert(completedSession.status === "completed", "Session status is cleanly marked completed");
    assert(completedSession.completedAt != null, "completedAt timestamp is recorded");

    // Clean up
    if (fs.existsSync(sessPath)) fs.unlinkSync(sessPath);
    if (fs.existsSync(completeRes.filePath)) fs.unlinkSync(completeRes.filePath);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Completed Session Metadata Retention & Active Job Guard
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 2: Completed Session Metadata Retention & Job Reference Guard");
  {
    // Create dummy completed session
    const uploadIdA = "dummy-completed-old";
    const uploadIdB = "dummy-completed-active-job";
    const now = Date.now();

    const sessObjA = {
      uploadId: uploadIdA,
      uploadTokenHash: "dummyhash",
      filename: "old_movie.mp4",
      fileSize: 1000,
      totalChunks: 1,
      chunkSize: 1000,
      uploadedChunks: [0],
      uploadedBytes: 1000,
      stagingPath: path.resolve("./storage_data/uploads/.staging/dummy_a.part"),
      chunksDir: path.resolve("./storage_data/uploads/.sessions/dummy_a_chunks"),
      userId: "user_test",
      status: "completed",
      createdAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(),
      updatedAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(),
      completedAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(), // 10 days old
      expiresAt: new Date(now + 24 * 3600 * 1000).toISOString(),
    };

    const sessObjB = {
      uploadId: uploadIdB,
      uploadTokenHash: "dummyhash",
      filename: "active_job_movie.mp4",
      fileSize: 1000,
      totalChunks: 1,
      chunkSize: 1000,
      uploadedChunks: [0],
      uploadedBytes: 1000,
      stagingPath: path.resolve("./storage_data/uploads/.staging/dummy_b.part"),
      chunksDir: path.resolve("./storage_data/uploads/.sessions/dummy_b_chunks"),
      userId: "user_test",
      status: "completed",
      createdAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(),
      updatedAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(),
      completedAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(), // 10 days old
      expiresAt: new Date(now + 24 * 3600 * 1000).toISOString(),
    };

    const pathA = uploadManager.getSessionPath(uploadIdA);
    const pathB = uploadManager.getSessionPath(uploadIdB);
    fs.writeFileSync(pathA, JSON.stringify(sessObjA, null, 2));
    fs.writeFileSync(pathB, JSON.stringify(sessObjB, null, 2));

    // Simulate an active job referencing uploadIdB in jobs_store.json
    const jobsStorePath = path.resolve("./storage_data/jobs_store.json");
    let originalJobs = [];
    if (fs.existsSync(jobsStorePath)) {
      try { originalJobs = JSON.parse(fs.readFileSync(jobsStorePath, "utf-8")); } catch {}
    }
    const mockJobs = [
      ...originalJobs,
      {
        id: "job-ref-test",
        status: "processing",
        inputPath: `/some/path/${uploadIdB}_active_job_movie.mp4`,
      }
    ];
    fs.writeFileSync(jobsStorePath, JSON.stringify(mockJobs, null, 2));

    // Run cleanup with 7-day completed retention
    const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
    await uploadManager.cleanupAbandoned(24 * 3600 * 1000, SEVEN_DAYS_MS);

    // Verification:
    // Session A (10 days old, not referenced by job) must be swept
    assert(!fs.existsSync(pathA), "Completed session A (10 days old) safely swept after retention expired");

    // Session B (10 days old, but referenced by active job) must NOT be deleted
    assert(fs.existsSync(pathB), "Completed session B preserved because it is referenced by an active processing job");

    // Clean up mock records
    if (fs.existsSync(pathB)) fs.unlinkSync(pathB);
    fs.writeFileSync(jobsStorePath, JSON.stringify(originalJobs, null, 2));
  }

  // -------------------------------------------------------------------------
  // TEST 3: Resource Exhaustion Limits (Concurrency & Session Limits)
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 3: Resource Exhaustion Limits & Concurrency Guards");
  {
    // Test 3a: Max Active Sessions Guard
    const origMaxSessions = uploadManager.maxActiveSessions;
    uploadManager.maxActiveSessions = 2; // set to 2 for test

    const s1 = await uploadManager.initSession({ filename: "lim1.mp4", fileSize: 1024 * 1024 });
    const s2 = await uploadManager.initSession({ filename: "lim2.mp4", fileSize: 1024 * 1024 });

    let s3Blocked = false;
    try {
      await uploadManager.initSession({ filename: "lim3.mp4", fileSize: 1024 * 1024 });
    } catch (err) {
      if (err.message.includes("maximum active upload sessions limit reached")) {
        s3Blocked = true;
      }
    }
    assert(s3Blocked, "Session creation strictly capped when maxActiveSessions limit reached (503)");

    // Restore limit
    uploadManager.maxActiveSessions = origMaxSessions;
    await uploadManager.cancelUpload(s1.uploadId, s1.uploadToken);
    await uploadManager.cancelUpload(s2.uploadId, s2.uploadToken);

    // Test 3b: Max Concurrent Chunk Writes Guard
    const origMaxChunkWrites = uploadManager.maxConcurrentChunkWrites;
    uploadManager.maxConcurrentChunkWrites = 2; // set to 2 for test

    const sConc = await uploadManager.initSession({
      filename: "test_conc.mp4",
      fileSize: 300 * 1024,
      chunkSize: 100 * 1024,
    });

    const stream1 = new Readable({ read() {} });
    const stream2 = new Readable({ read() {} });

    const p1 = uploadManager.writeChunk(sConc.uploadId, 0, stream1, 100 * 1024, sConc.uploadToken).catch(e => e);
    const p2 = uploadManager.writeChunk(sConc.uploadId, 1, stream2, 100 * 1024, sConc.uploadToken).catch(e => e);

    // Third write should exceed maxConcurrentChunkWrites (2)
    let concExceeded = false;
    try {
      await uploadManager.writeChunk(sConc.uploadId, 2, Buffer.alloc(100 * 1024), 100 * 1024, sConc.uploadToken);
    } catch (err) {
      if (err.message.includes("maximum server-wide concurrent chunk writes exceeded")) {
        concExceeded = true;
      }
    }
    assert(concExceeded, "Server-wide concurrent chunk writes strictly throttled (503)");

    // Clean up streams
    stream1.push(Buffer.alloc(100 * 1024)); stream1.push(null);
    stream2.push(Buffer.alloc(100 * 1024)); stream2.push(null);
    await Promise.all([p1, p2]);

    uploadManager.maxConcurrentChunkWrites = origMaxChunkWrites;
    await uploadManager.cancelUpload(sConc.uploadId, sConc.uploadToken);
  }

  // -------------------------------------------------------------------------
  // TEST 4: IP Rate Limiting & Chunk Size Bounds
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 4: IP Rate Limiting & Maximum Chunk Size Bounds");
  {
    // Test 4a: IP Rate Limiter
    const origRate = uploadManager.maxInitPerMinutePerIp;
    uploadManager.maxInitPerMinutePerIp = 3;
    const testIp = "192.168.1.100";

    assert(uploadManager.checkIpRateLimit(testIp) === true, "1st request from IP accepted");
    assert(uploadManager.checkIpRateLimit(testIp) === true, "2nd request from IP accepted");
    assert(uploadManager.checkIpRateLimit(testIp) === true, "3rd request from IP accepted");
    assert(uploadManager.checkIpRateLimit(testIp) === false, "4th request from IP rejected (Rate limit exceeded 429)");

    uploadManager.maxInitPerMinutePerIp = origRate;

    // Test 4b: Safe IP Extraction (Prevent Header Spoofing)
    delete process.env.TRUST_PROXY;
    const spoofedReq = {
      headers: {
        get(header) {
          if (header === "x-forwarded-for") return "203.0.113.195, 70.41.3.18";
          return null;
        }
      }
    };
    const ipUntrusted = getClientIp(spoofedReq);
    assert(ipUntrusted === "direct-client", "x-forwarded-for ignored when TRUST_PROXY is not enabled");

    process.env.TRUST_PROXY = "true";
    const ipTrusted = getClientIp(spoofedReq);
    assert(ipTrusted === "70.41.3.18", "Client IP parsed from verified rightmost proxy hop when TRUST_PROXY=true");
    delete process.env.TRUST_PROXY;

    // Test 4c: Max Chunk Size Enforcement (413 Payload Too Large)
    const sSize = await uploadManager.initSession({
      filename: "test_size.mp4",
      fileSize: 10 * 1024 * 1024,
      chunkSize: 10 * 1024 * 1024,
    });

    let payloadTooLargeCaught = false;
    try {
      // Pass reportedLength > maxChunkSize (100 MB)
      await uploadManager.writeChunk(
        sSize.uploadId,
        0,
        Buffer.alloc(100),
        105 * 1024 * 1024, // 105 MB reported
        sSize.uploadToken
      );
    } catch (err) {
      if (err.message.includes("Payload Too Large")) {
        payloadTooLargeCaught = true;
      }
    }
    assert(payloadTooLargeCaught, "Oversized chunk payload strictly rejected (413 Payload Too Large)");

    await uploadManager.cancelUpload(sSize.uploadId, sSize.uploadToken);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Complete Lock and Counter Release on Errors
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 5: Robust Lock & Counter Release on Failures");
  {
    const sFail = await uploadManager.initSession({
      filename: "test_fail_release.mp4",
      fileSize: 200 * 1024,
      chunkSize: 100 * 1024,
    });

    // 5a: Chunk write error releases chunk lock and global counter
    const initialGlobalWrites = uploadManager.globalActiveWriteStreams;
    const badStream = new Readable({
      read() {
        this.destroy(new Error("Simulated network drop"));
      }
    });

    try {
      await uploadManager.writeChunk(sFail.uploadId, 0, badStream, 100 * 1024, sFail.uploadToken);
    } catch {}

    assert(uploadManager.activeChunkLocks.size === 0, "Chunk lock released cleanly after write failure");
    assert(uploadManager.globalActiveWriteStreams === initialGlobalWrites, "Global write streams counter decremented after failure");
    assert(uploadManager.activeUploadWrites.get(sFail.uploadId) === undefined, "Per-session active write count cleared after failure");

    // 5b: Complete error (e.g. missing chunks) releases lifecycle lock
    let completeThrew = false;
    try {
      await uploadManager.completeUpload(sFail.uploadId, sFail.uploadToken);
    } catch (err) {
      completeThrew = true;
    }
    assert(completeThrew, "completeUpload threw for missing chunks");
    assert(!uploadManager.isLifecycleLocked(sFail.uploadId), "Lifecycle lock released cleanly after complete error");

    await uploadManager.cancelUpload(sFail.uploadId, sFail.uploadToken);
    assert(!uploadManager.isLifecycleLocked(sFail.uploadId), "Lifecycle lock released after cancel");
  }

  // -------------------------------------------------------------------------
  // TEST 6: Strict Deployment Topology Enforcement (Startup Failure)
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 6: Strict Startup Rejection on Unsupported Topologies");
  {
    // Test 6a: Node cluster worker rejection
    process.env.NODE_APP_INSTANCE = "1";
    let clusterBlocked = false;
    try {
      uploadManager.verifyDeploymentTopology();
    } catch (err) {
      if (err.message.includes("multi-instance cluster worker")) {
        clusterBlocked = true;
      }
    }
    assert(clusterBlocked, "Startup aborted with fatal error when multi-instance cluster worker detected");
    delete process.env.NODE_APP_INSTANCE;

    // Test 6b: Serverless runtime rejection (AWS Lambda)
    process.env.AWS_LAMBDA_FUNCTION_NAME = "cinegen-upload-func";
    let lambdaBlocked = false;
    try {
      uploadManager.verifyDeploymentTopology();
    } catch (err) {
      if (err.message.includes("serverless execution environment")) {
        lambdaBlocked = true;
      }
    }
    assert(lambdaBlocked, "Startup aborted with fatal error when AWS Lambda serverless detected");
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;

    // Test 6c: Serverless runtime rejection (Vercel)
    process.env.VERCEL = "1";
    let vercelBlocked = false;
    try {
      uploadManager.verifyDeploymentTopology();
    } catch (err) {
      if (err.message.includes("serverless execution environment")) {
        vercelBlocked = true;
      }
    }
    assert(vercelBlocked, "Startup aborted with fatal error when Vercel serverless detected");
    delete process.env.VERCEL;

    // Test 6d: Explicit mode validation
    process.env.CINEGEN_DEPLOYMENT_MODE = "clustered-distributed";
    let modeBlocked = false;
    try {
      uploadManager.verifyDeploymentTopology();
    } catch (err) {
      if (err.message.includes("Unsupported CINEGEN_DEPLOYMENT_MODE")) {
        modeBlocked = true;
      }
    }
    assert(modeBlocked, "Startup aborted when invalid CINEGEN_DEPLOYMENT_MODE configured");
    delete process.env.CINEGEN_DEPLOYMENT_MODE;

    // Test 6e: Explicit override allowed
    process.env.NODE_APP_INSTANCE = "2";
    process.env.ALLOW_UNSUPPORTED_TOPOLOGY = "true";
    let overrideSucceeded = true;
    try {
      uploadManager.verifyDeploymentTopology();
    } catch {
      overrideSucceeded = false;
    }
    assert(overrideSucceeded, "ALLOW_UNSUPPORTED_TOPOLOGY=true permits startup override with warning");
    delete process.env.NODE_APP_INSTANCE;
    delete process.env.ALLOW_UNSUPPORTED_TOPOLOGY;
  }

  uploadManager.stopBackgroundSweeper();

  console.log("\n==================================================================");
  console.log(`  PHASE 13.1.3 ALL TESTS PASSED: ${passedTests} / ${totalTests} assertions  `);
  console.log("==================================================================\n");
}

runPhase13_1_3Tests().catch((err) => {
  console.error("\n[FATAL] Phase 13.1.3 test suite failed:", err);
  process.exit(1);
});
