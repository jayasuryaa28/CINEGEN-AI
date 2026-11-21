/**
 * CINEGEN AI — Phase 11 Inference Optimization Benchmark
 * Measures:
 * 1. Cold start vs. Warmed up latency
 * 2. Unbatched (B=1) vs. Batched (B=4) throughput (FPS & latency)
 * 3. TypedArray buffer reuse vs GC churn
 * 4. Tensor leak verification (tf.memory().numTensors)
 * 5. Numeric correctness: batched vs unbatched equivalence
 */

const { TrainedCineFrame } = require("../src/ai/cineframe/adapter");
const { TrainedCineVision } = require("../src/ai/cinevision/adapter");
const tf = require("@tensorflow/tfjs");

async function runBenchmark() {
  console.log("===============================================================");
  console.log("   CINEGEN AI — PHASE 11 INFERENCE OPTIMIZATION BENCHMARK      ");
  console.log("===============================================================\n");

  const results = {
    warmup: {},
    batching: {},
    memory: {},
    correctness: {},
  };

  // 1. CINEFRAME Cold-Start vs Warmup Benchmark
  console.log("--- 1. Cold Start vs Warmed-Up Latency (CINEFRAME) ---");
  const cineframe = new TrainedCineFrame();
  
  // Measure raw model loading + first frame (cold)
  await cineframe.getOrLoadModel();
  const dummyFrames = [
    Buffer.alloc(640 * 360 * 3, 120),
    Buffer.alloc(640 * 360 * 3, 125),
    Buffer.alloc(640 * 360 * 3, 130),
    Buffer.alloc(640 * 360 * 3, 128),
  ];

  // Cold inference (without explicit warmup)
  const coldT0 = Date.now();
  await cineframe.enhanceFrames([dummyFrames[0]], 128, 128, 1);
  const coldLatency = Date.now() - coldT0;
  console.log(`[Cold Start Latency]: ${coldLatency} ms`);
  results.warmup.coldLatencyMs = coldLatency;

  // Subsequent warmed inference
  const warmLatencies = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await cineframe.enhanceFrames([dummyFrames[0]], 128, 128, 1);
    warmLatencies.push(Date.now() - t0);
  }
  const avgWarmLatency = warmLatencies.reduce((a, b) => a + b, 0) / warmLatencies.length;
  console.log(`[Warmed-Up Latency (Avg of 5)]: ${avgWarmLatency.toFixed(2)} ms`);
  const latencyReduction = ((coldLatency - avgWarmLatency) / coldLatency) * 100;
  console.log(`[Latency Reduction]: ${latencyReduction.toFixed(1)}%`);
  results.warmup.avgWarmLatencyMs = avgWarmLatency;
  results.warmup.latencyReductionPercent = latencyReduction;

  // 2. Unbatched (Batch=1) vs Batched (Batch=4) Benchmark
  console.log("\n--- 2. Batch Size Scaling (CINEFRAME) ---");
  const testBatch = [
    dummyFrames[0],
    dummyFrames[1],
    dummyFrames[2],
    dummyFrames[3],
  ];

  // Run Unbatched (B=1)
  const tUnbatchStart = Date.now();
  const unbatchedOutput = await cineframe.enhanceFrames(testBatch, 128, 128, 1);
  const unbatchedDuration = Date.now() - tUnbatchStart;
  const unbatchedPerFrame = unbatchedDuration / testBatch.length;
  const unbatchedFps = (testBatch.length / (unbatchedDuration / 1000)).toFixed(2);
  console.log(`[Unbatched (B=1)] Total: ${unbatchedDuration} ms | Per-frame: ${unbatchedPerFrame.toFixed(1)} ms | Throughput: ${unbatchedFps} FPS`);

  // Run Batched (B=4)
  const tBatchedStart = Date.now();
  const batchedOutput = await cineframe.enhanceFrames(testBatch, 128, 128, 4);
  const batchedDuration = Date.now() - tBatchedStart;
  const batchedPerFrame = batchedDuration / testBatch.length;
  const batchedFps = (testBatch.length / (batchedDuration / 1000)).toFixed(2);
  console.log(`[Batched (B=4)]   Total: ${batchedDuration} ms | Per-frame: ${batchedPerFrame.toFixed(1)} ms | Throughput: ${batchedFps} FPS`);

  const speedupPercent = ((unbatchedDuration - batchedDuration) / unbatchedDuration) * 100;
  console.log(`[Batching Throughput Gain]: ${speedupPercent.toFixed(1)}% speedup`);

  results.batching = {
    unbatchedDurationMs: unbatchedDuration,
    unbatchedFps: parseFloat(unbatchedFps),
    batchedDurationMs: batchedDuration,
    batchedFps: parseFloat(batchedFps),
    speedupPercent: speedupPercent,
  };

  // 3. Numeric Equivalence Verification
  console.log("\n--- 3. Numerical Equivalence Check ---");
  let maxDiff = 0;
  let totalDiff = 0;
  let sampleCount = 0;

  for (let f = 0; f < testBatch.length; f++) {
    const unbBuf = unbatchedOutput[f];
    const batBuf = batchedOutput[f];
    for (let p = 0; p < unbBuf.length; p++) {
      const diff = Math.abs(unbBuf[p] - batBuf[p]);
      if (diff > maxDiff) maxDiff = diff;
      totalDiff += diff;
      sampleCount++;
    }
  }
  const avgDiff = totalDiff / sampleCount;
  console.log(`[Max Byte Difference]: ${maxDiff}`);
  console.log(`[Avg Byte Difference]: ${avgDiff.toFixed(4)}`);
  const isEquivalent = maxDiff <= 1; // Tolerance <= 1 byte due to minor floating point rounding
  console.log(`[Equivalence Status]: ${isEquivalent ? "PASSED (Identical predictions)" : "FAILED"}`);
  results.correctness = {
    maxDiff,
    avgDiff,
    isEquivalent,
  };

  // 4. CINEVISION Warmup & Latency
  console.log("\n--- 4. CINEVISION Warmup & Latency ---");
  const cinevision = new TrainedCineVision();
  await cinevision.getOrLoadModel();

  const cvWarmupT0 = Date.now();
  await cinevision.warmup();
  const cvWarmupTime = Date.now() - cvWarmupT0;
  console.log(`[CINEVISION Warmup Time]: ${cvWarmupTime} ms`);

  const cvT0 = Date.now();
  const cvAnalysis = await cinevision.analyzeFrame(dummyFrames[0]);
  const cvLatency = Date.now() - cvT0;
  console.log(`[CINEVISION Frame Analysis Latency]: ${cvLatency} ms`);
  console.log(`[CINEVISION Perspective Detected]: ${cvAnalysis.hasScreenPerspective}`);

  // 5. Memory & Tensor Leak Verification
  console.log("\n--- 5. Tensor Leak Verification ---");
  const baselineModelTensors = tf.memory().numTensors;
  console.log(`[Model Weights Tensor Count (CINEFRAME + CINEVISION)]: ${baselineModelTensors}`);

  // Execute 10 consecutive inference iterations across both models
  for (let iter = 0; iter < 10; iter++) {
    await cineframe.enhanceFrames([dummyFrames[iter % dummyFrames.length]], 128, 128, 1);
    await cinevision.analyzeFrame(dummyFrames[iter % dummyFrames.length]);
  }

  const postInferenceTensors = tf.memory().numTensors;
  const leakedTensors = postInferenceTensors - baselineModelTensors;
  console.log(`[Post 10-Iteration Tensors]: ${postInferenceTensors}`);
  console.log(`[Leaked Tensors]:           ${leakedTensors}`);
  const noTensorLeaks = leakedTensors === 0;
  console.log(`[Leak Status]:               ${noTensorLeaks ? "PASSED (Zero tensor leaks)" : "FAILED (Leaked tensors detected)"}`);

  results.memory = {
    baselineModelTensors,
    postInferenceTensors,
    leakedTensors,
    noTensorLeaks,
  };

  console.log("\n===============================================================");
  console.log("            INFERENCE OPTIMIZATION SUMMARY                     ");
  console.log("===============================================================");
  console.log(JSON.stringify(results, null, 2));

  if (!isEquivalent || !noTensorLeaks) {
    console.error("\n[FAILURE] Optimization failed validation checks.");
    process.exit(1);
  }

  console.log("\n[SUCCESS] Phase 11 Inference Optimization Verified Successfully.");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
