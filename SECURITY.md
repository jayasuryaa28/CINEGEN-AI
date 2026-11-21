# Security Policy for CINEGEN AI

CINEGEN AI takes the security of user data, cloud infrastructure credentials, and media files seriously.

---

## 1. Supported Versions

| Version | Supported |
|---|:---:|
| 0.1.0-alpha (main branch) | Yes |
| < 0.1.0 | No |

---

## 2. Reporting a Vulnerability

> [!IMPORTANT]
> **Maintainer Action Required Before Public Release**  
> Vulnerability reporting will be managed through **GitHub Private Vulnerability Reporting** (Security tab -> "Report a vulnerability").  
> The repository maintainer must enable GitHub Private Vulnerability Reporting in repository settings upon creating the public GitHub repository.

If you discover a security vulnerability or credential exposure risk:

1. **Do not create a public GitHub issue.**
2. Use the **GitHub "Report a vulnerability"** feature in the repository Security advisory tab once the public repository is published.
3. Alternatively, until the advisory tab is active, contact the primary repository maintainer through their verified GitHub profile contact details.
4. When submitting a report, please include:
   - Detailed description of the vulnerability.
   - Minimal steps to reproduce or a self-contained proof-of-concept.
   - Affected components, services, or endpoints.
   - Potential impact assessment.
   - Any proposed remediations.
5. The maintainers aim to acknowledge receipt within 48 hours and provide status updates until a resolution is deployed.

---

## 3. Cryptographic Standards & Design Guards

- **Credential Encryption**: Client cloud API credentials are encrypted at rest with **AES-256-GCM** using unique 96-bit random IVs and 128-bit authentication tags (`src/services/storage.ts`).
- **Frontend Isolation**: No raw credentials or encryption secrets are ever exposed in client-side bundles.
- **Upload Hardening**: Session IDs are strict UUIDv4 tokens. Upload paths are quarantined to isolated staging directories. All chunk writes are bound by global concurrency limits and atomic reservation locks (`src/services/uploadManager.ts`).
- **Integrity Validation**: Uploaded media must pass SHA-256 verification and FFprobe stream validation before entering the processing pipeline.
