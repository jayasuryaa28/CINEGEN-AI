import { NextRequest, NextResponse } from "next/server";
import { uploadManager } from "@/services/uploadManager";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Reject token in query parameters per strict Phase 13.1.2 security requirements
    if (searchParams.has("uploadToken")) {
      return NextResponse.json(
        { error: "Security violation: uploadToken must NOT be passed in URL query parameters. Pass tokens strictly via 'x-upload-token' header." },
        { status: 400 }
      );
    }

    const uploadId = req.headers.get("x-upload-id") || searchParams.get("uploadId");
    const uploadToken = req.headers.get("x-upload-token") || undefined;
    const chunkIndexStr = req.headers.get("x-chunk-index") || searchParams.get("chunkIndex");
    const contentLength = req.headers.get("content-length");

    if (!uploadId) {
      return NextResponse.json(
        { error: "Missing required header or query parameter: 'x-upload-id'." },
        { status: 400 }
      );
    }

    if (!uploadToken) {
      return NextResponse.json(
        { error: "Unauthorized: missing 'x-upload-token' header." },
        { status: 401 }
      );
    }

    if (chunkIndexStr === null || chunkIndexStr === undefined || chunkIndexStr === "") {
      return NextResponse.json(
        { error: "Missing required header or query parameter: 'x-chunk-index'." },
        { status: 400 }
      );
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);
    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json(
        { error: `Invalid chunk index '${chunkIndexStr}'. Must be non-negative integer.` },
        { status: 400 }
      );
    }

    if (!req.body) {
      return NextResponse.json(
        { error: "Request body cannot be empty. Direct binary chunk payload required." },
        { status: 400 }
      );
    }

    const reportedLength = contentLength ? parseInt(contentLength, 10) : undefined;

    const result = await uploadManager.writeChunk(
      uploadId,
      chunkIndex,
      req.body,
      reportedLength,
      uploadToken
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    const msg = err.message || "Failed to process binary chunk.";
    const status = msg.includes("not found")
      ? 404
      : msg.includes("Unauthorized")
      ? 401
      : msg.includes("Payload Too Large")
      ? 413
      : msg.includes("Server busy")
      ? 503
      : msg.includes("finalizing")
      ? 409
      : msg.includes("expired")
      ? 410
      : msg.includes("Invalid chunk index")
      ? 400
      : msg.includes("ENOSPC")
      ? 507
      : 500;

    return NextResponse.json({ error: msg }, { status });
  }
}
