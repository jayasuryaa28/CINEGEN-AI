# Contributing to CINEGEN AI

Thank you for your interest in contributing to CINEGEN AI! We welcome bug fixes, performance optimizations, documentation improvements, and architectural extensions.

---

## 1. Development Principles

1. **JavaScript/TypeScript Exclusivity**: CINEGEN AI runs purely in modern Node.js and TypeScript. Do not introduce Python runtimes or external proprietary inference APIs.
2. **Deterministic Checkpoint Integrity**: Never commit modified model weights without reproducible training evaluation metrics.
3. **Security Invariant**: Never commit raw API keys, credentials, or personal configuration data.
4. **Verification Gates**: Every pull request must pass the automated regression suite, TypeScript checks, and production build.

---

## 2. Setting Up Your Development Environment

```bash
# Clone the repository
git clone https://github.com/jayasuryaa28/CINEGEN-AI.git
cd CINEGEN-AI

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Verify static typing
npx tsc --noEmit

# Run the core regression test suites
node scripts/test_phase11_regression.js
node scripts/test_phase13_1_4_fixes.js
node scripts/test_phase13_2_perspective.js
node scripts/test_phase13_3_2_validation.js

# Build production bundle
npm run build
```

---

## 3. Pull Request Guidelines

- Branch names should be descriptive (e.g. `fix/upload-lifecycle-lock`, `feat/webgpu-backend`).
- All code must adhere to existing TypeScript styles.
- Include unit/integration tests for any new feature or bug fix.
- Ensure all CI tests pass before requesting review.
