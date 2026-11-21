# CINEGEN AI – Cloud GPU Setup & Provider Integration Guide

---

## 1. Overview

**Mode A (Cloud GPU)** enables high-speed neural restoration by orchestrating remote cloud GPU workers on **RunPod** or **Vast.ai** using your personal API key.

---

## 2. Setting Up Your Account & API Key

### 2.1 RunPod Setup
1. Create or log into your account at [runpod.io](https://www.runpod.io/console).
2. Add community or secure cloud credit ($5 to $10 is sufficient for dozens of hours).
3. Navigate to **Settings** → **API Keys**.
4. Generate a new API key (`rpa_...`).

### 2.2 Vast.ai Setup
1. Create or log into your account at [cloud.vast.ai](https://cloud.vast.ai).
2. Add account funds.
3. Navigate to **Account** → **API Key**.
4. Copy your user API key.

---

## 3. Connecting Your API Key

1. Navigate to `/compute` in CINEGEN AI.
2. Select **Mode A – Cloud GPU Processing**.
3. Choose your provider: **RunPod** or **Vast.ai**.
4. Paste your API key and click **Test & Connect**.
5. CINEGEN AI verifies your key directly with the provider API over TLS.
6. Once validated, your key is encrypted with **AES-256-GCM** and saved securely. The UI displays your masked key (`rpa_••••••••1234`).

---

## 4. Selecting a GPU & Estimating Costs

1. Browse the **Verified GPU Offer Catalog**:
   - **RTX 3090 (24GB VRAM)**: ~$0.18–$0.22/hr (Recommended for 1080p and 1440p feature films).
   - **RTX 4090 (24GB VRAM)**: ~$0.29–$0.34/hr (Recommended for ultra-fast 4K processing).
   - **RTX A4000 (16GB VRAM)**: ~$0.15–$0.17/hr (Budget workstation GPU).
2. Use the **Interactive Cost & Duration Estimator**:
   - Adjust the video duration slider (e.g., 30m, 60m, 120m).
   - Select your target restoration resolution.
   - The estimator calculates real-time factor (RTF), expected cloud processing duration, and exact dollar cost.

---

## 5. Cost Approval & Teardown Verification

- **Explicit Approval Modal**: CINEGEN AI never provisions an instance without presenting an interactive confirmation modal showing the GPU model, hourly rate, and total estimated charge.
- **Teardown Verification**: When your processing job finishes, CINEGEN AI sends a termination command and double-checks with the provider API to verify status is `TERMINATED` or `404 Not Found`, ensuring you are never silently billed.
- **Automatic Local Fallback**: If a remote cloud instance disconnects, CINEGEN AI automatically routes remaining chunks to your local CPU so your job completes reliably.
