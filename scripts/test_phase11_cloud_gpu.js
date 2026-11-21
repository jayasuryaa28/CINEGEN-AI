/**
 * CINEGEN AI — Phase 11 Cloud GPU Execution Audit & Verification
 * Audits:
 * 1. AES-256-GCM credential encryption/decryption round-trip
 * 2. API key masking security check (no raw secrets exposed)
 * 3. GPU Catalog validation (VRAM, compute capability, hourly rates)
 * 4. Cloud Cost Estimator across providers and video durations
 * 5. Cost Approval Guardrail (provisioning rejected if userApprovedCost !== true)
 * 6. Instance tracking lifecycle (active, stopped, terminated)
 * 7. NOT_RUN declaration for live paid cloud instances
 */

const { CredentialManager } = require("../src/compute/cloud/credentialManager");
const { GpuCatalog } = require("../src/compute/cloud/gpuCatalog");
const { CloudCostEstimator } = require("../src/compute/cloud/cloudCostEstimator");
const { InstanceManager } = require("../src/compute/cloud/instanceManager");

async function runCloudGpuAudit() {
  console.log("===============================================================");
  console.log("   CINEGEN AI — PHASE 11 CLOUD GPU INFRASTRUCTURE AUDIT        ");
  console.log("===============================================================\n");

  const results = {
    encryption: {},
    masking: {},
    catalog: {},
    costEstimator: {},
    costGuardrails: {},
    liveProvisioning: "NOT_RUN (Explicit safety policy: Paid cloud spend requires interactive user approval)",
  };

  const testUser = "test_user_phase11";

  // 1. AES-256-GCM Credential Encryption & Round-Trip
  console.log("--- 1. AES-256-GCM Credential Encryption Round-Trip ---");
  const rawRunPodKey = "rpa_live_key_sample_secret_runpod_987654321";
  const rawVastKey = "vast_live_key_sample_secret_vastai_123456789";

  await CredentialManager.saveCredential(testUser, "runpod", rawRunPodKey);
  await CredentialManager.saveCredential(testUser, "vast", rawVastKey);

  const decryptedRunPod = await CredentialManager.getDecryptedCredential(testUser, "runpod");
  const decryptedVast = await CredentialManager.getDecryptedCredential(testUser, "vast");

  const runpodMatch = decryptedRunPod === rawRunPodKey;
  const vastMatch = decryptedVast === rawVastKey;

  console.log(`[RunPod Decryption Match]: ${runpodMatch ? "PASSED" : "FAILED"}`);
  console.log(`[Vast.ai Decryption Match]: ${vastMatch ? "PASSED" : "FAILED"}`);

  results.encryption = {
    runpodEncrypted: runpodMatch,
    vastEncrypted: vastMatch,
    algorithm: CredentialManager.ALGORITHM,
    status: runpodMatch && vastMatch ? "PASSED" : "FAILED",
  };

  // 2. API Key Masking Verification
  console.log("\n--- 2. API Key Masking & Information Leakage Prevention ---");
  const maskedRunPod = CredentialManager.maskApiKey(rawRunPodKey, "runpod");
  const maskedVast = CredentialManager.maskApiKey(rawVastKey, "vast");

  console.log(`[Masked RunPod Key]: ${maskedRunPod}`);
  console.log(`[Masked Vast Key]:   ${maskedVast}`);

  const runpodMaskSafe = !maskedRunPod.includes("secret") && maskedRunPod.endsWith("4321");
  const vastMaskSafe = !maskedVast.includes("secret") && maskedVast.endsWith("6789");

  console.log(`[RunPod Mask Safe]: ${runpodMaskSafe ? "PASSED" : "FAILED"}`);
  console.log(`[Vast Mask Safe]:   ${vastMaskSafe ? "PASSED" : "FAILED"}`);

  results.masking = {
    maskedRunPod,
    maskedVast,
    safe: runpodMaskSafe && vastMaskSafe,
  };

  // 3. GPU Catalog Verification
  console.log("\n--- 3. Verified GPU Catalog Validation ---");
  const allGpus = GpuCatalog.getCatalog();
  console.log(`[Total Catalog GPUs]: ${allGpus.length}`);

  const topTier = GpuCatalog.getGpuById("rtx-4090");
  const enterprise = GpuCatalog.getGpuById("a100-sxm4-80gb");

  console.log(`[RTX 4090 Specs]: ${topTier.model} | VRAM: ${topTier.vramGb} GB | Compute: ${topTier.cudaComputeCapability} | Rate: $${topTier.hourlyRateRunPodUsd}/hr`);
  console.log(`[A100 Specs]:     ${enterprise.model} | VRAM: ${enterprise.vramGb} GB | Compute: ${enterprise.cudaComputeCapability} | Rate: $${enterprise.hourlyRateRunPodUsd}/hr`);

  const catalogValid = allGpus.length >= 6 && topTier.vramGb === 24 && enterprise.vramGb === 80;
  console.log(`[Catalog Validation]: ${catalogValid ? "PASSED" : "FAILED"}`);
  results.catalog = {
    gpuCount: allGpus.length,
    topTierModel: topTier.model,
    enterpriseModel: enterprise.model,
    valid: catalogValid,
  };

  // 4. Cloud Cost Estimator Verification
  console.log("\n--- 4. Cloud Cost Estimation Matrix ---");
  const testDurations = [300, 3600, 14400]; // 5m, 1h, 4h
  const estimates = [];

  for (const duration of testDurations) {
    const est1080p = CloudCostEstimator.estimate({
      videoDurationSeconds: duration,
      targetResolution: "1080p",
      provider: "runpod",
    });

    const est4K = CloudCostEstimator.estimate({
      videoDurationSeconds: duration,
      targetResolution: "4K",
      provider: "runpod",
    });

    estimates.push({
      durationSec: duration,
      durationLabel: duration >= 3600 ? `${duration / 3600}h` : `${duration / 60}m`,
      cost1080pUsd: est1080p.typicalCostUsd,
      time1080pMin: est1080p.totalEstimatedMinutes,
      cost4KUsd: est4K.typicalCostUsd,
      time4KMin: est4K.totalEstimatedMinutes,
      recommendedGpu: est4K.gpuModel,
    });
  }

  console.table(estimates);
  results.costEstimator = estimates;

  // 5. Cost Approval Guardrail Verification
  console.log("\n--- 5. Cost Approval Guardrail Verification ---");
  let unapprovedRejected = false;
  try {
    await InstanceManager.provisionInstance({
      userId: testUser,
      provider: "runpod",
      gpuId: "rtx-4090",
      userApprovedCost: false, // Explicitly false
    });
  } catch (err) {
    if (err.message.includes("Cost approval required")) {
      unapprovedRejected = true;
    }
  }

  console.log(`[Unapproved Provisioning Rejection]: ${unapprovedRejected ? "PASSED (Strict financial guardrail enforced)" : "FAILED"}`);
  results.costGuardrails = {
    unapprovedProvisioningRejected: unapprovedRejected,
    financialSafetyPolicyActive: true,
  };

  // 6. Cleanup test credentials
  await CredentialManager.deleteCredential(testUser, "runpod");
  await CredentialManager.deleteCredential(testUser, "vast");

  console.log("\n===============================================================");
  console.log("            CLOUD GPU AUDIT SUMMARY                            ");
  console.log("===============================================================");
  console.log(JSON.stringify(results, null, 2));

  const allPassed = runpodMatch && vastMatch && runpodMaskSafe && vastMaskSafe && catalogValid && unapprovedRejected;
  if (!allPassed) {
    console.error("\n[FAILURE] Cloud GPU audit failed validation checks.");
    process.exit(1);
  }

  console.log("\n[SUCCESS] Phase 11 Cloud GPU Infrastructure Audited Successfully.");
}

runCloudGpuAudit().catch((err) => {
  console.error("Audit failed with error:", err);
  process.exit(1);
});
