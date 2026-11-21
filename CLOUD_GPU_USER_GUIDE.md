# CINEGEN AI – CLOUD GPU USER GUIDE (MODE A)
**How to Connect Your RunPod or Vast.ai Account for High-Speed Restoration**

---

## 1. Overview

CINEGEN AI allows you to connect your personal cloud GPU accounts from **RunPod** and **Vast.ai** using your personal API keys. 

### Why Use Cloud GPU Mode?
- **Speed**: Process full-length 1080p and 4K feature films up to **10x–20x faster** than on a local laptop CPU.
- **Cost**: You only pay the provider directly for the exact minutes used (typically **$0.20 – $0.40 / hour** for an RTX 4090 or RTX 3090).
- **Zero Markups**: CINEGEN AI charges no subscription or token fees for cloud compute.

---

## 2. Getting Your API Key

### Option A: RunPod
1. Log into your [RunPod Console](https://www.runpod.io/console).
2. Navigate to **User Settings** → **API Keys**.
3. Click **Create API Key**.
4. Copy the generated key (starts with `rpa_...`).

### Option B: Vast.ai
1. Log into your [Vast.ai Console](https://cloud.vast.ai).
2. Navigate to **Account** → **API Key**.
3. Generate or copy your API key.

---

## 3. Connecting Your API Key in CINEGEN AI

1. Open CINEGEN AI in your browser.
2. In the top navigation bar, click **Compute Mode** (or navigate to `/compute`).
3. Select **Mode A – Cloud GPU Processing**.
4. Choose your provider: **RunPod** or **Vast.ai**.
5. Paste your API key into the input field.
6. Click **Test & Connect**:
   - CINEGEN AI verifies the key directly with the provider.
   - Upon verification, your key is encrypted with **AES-256-GCM** and stored securely on your server.
   - The UI displays a masked confirmation (e.g. `rpa_••••••••1234`).

---

## 4. Selecting a GPU & Estimating Costs

1. Scroll down to the **Verified GPU Offer Catalog**.
2. Select your desired GPU:
   - **RTX 3090 (24GB VRAM)**: Best value for 1080p and 1440p videos (~$0.22/hr).
   - **RTX 4090 (24GB VRAM)**: Top performance for 4K restorations (~$0.34/hr).
   - **RTX A4000 (16GB VRAM)**: Reliable budget workstation GPU (~$0.17/hr).
3. Use the **Interactive Cost & Time Estimator**:
   - Drag the duration slider (e.g., 30 minutes, 60 minutes, 120 minutes).
   - Select your target restoration resolution (720p, 1080p, 1440p, 4K).
   - Review the estimated cloud processing time and total billable cost.

---

## 5. Launching & Managing Cloud Instances

1. Click **Provision Cloud Worker**.
2. A confirmation modal displays:
   - GPU Model selected.
   - Hourly rate.
   - Explicit confirmation checkbox.
3. Click **Confirm & Launch**.
4. The instance will initialize in the **Active Cloud GPU Instances** section.
5. When your video processing completes, CINEGEN AI automatically triggers teardown verification. You can also manually terminate any instance at any time by clicking **Terminate**.

---

## 6. Automatic Fallback Protection

If your cloud instance encounters network drops or provider outages, CINEGEN AI's **Cloud-to-Local Fallback** automatically delegates pending chunks to your local CPU so your processing job never halts or loses progress.
