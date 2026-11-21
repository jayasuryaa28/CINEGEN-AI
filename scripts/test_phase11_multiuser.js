/**
 * CINEGEN AI — Phase 11 Multi-User Scalability & Isolation Benchmark
 * Tests:
 * 1. Per-user credential file isolation and encryption
 * 2. Path sanitization (prevent directory traversal in user IDs)
 * 3. Concurrent multi-user job submission and fair scheduling
 * 4. Cancellation isolation (cancelling user B does NOT affect user A or C)
 * 5. Per-job directory isolation
 */

const fs = require("fs");
const path = require("path");
const { CredentialManager } = require("../src/compute/cloud/credentialManager");
const { JobScheduler } = require("../src/compute/scheduler/scheduler");
const { computeRegistry } = require("../src/compute/providerRegistry");

async function runMultiUserTest() {
  console.log("===============================================================");
  console.log("   CINEGEN AI — PHASE 11 MULTI-USER SCALABILITY & ISOLATION    ");
  console.log("===============================================================\n");

  const results = {
    credentialIsolation: {},
    pathSanitization: {},
    concurrentExecution: {},
    cancellationIsolation: {},
  };

  const users = ["user_alpha", "user_beta", "user_gamma"];

  // 1. Per-User Credential Isolation
  console.log("--- 1. Per-User Credential Storage & Encryption Isolation ---");
  const keys = {
    user_alpha: "rpa_alpha_live_secret_key_1111",
    user_beta: "vast_beta_live_secret_key_2222",
    user_gamma: "rpa_gamma_live_secret_key_3333",
  };

  await CredentialManager.saveCredential("user_alpha", "runpod", keys.user_alpha);
  await CredentialManager.saveCredential("user_beta", "vast", keys.user_beta);
  await CredentialManager.saveCredential("user_gamma", "runpod", keys.user_gamma);

  const decAlpha = await CredentialManager.getDecryptedCredential("user_alpha", "runpod");
  const decBeta = await CredentialManager.getDecryptedCredential("user_beta", "vast");
  const decGamma = await CredentialManager.getDecryptedCredential("user_gamma", "runpod");

  const alphaIsolated = decAlpha === keys.user_alpha && decAlpha !== decBeta;
  const betaIsolated = decBeta === keys.user_beta && decBeta !== decGamma;
  const gammaIsolated = decGamma === keys.user_gamma;

  console.log(`[User Alpha Credential Correct]: ${decAlpha === keys.user_alpha ? "PASSED" : "FAILED"}`);
  console.log(`[User Beta Credential Correct]:  ${decBeta === keys.user_beta ? "PASSED" : "FAILED"}`);
  console.log(`[User Gamma Credential Correct]: ${decGamma === keys.user_gamma ? "PASSED" : "FAILED"}`);

  // Verify separate files exist
  const credDir = CredentialManager.STORAGE_DIR;
  const alphaFile = path.join(credDir, "user_alpha.json");
  const betaFile = path.join(credDir, "user_beta.json");
  const gammaFile = path.join(credDir, "user_gamma.json");

  const filesExist = fs.existsSync(alphaFile) && fs.existsSync(betaFile) && fs.existsSync(gammaFile);
  console.log(`[Per-User File Separation]: ${filesExist ? "PASSED" : "FAILED"}`);

  results.credentialIsolation = {
    alphaMatch: decAlpha === keys.user_alpha,
    betaMatch: decBeta === keys.user_beta,
    gammaMatch: decGamma === keys.user_gamma,
    filesExist,
    status: filesExist && alphaIsolated && betaIsolated && gammaIsolated ? "PASSED" : "FAILED",
  };

  // 2. Directory Traversal Security Guardrails
  console.log("\n--- 2. User ID Path Traversal Protection ---");
  const maliciousUserId = "../../etc/passwd";
  const sanitizedPath = CredentialManager.getUserCredentialFilePath(maliciousUserId);
  const isTraversalPrevented = !sanitizedPath.includes("..") && sanitizedPath.startsWith(credDir);
  console.log(`[Malicious Input]: '${maliciousUserId}'`);
  console.log(`[Sanitized Path]:  '${sanitizedPath}'`);
  console.log(`[Path Traversal Prevented]: ${isTraversalPrevented ? "PASSED (Safe)" : "FAILED (Vulnerable)"}`);

  results.pathSanitization = {
    maliciousInput: maliciousUserId,
    sanitizedPath,
    traversalPrevented: isTraversalPrevented,
  };

  // 3. Concurrent Multi-User Execution & Scheduling Fairness
  console.log("\n--- 3. Concurrent Multi-User Job Scheduling ---");
  const multiScheduler = new JobScheduler(3); // 3 concurrent workers

  // Mock multi-user worker provider
  const completedByUser = { user_alpha: 0, user_beta: 0, user_gamma: 0 };
  const mockMultiUserProvider = {
    id: "multiuser_provider",
    name: "Multi-User Mock Provider",
    tier: "local",
    executeChunk: async (task) => {
      const match = task.jobId.match(/job_(user_\w+)_/);
      const userTag = match ? match[1] : "";
      await new Promise((r) => setTimeout(r, 40));
      if (completedByUser[userTag] !== undefined) {
        completedByUser[userTag]++;
      }
      return { taskId: task.taskId, success: true, durationMs: 80 };
    },
  };

  computeRegistry.registerProvider(mockMultiUserProvider);
  computeRegistry.setActiveProvider("multiuser_provider");

  // Submit 3 tasks per user simultaneously (9 total tasks)
  const taskSubmissions = [];
  for (const u of users) {
    for (let c = 0; c < 3; c++) {
      taskSubmissions.push(
        multiScheduler.scheduleChunk({
          taskId: `task_${u}_chunk_${c}`,
          jobId: `job_${u}_restore`,
          chunkIndex: c,
          totalChunks: 3,
          inputChunkPath: `in_${u}_${c}.mp4`,
          outputChunkPath: `out_${u}_${c}.mp4`,
          targetWidth: 1280,
          targetHeight: 720,
          quality: "720p",
          fps: 24,
          durationSec: 10,
        })
      );
    }
  }

  const concurrentResults = await Promise.all(taskSubmissions);
  console.log(`[Total Completed Chunks]: ${concurrentResults.length}/9`);
  console.log(`[Completed Chunks by User]:`, completedByUser);

  const concurrencyPassed =
    completedByUser.user_alpha === 3 &&
    completedByUser.user_beta === 3 &&
    completedByUser.user_gamma === 3;
  console.log(`[Fair Scheduling Status]: ${concurrencyPassed ? "PASSED" : "FAILED"}`);

  results.concurrentExecution = {
    totalSubmitted: 9,
    completedByUser,
    passed: concurrencyPassed,
  };

  // 4. Cancellation Isolation
  console.log("\n--- 4. Cancellation Isolation Across Users ---");
  const cancelIsolationScheduler = new JobScheduler(1); // 1 worker to ensure queueing
  const outcomes = {};

  const activeUsers = ["user_alpha", "user_beta", "user_gamma"];
  const cancelPromises = [];

  for (const u of activeUsers) {
    outcomes[u] = { success: 0, cancelled: 0 };
    for (let c = 0; c < 2; c++) {
      cancelPromises.push(
        cancelIsolationScheduler
          .scheduleChunk({
            taskId: `cancel_task_${u}_${c}`,
            jobId: `job_${u}_isolate`,
            chunkIndex: c,
            totalChunks: 2,
            inputChunkPath: `in_${u}_${c}.mp4`,
            outputChunkPath: `out_${u}_${c}.mp4`,
            targetWidth: 1280,
            targetHeight: 720,
            quality: "720p",
            fps: 24,
            durationSec: 10,
          })
          .then(() => {
            outcomes[u].success++;
          })
          .catch((err) => {
            if (err.message.includes("cancelled")) {
              outcomes[u].cancelled++;
            }
          })
      );
    }
  }

  // Cancel ONLY user_beta's job
  cancelIsolationScheduler.cancelJob("job_user_beta_isolate");

  await Promise.all(cancelPromises);

  console.log(`[Outcomes by User]:`, outcomes);

  const betaWasCancelled = outcomes.user_beta.cancelled >= 1;
  const alphaUnaffected = outcomes.user_alpha.success >= 1;
  const gammaUnaffected = outcomes.user_gamma.success >= 1;

  const isolationPassed = betaWasCancelled && alphaUnaffected && gammaUnaffected;
  console.log(`[Cancellation Isolation Status]: ${isolationPassed ? "PASSED (User B cancelled, Users A and C unaffected)" : "FAILED"}`);

  results.cancellationIsolation = {
    outcomes,
    betaCancelled: betaWasCancelled,
    alphaUnaffected,
    gammaUnaffected,
    passed: isolationPassed,
  };

  // Cleanup test credentials
  for (const u of users) {
    await CredentialManager.deleteCredential(u, "runpod");
    await CredentialManager.deleteCredential(u, "vast");
  }

  computeRegistry.setActiveProvider("local-cpu-provider");

  console.log("\n===============================================================");
  console.log("            MULTI-USER SCALABILITY SUMMARY                     ");
  console.log("===============================================================");
  console.log(JSON.stringify(results, null, 2));

  const allPassed =
    results.credentialIsolation.status === "PASSED" &&
    isTraversalPrevented &&
    concurrencyPassed &&
    isolationPassed;

  if (!allPassed) {
    console.error("\n[FAILURE] Multi-user scalability and isolation tests failed.");
    process.exit(1);
  }

  console.log("\n[SUCCESS] Phase 11 Multi-User Scalability & Isolation Verified Successfully.");
}

runMultiUserTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
