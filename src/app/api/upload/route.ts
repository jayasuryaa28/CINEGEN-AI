import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { ffmpegService } from "@/services/ffmpeg";
import { storageService } from "@/services/storage";

// 4 hours in seconds
const MAX_DURATION_SECONDS = 4 * 60 * 60; // 14,400 seconds
const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".mkv"];

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No video file provided." }, { status: 400 });
    }

    const filename = file.name;
    const ext = path.extname(filename).toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        {
          error: `Unsupported file format '${ext}'. Supported formats: MP4, MOV, MKV.`,
        },
        { status: 400 }
      );
    }

    // Write file stream to secure temporary staging area without memory buffering
    const tempFileName = `upload_stage_${uuidv4()}${ext}`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    const { Readable } = await import("stream");
    const { pipeline } = await import("stream/promises");
    const writeStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(file.stream() as any), writeStream);


    // Deep server-side inspection via FFprobe
    let metadata;
    try {
      metadata = await ffmpegService.probeVideo(tempFilePath);
    } catch (probeErr: any) {
      if (fs.existsSync(tempFilePath)) {
        await fs.promises.unlink(tempFilePath);
      }
      return NextResponse.json(
        {
          error: `Corrupt or unreadable media file: ${probeErr.message}`,
        },
        { status: 422 }
      );
    }

    // Enforce 4-hour strict constraint
    if (metadata.duration > MAX_DURATION_SECONDS) {
      if (fs.existsSync(tempFilePath)) {
        await fs.promises.unlink(tempFilePath);
      }
      return NextResponse.json(
        {
          error: `Video duration exceeds maximum allowed limit of 4 hours (${metadata.durationFormatted} detected).`,
        },
        { status: 400 }
      );
    }

    // Persist verified file into permanent local storage
    const persistentPath = await storageService.saveUploadedFile(tempFilePath, filename);

    // Clean up staging file
    if (fs.existsSync(tempFilePath)) {
      await fs.promises.unlink(tempFilePath);
    }

    return NextResponse.json({
      success: true,
      filePath: persistentPath,
      metadata,
    });
  } catch (err: any) {
    console.error("Upload API error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to process video upload." },
      { status: 500 }
    );
  }
}
