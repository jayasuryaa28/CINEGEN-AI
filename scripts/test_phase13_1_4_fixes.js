/**
 * CINEGEN AI — Phase 13.1.4 Final Four Upload Hardening Fixes Verification Suite
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { uploadManager, UploadManager, getClientIp } = require("../src/services/uploadManager.js");

async function runPhase13_1_4Tests() {
  console.log("==================================================================");
  console.log("  CINEGEN AI — PHASE 13.1.4 FINAL FOUR HARDENING FIXES TESTS      ");
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
  // TEST 1: Atomic Active Session Limit (20 Concurrent Requests vs Limit of 5)
  // -------------------------------------------------------------------------
  console.log(">>> TEST 1: Atomic Active Session Limit (20 Concurrent vs Limit of 5)");
  {
    const origMax = uploadManager.maxActiveSessions;
    uploadManager.maxActiveSessions = 5;
    uploadManager.activeReservations.clear();

    const inits = [];
    for (let i = 0; i < 20; i++) {
      inits.push(
        uploadManager.initSession({
          filename: `concurrent_20_${i}.mp4`,
          fileSize: 1024 * 1024,
          chunkSize: 1024 * 1024,
        }).then(
          (res) => ({ success: true, res }),
          (err) => ({ success: false, err })
        )
      );
    }

    const results = await Promise.all(inits);
    const successes = results.filter((r) => r.success);
    const rejections = results.filter((r) => !r.success);

    console.log(`    Total requests: 20 | Limit: 5 | Succeeded: ${successes.length} | Rejected: ${rejections.length}`);
    console.log(`    activeReservations.size: ${uploadManager.activeReservations.size}`);

    assert(successes.length === 5, "Exactly 5 initialization requests succeeded");
    assert(rejections.length === 15, "Exactly 15 initialization requests rejected");
    assert(uploadManager.activeReservations.size === 5, "Active reservations size strictly equals limit of 5");
    assert(
      rejections.every((r) => r.err.message.includes("maximum active upload sessions limit reached (5)")),
      "All rejected requests received clear 503 limit message"
    );

    // Clean up created sessions
    for (const r of successes) {
      await uploadManager.cancelUpload(r.res.uploadId, r.res.uploadToken).catch(() => {});
    }
    uploadManager.maxActiveSessions = origMax;
    assert(uploadManager.activeReservations.size === 0, "All reservations released after cleanup");
  }

  // -------------------------------------------------------------------------
  // TEST 2: Finalizing Session Crash Recovery on Startup
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 2: Finalizing Session Crash Recovery on Startup");
  {
    const crashedUploadId = "crashed-during-finalizing";
    const sessPath = uploadManager.getSessionPath(crashedUploadId);
    const stagingPath = path.resolve("./storage_data/uploads/.staging/upload_crashed_finalizing.mp4.part");
    fs.writeFileSync(stagingPath, Buffer.alloc(1024 * 1024, 0x11));

    const crashedSession = {
      uploadId: crashedUploadId,
      uploadTokenHash: "hash123",
      filename: "crashed_movie.mp4",
      fileSize: 1024 * 1024,
      totalChunks: 1,
      chunkSize: 1024 * 1024,
      uploadedChunks: [0],
      uploadedBytes: 1024 * 1024,
      stagingPath,
      chunksDir: path.resolve("./storage_data/uploads/.sessions/crashed_finalizing_chunks"),
      userId: "test_user",
      status: "finalizing",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    fs.writeFileSync(sessPath, JSON.stringify(crashedSession, null, 2));

    // Simulate server restart with new UploadManager instance
    const restartedManager = new UploadManager();
    restartedManager.stopBackgroundSweeper();

    // Verify crashed session was detected and recovered as failed
    const recoveredRaw = fs.readFileSync(sessPath, "utf-8");
    const recoveredSession = JSON.parse(recoveredRaw);
    assert(recoveredSession.status === "failed", "Interrupted finalizing session transitioned to 'failed' on restart");
    assert(
      recoveredSession.error.includes("interrupted by unexpected server restart"),
      "Helpful explanatory error recorded on session"
    );

    // Verify cleanupAbandoned sweeps the failed session and its staging file
    const swept = await restartedManager.cleanupAbandoned(0, 0);
    assert(fs.existsSync(sessPath) === false, "Failed session JSON unlinked cleanly during cleanup sweep");
    assert(fs.existsSync(stagingPath) === false, "Orphaned staging file unlinked cleanly during cleanup sweep");
    assert(swept >= 1, "Cleaned counter incremented");
  }

  // -------------------------------------------------------------------------
  // TEST 3: Active Job Metadata Preservation During Crash Recovery & Cleanup
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 3: Active Job Metadata Preservation During Crash Recovery & Cleanup");
  {
    const activeJobUploadId = "finalizing-active-job-id";
    const sessPath = uploadManager.getSessionPath(activeJobUploadId);
    const jobsStore = path.resolve("./storage_data/jobs_store.json");
    const origJobs = fs.existsSync(jobsStore) ? fs.readFileSync(jobsStore, "utf-8") : "[]";

    // Set up active job referencing this upload
    const activeJobs = [
      {
        id: "job_running_456",
        status: "processing",
        inputPath: `/uploads/123_${activeJobUploadId}_movie.mp4`,
      },
    ];
    fs.writeFileSync(jobsStore, JSON.stringify(activeJobs, null, 2));

    const sessData = {
      uploadId: activeJobUploadId,
      uploadTokenHash: "hash123",
      filename: "active_job_movie.mp4",
      fileSize: 1000,
      totalChunks: 1,
      chunkSize: 1000,
      uploadedChunks: [0],
      uploadedBytes: 1000,
      stagingPath: path.resolve("./storage_data/uploads/.staging/dummy_active.part"),
      chunksDir: path.resolve("./storage_data/uploads/.sessions/dummy_active_chunks"),
      userId: "test",
      status: "finalizing",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
    };
    fs.writeFileSync(sessPath, JSON.stringify(sessData, null, 2));

    // Simulate restart
    const mgr = new UploadManager();
    mgr.stopBackgroundSweeper();

    // Verify session remained 'finalizing' and was not marked failed because active job owns it
    const postRestartRaw = fs.readFileSync(sessPath, "utf-8");
    const postRestartSess = JSON.parse(postRestartRaw);
    assert(postRestartSess.status === "finalizing", "Active job-protected session preserved across restart");

    // Verify cleanup does not delete it
    await mgr.cleanupAbandoned(0, 0);
    assert(fs.existsSync(sessPath) === true, "Active job-protected session preserved by cleanupAbandoned");

    // Restore jobsStore and clean up
    fs.writeFileSync(jobsStore, origJobs);
    if (fs.existsSync(sessPath)) fs.unlinkSync(sessPath);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Rate-Limiter Memory Management (Pruning and Size Ceiling)
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 4: Rate-Limiter Memory Management (Pruning and Size Ceiling)");
  {
    uploadManager.ipRateLimiter.clear();
    const origMaxEntries = uploadManager.maxRateLimitEntries;
    uploadManager.maxRateLimitEntries = 20;

    // Add 50 unique IPs
    for (let i = 0; i < 50; i++) {
      uploadManager.checkIpRateLimit(`192.0.2.${i}`);
    }

    console.log(`    Injected 50 IPs with maxRateLimitEntries=20. Current size: ${uploadManager.ipRateLimiter.size}`);
    assert(uploadManager.ipRateLimiter.size <= 20, "Rate-limiter map size strictly capped at maxRateLimitEntries");

    // Test pruning of expired entries without resetting active rate limits
    uploadManager.ipRateLimiter.clear();
    const now = Date.now();
    uploadManager.ipRateLimiter.set("active.ip.1", { count: 3, resetTime: now + 50000 });
    uploadManager.ipRateLimiter.set("expired.ip.2", { count: 5, resetTime: now - 10000 });

    uploadManager.pruneIpRateLimiter(now);

    assert(uploadManager.ipRateLimiter.has("active.ip.1") === true, "Active unexpired IP retained after pruning");
    assert(uploadManager.ipRateLimiter.get("active.ip.1").count === 3, "Active rate limit count preserved after pruning");
    assert(uploadManager.ipRateLimiter.has("expired.ip.2") === false, "Expired IP entry pruned from memory");

    uploadManager.maxRateLimitEntries = origMaxEntries;
    uploadManager.ipRateLimiter.clear();
  }

  // -------------------------------------------------------------------------
  // TEST 5: Trusted Proxy Validation & Spoofing Defense
  // -------------------------------------------------------------------------
  console.log("\n>>> TEST 5: Trusted Proxy Validation & Spoofing Defense");
  {
    const spoofHeaders = {
      headers: {
        "x-forwarded-for": "198.51.100.1, 203.0.113.50",
        "x-real-ip": "203.0.113.50",
      },
    };

    // Scenario A: TRUST_PROXY is false or unset (Direct connection)
    delete process.env.TRUST_PROXY;
    const directIp = getClientIp(spoofHeaders);
    assert(directIp === "direct-client", "When TRUST_PROXY is not 'true', forwarded headers are strictly ignored");

    // Scenario B: TRUST_PROXY=true with X-Real-IP
    process.env.TRUST_PROXY = "true";
    const realIpResolved = getClientIp(spoofHeaders);
    assert(realIpResolved === "203.0.113.50", "When TRUST_PROXY=true, verified X-Real-IP is preferred");

    // Scenario C: TRUST_PROXY=true with X-Forwarded-For only (Client spoof attempt)
    const xffOnlyReq = {
      headers: {
        "x-forwarded-for": "10.0.0.1, 203.0.113.77", // Leftmost is spoofed, rightmost is proxy-appended
      },
    };
    const xffResolved = getClientIp(xffOnlyReq);
    assert(
      xffResolved === "203.0.113.77",
      "Client spoofed leftmost IP defeated; verified rightmost proxy hop IP extracted"
    );

    // Scenario D: Multi-hop proxy (TRUSTED_PROXY_HOPS=2)
    process.env.TRUSTED_PROXY_HOPS = "2";
    const multiHopReq = {
      headers: {
        "x-forwarded-for": "spoofed.client.ip, 198.51.100.200, 10.0.0.2", // client -> proxy1 -> proxy2
      },
    };
    const multiHopResolved = getClientIp(multiHopReq);
    assert(
      multiHopResolved === "198.51.100.200",
      "TRUSTED_PROXY_HOPS=2 correctly resolved client IP before intermediate reverse proxy"
    );

    delete process.env.TRUST_PROXY;
    delete process.env.TRUSTED_PROXY_HOPS;
  }

  console.log("\n==================================================================");
  console.log(`  PHASE 13.1.4 ALL TESTS PASSED: ${passedTests} / ${totalTests} assertions  `);
  console.log("==================================================================\n");

  uploadManager.stopBackgroundSweeper();
}

runPhase13_1_4Tests().catch((err) => {
  console.error("[FATAL ERROR]:", err);
  process.exit(1);
});
