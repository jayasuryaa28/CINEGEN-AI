# CINEGEN AI – API KEY SECURITY ARCHITECTURE
**Zero-Trust Credential Management and Cryptographic Protection**

---

## 1. Principles of Credential Security in CINEGEN AI

To ensure user API keys for RunPod and Vast.ai are strictly protected against theft, leakage, or unauthorized billing, CINEGEN AI enforces the following security invariants:

1. **Never Stored in Plaintext**: Plaintext API keys never touch disk files or database tables.
2. **Never Exposed to the Browser**: Frontend client bundles and API responses only ever receive masked keys (`rpa_••••••••1234` or `vast_••••••••abcd`).
3. **Never Logged**: Raw keys are excluded from application logs, debugging output, and telemetry.
4. **Isolated Per User**: Each user's credentials are encrypted in a dedicated, isolated record.
5. **Approval-Gated Spending**: No cloud instance can be provisioned without explicit, documented user approval.

---

## 2. Cryptographic Architecture

### 2.1 Encryption Algorithm
- **Cipher**: `AES-256-GCM` (Galois/Counter Mode).
- **Key Derivation**: 256-bit key generated via SHA-256 from server environment secrets (`ENCRYPTION_SECRET` / `NEXTAUTH_SECRET`).
- **Initialization Vector (IV)**: A cryptographically secure 96-bit (12-byte) random buffer generated uniquely for every encryption operation using Node.js `crypto.randomBytes(12)`.
- **Authentication Tag**: A 128-bit (16-byte) GCM authentication tag verifying ciphertext authenticity and guarding against tampering.

### 2.2 Storage Schema (`storage_data/credentials/<userId>.json`)
```json
{
  "runpod": {
    "provider": "runpod",
    "encryptedKey": "d38a9f24e1837bc4...",
    "iv": "3a7b9c1d2e4f5a6b7c8d9e0f",
    "tag": "e1f2a3b4c5d6e7f80918273645abcdef",
    "maskedKey": "rpa_••••••••1234",
    "updatedAt": "2026-11-21T08:50:00.000Z"
  }
}
```
File permissions are locked to `0600` (read/write by owner process only).

---

## 3. Threat Model & Mitigations

| Threat | Mitigation Mechanism | Verification Test |
|---|---|---|
| **Disk Inspection / Compromise** | Data at rest is AES-256-GCM encrypted; plaintext search on disk returns 0 occurrences. | Test 12 in `test_phase7_1_dual_compute.js` |
| **Cross-User Data Access** | User files are separated by `userId` in `getUserCredentialFilePath()`. | Test 13 in `test_phase7_1_dual_compute.js` |
| **Browser / Client Sniffing** | GET `/api/compute/credentials` returns masked keys only. | Inspected Network tab & API response |
| **Runaway Billing** | Mandatory approval gate (`userApprovedCost: true`) and automated teardown verification. | Tests 9 and 11 in `test_phase7_1_dual_compute.js` |
| **Network Interception** | All communication with RunPod and Vast.ai occurs exclusively over TLS 1.3 / HTTPS. | Audited `https` requests in `runpodProvider.ts` and `vastProvider.ts` |
