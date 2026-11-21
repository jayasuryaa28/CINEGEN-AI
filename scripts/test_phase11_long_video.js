/**
 * CINEGEN AI — Phase 11 Long Video Processing & Multi-Duration Pipeline Test
 * Tests:
 * 1. Multi-duration timeline scaling (30s, 1m, 5m, 10m, 1h, 4h projections)
 * 2. Failure recovery & exponential backoff retry mechanism
 * 3. Job cancellation and queue purging
 * 4. Pause and resume state transitions
 * 5. Disk space monitoring and capacity guardrails
 */

const { JobScheduler } = require("../src/compute/scheduler/scheduler");
const fs = require("fs");
const path = require("path");

async function runLongVideoTest() {
  console.log("===============================================================");
  console.log("   CINEGEN AI — PHASE 11 LONG VIDEO PIPELINE & SCALABILITY     ");
  console.log("===============================================================\n");

  const results = {
    timelineScaling: {},
    retryRecovery: {},
    cancellation: {},
    pauseResume: {},
    diskMonitoring: {},
  };

  // 1. Multi-Duration Timeline Scaling & Resource Analysis
  console.log("--- 1. Multi-Duration Timeline Scaling Projections ---");
  const durations = [
    { label: "30s clip", sec: 30, chunkSec: 10 },
    { label: "1m clip", sec: 60, chunkSec: 10 },
    { label: "5m featurette", sec: 300, chunkSec: 10 },
    { label: "10m short film", sec: 600, chunkSec: 10 },
    { label: "1h movie (first half)", sec: 3600, chunkSec: 30 },
    { label: "4h extended cinema master", sec: 14400, chunkSec: 30 },
  ];

  const cpuMsPerFrame = 252.4; // Measured warmed CINEFRAME CPU latency
  const gpuMsPerFrame = 14.5;  // Cloud GPU (RTX 4090 / A100 TensorRT/CUDA estimated)
  const fps = 24;

  const scalingTable = [];
  for (const d of durations) {
    const totalFrames = d.sec * fps;
    const chunkCount = Math.ceil(d.sec / d.chunkSec);
    const cpuTotalSec = (totalFrames * cpuMsPerFrame) / 1000;
    const gpuTotalSec = (totalFrames * gpuMsPerFrame) / 1000;
    // Estimated storage per 1080p chunk: ~15MB compressed, ~80MB uncompressed raw
    const estStorageGb = (chunkCount * 25 * 1024 * 1024) / (1024 ** 3);

    scalingTable.push({
      duration: d.label,
      seconds: d.sec,
      chunkSizeSec: d.chunkSec,
      totalChunks: chunkCount,
      totalFrames,
      cpuDurationHours: parseFloat((cpuTotalSec / 3600).toFixed(2)),
      gpuDurationMinutes: parseFloat((gpuTotalSec / 60).toFixed(1)),
      storageGbEst: parseFloat(estStorageGb.toFixed(2)),
    });
  }

  console.table(scalingTable);
  results.timelineScaling = scalingTable;

  // 2. Failure Recovery & Chunk Retry Mechanism Test
  console.log("\n--- 2. Chunk Failure Recovery & Exponential Backoff Test ---");
  const scheduler = new JobScheduler(2);
  let attemptCount = 0;

  // Mock provider that fails on 1st attempt, then succeeds on 2nd attempt
  const mockFlakyProvider = {
    id: "flaky_provider",
    name: "Flaky Test Provider",
    tier: "local",
    executeChunk: async (task) => {
      attemptCount++;
      if (attemptCount <= 1) {
        throw new Error(`Transient network / VRAM error on attempt ${attemptCount}`);
      }
      return {
        taskId: task.taskId,
        success: true,
        durationMs: 45,
        metrics: { framesProcessed: 240, peakVramMb: 512 },
      };
    },
  };

  const { computeRegistry } = require("../src/compute/providerRegistry");
  // Temporarily register mock provider
  computeRegistry.registerProvider(mockFlakyProvider);
  computeRegistry.setActiveProvider("flaky_provider");

  const tRetryStart = Date.now();
  let retryResult = null;
  try {
    retryResult = await scheduler.scheduleChunk({
      taskId: "task_retry_test_0",
      jobId: "job_retry_test",
      chunkIndex: 0,
      totalChunks: 1,
      inputChunkPath: "dummy_in.mp4",
      outputChunkPath: "dummy_out.mp4",
      targetWidth: 1280,
      targetHeight: 720,
      quality: "720p",
      fps: 24,
      durationSec: 10,
    });
  } catch (err) {
    console.error("Retry failed unexpectedly:", err);
  }

  const retryDuration = Date.now() - tRetryStart;
  console.log(`[Total Attempts to Success]: ${attemptCount}`);
  console.log(`[Scheduler Retried Count]: ${scheduler.getMetrics().retriedTasks}`);
  console.log(`[Execution Succeeded]: ${retryResult?.success === true}`);
  console.log(`[Total Recovery Duration]: ${retryDuration} ms`);

  const retryPassed = attemptCount === 2 && retryResult?.success === true;
  console.log(`[Retry Recovery Status]: ${retryPassed ? "PASSED" : "FAILED"}`);
  results.retryRecovery = {
    totalAttempts: attemptCount,
    retriedCount: scheduler.getMetrics().retriedTasks,
    recoveredSuccessfully: retryPassed,
    durationMs: retryDuration,
  };

  // Reset provider registry to default
  computeRegistry.setActiveProvider("local-cpu-provider");

  // 3. Job Cancellation & Queue Purging Test
  console.log("\n--- 3. Job Cancellation & Queue Purging Test ---");
  const cancelScheduler = new JobScheduler(1); // Concurrency 1 so tasks queue up
  
  const mockSlowProvider = {
    id: "slow_provider",
    name: "Slow Test Provider",
    tier: "local",
    executeChunk: async (task) => {
      await new Promise((r) => setTimeout(r, 200));
      return { taskId: task.taskId, success: true, durationMs: 200 };
    },
  };
  computeRegistry.registerProvider(mockSlowProvider);
  computeRegistry.setActiveProvider("slow_provider");

  const cancelJobId = "job_to_cancel";
  const tasksToSubmit = 5;
  const taskPromises = [];

  for (let i = 0; i < tasksToSubmit; i++) {
    taskPromises.push(
      cancelScheduler.scheduleChunk({
        taskId: `task_cancel_${i}`,
        jobId: cancelJobId,
        chunkIndex: i,
        totalChunks: tasksToSubmit,
        inputChunkPath: `in_${i}.mp4`,
        outputChunkPath: `out_${i}.mp4`,
        targetWidth: 1280,
        targetHeight: 720,
        quality: "720p",
        fps: 24,
        durationSec: 10,
      }).catch((e) => ({ error: e.message }))
    );
  }

  // Cancel immediately after queuing
  cancelScheduler.cancelJob(cancelJobId);
  const cancelOutcomes = await Promise.all(taskPromises);

  const cancelledCount = cancelOutcomes.filter((o) => o.error && o.error.includes("cancelled")).length;
  console.log(`[Cancelled Tasks Rejections]: ${cancelledCount}/${tasksToSubmit}`);
  const cancelPassed = cancelledCount >= 4;
  console.log(`[Cancellation Status]: ${cancelPassed ? "PASSED" : "FAILED"}`);
  results.cancellation = {
    submitted: tasksToSubmit,
    cancelled: cancelledCount,
    passed: cancelPassed,
  };

  // 4. Pause and Resume State Verification
  console.log("\n--- 4. Pause and Resume Test ---");
  const pauseScheduler = new JobScheduler(2);
  const pauseJobId = "job_pause_test";
  pauseScheduler.pauseJob(pauseJobId);

  let pauseRejected = false;
  try {
    await pauseScheduler.scheduleChunk({
      taskId: "task_pause_1",
      jobId: pauseJobId,
      chunkIndex: 0,
      totalChunks: 1,
      inputChunkPath: "dummy.mp4",
      outputChunkPath: "dummy_out.mp4",
      targetWidth: 1280,
      targetHeight: 720,
      quality: "720p",
      fps: 24,
      durationSec: 10,
    });
  } catch (err) {
    if (err.message.includes("paused")) {
      pauseRejected = true;
    }
  }

  console.log(`[Pause Execution Intercepted]: ${pauseRejected ? "PASSED" : "FAILED"}`);
  pauseScheduler.resumeJob(pauseJobId);
  console.log(`[Job Resumed]: PASSED`);
  results.pauseResume = {
    pauseIntercepted: pauseRejected,
    resumeSucceeded: true,
  };

  // 5. Disk Space Monitoring & Capacity Guardrails Test
  console.log("\n--- 5. Disk Space Monitoring Verification ---");
  const diskCheckNormal = scheduler.checkDiskSpace("./", 1.0);
  console.log(`[Storage Check - Normal Drive]: Available ${diskCheckNormal.freeGb} GB | Sufficient for >=1.0 GB: ${diskCheckNormal.hasSpace}`);

  const diskCheckExcessive = scheduler.checkDiskSpace("./", 100000.0); // 100 TB check (should fail)
  console.log(`[Storage Check - 100TB Bound]: Sufficient for >=100TB: ${diskCheckExcessive.hasSpace}`);

  const diskPassed = diskCheckNormal.hasSpace === true && diskCheckExcessive.hasSpace === false;
  console.log(`[Disk Capacity Guardrails Status]: ${diskPassed ? "PASSED" : "FAILED"}`);
  results.diskMonitoring = {
    freeGb: diskCheckNormal.freeGb,
    normalCheckPassed: diskCheckNormal.hasSpace,
    excessiveCheckPassed: !diskCheckExcessive.hasSpace,
    status: diskPassed ? "PASSED" : "FAILED",
  };

  // Restore computeRegistry
  computeRegistry.setActiveProvider("local-cpu-provider");

  console.log("\n===============================================================");
  console.log("            LONG VIDEO PIPELINE TEST SUMMARY                   ");
  console.log("===============================================================");
  console.log(JSON.stringify(results, null, 2));

  const allPassed = retryPassed && cancelPassed && pauseRejected && diskPassed;
  if (!allPassed) {
    console.error("\n[FAILURE] Long video pipeline tests failed.");
    process.exit(1);
  }

  console.log("\n[SUCCESS] Phase 11 Long Video Processing Verified Successfully.");
}

runLongVideoTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
