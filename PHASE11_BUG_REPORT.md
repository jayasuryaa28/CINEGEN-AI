# CINEGEN AI — Phase 11 Bug Report & Fix Log

**Status:** All Identified Bugs Resolved & Verified  
**Date:** 2026-11-21  

---

## 1. Overview

During Phase 11 execution, all edge cases, runtime errors, and subtle race conditions encountered in testing were recorded, root-caused, and resolved.

---

## 2. Comprehensive Bug Log

### Bug #1: Initial Active Tensors Counted Before Model Loading
- **Severity:** Low (Benchmark Measurement Artifact)
- **Component:** `scripts/test_phase11_inference_opt.js`
- **Symptom:** Initial benchmark reported `leakedTensors: 50`.
- **Root Cause:** TFJS model weights are tensors loaded into memory on `loadLayersModel()`. CINEFRAME has 18 weight tensors and CINEVISION has 32 weight tensors. Measuring baseline before model loading misidentified model weights as leaks.
- **Fix Applied:** Updated test to record baseline tensors *after* models are initialized, then verified that 10 consecutive inference iterations resulted in `delta: 0` leaked tensors.

### Bug #2: Hardcoded Chocolatey FFmpeg Binary Path
- **Severity:** Medium
- **Component:** `scripts/test_phase11_optical_flow.js`
- **Symptom:** `TypeError: Cannot read properties of undefined (reading 'toString')` when launching FFmpeg.
- **Root Cause:** Script hardcoded `C:\ProgramData\chocolatey\bin\ffmpeg.exe`, whereas the host system installs FFmpeg via WinGet at `<workspace-root>`.
- **Fix Applied:** Changed to `process.env.FFMPEG_PATH || "ffmpeg"` and added defensive error object handling.

### Bug #3: Infinite Recursion on Paused Queue Dispatch
- **Severity:** High
- **Component:** `src/compute/scheduler/scheduler.ts` and `src/compute/scheduler/scheduler.js`
- **Symptom:** `RangeError: Maximum call stack size exceeded` in `scheduler.js:86`.
- **Root Cause:** When `runTask` encountered a paused job, it pushed the task to the front of the queue and immediately called `dispatchNext()`. `dispatchNext()` popped the exact same task and called `runTask()` again, creating an infinite synchronous recursion.
- **Fix Applied:** Removed synchronous `dispatchNext()` invocation inside the pause check and updated `dispatchNext()` to filter out tasks belonging to paused jobs:
  `const index = this.queue.findIndex((t) => !this.pausedJobIds.has(t.task.jobId));`

### Bug #4: Orphaned Promises on Job Cancellation
- **Severity:** High
- **Component:** `src/compute/scheduler/scheduler.ts` and `src/compute/scheduler/scheduler.js`
- **Symptom:** Test execution hung indefinitely waiting for `Promise.all(taskPromises)` after `cancelJob()`.
- **Root Cause:** `cancelJob(jobId)` used `this.queue.filter(...)` to discard tasks from the array without invoking the task's `reject` callback. The corresponding outer promises remained permanently unresolved.
- **Fix Applied:** Updated `cancelJob` to iterate through the queue, mark matching tasks as `"cancelled"`, and invoke `t.reject(new Error("Job cancelled"))`.

### Bug #5: Property Extraction Mismatch in Multi-User Test
- **Severity:** Low (Test Harness)
- **Component:** `scripts/test_phase11_multiuser.js`
- **Symptom:** `completedByUser` counter remained at 0 despite tasks completing.
- **Root Cause:** `task.jobId.split("_")` on `"job_user_alpha_restore"` gave `"job_user"` instead of `"user_alpha"`.
- **Fix Applied:** Replaced splitting with regex `task.jobId.match(/job_(user_\w+)_/)`.

### Bug #6: Raw PCM Buffer Lacking WAV Header
- **Severity:** Medium
- **Component:** `scripts/test_phase11_regression.js`
- **Symptom:** `Error: Invalid WAV format: Missing RIFF/WAVE header`.
- **Root Cause:** Test created a raw PCM buffer without the standard 44-byte RIFF header required by `AudioDSP.decodeWav()`.
- **Fix Applied:** Generated audio buffer via `AudioDSP.encodeWav(floatSamples, sampleRate)`.
