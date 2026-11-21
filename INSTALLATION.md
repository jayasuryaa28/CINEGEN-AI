# CINEGEN AI – Installation & Setup Guide
**Cross-Platform Instructions for Windows, Linux, and macOS**

---

## 1. Prerequisites

Before installing CINEGEN AI, ensure the following core tools are installed on your system:

### 1.1 Node.js
- **Required Version**: Node.js `v18.18.0` or higher (`v20.x` LTS or `v22.x` recommended).
- **Download**: [nodejs.org](https://nodejs.org/)
- **Verify Installation**:
  ```bash
  node -v
  npm -v
  ```

### 1.2 FFmpeg & FFprobe
CINEGEN AI relies on FFmpeg for audio demuxing, video chunking, and final container synchronization.
- **Required Version**: FFmpeg `5.0` or higher (`8.x` verified).
- **Windows**:
  - Download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) or install via winget:
    ```powershell
    winget install Gyan.FFmpeg
    ```
  - Ensure `ffmpeg.exe` and `ffprobe.exe` are in your system `PATH`.
- **macOS**:
  - Install via Homebrew:
    ```bash
    brew install ffmpeg
    ```
- **Linux (Ubuntu/Debian)**:
  - Install via apt:
    ```bash
    sudo apt update
    sudo apt install -y ffmpeg
    ```
- **Verify Installation**:
  ```bash
  ffmpeg -version
  ffprobe -version
  ```

---

## 2. Project Installation

```bash
# 1. Obtain the project source code
# Option A: Clone from your git repository (once published):
#   git clone <repository-url>
#   cd cinegen-ai
# Option B: Or unpack the release candidate archive:
#   tar -xzf cinegen-ai-1.0.0-rc1.tar.gz
#   cd cinegen-ai

# 2. Install Node dependencies
npm install

# 3. Initialize environment variables
cp .env.example .env
```

---

## 3. Verification & Build

```bash
# 1. Check TypeScript types
npx tsc --noEmit

# 2. Run the test suite
node scripts/test_phase8_validation.js

# 3. Create the production build
npm run build
```

---

## 4. Running the Application

### Development Server
```bash
npm run dev
```
Open `http://localhost:3000` in your web browser.

### Production Server
```bash
npm run start
```
By default, the server listens on port `3000`. You can configure a custom port via `PORT=8080 npm run start`.
