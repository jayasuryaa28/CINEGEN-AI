import { NextRequest, NextResponse } from "next/server";
import { uploadManager } from "@/services/uploadManager";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Reject token in query parameters per strict Phase 13.1.2 security requirements
    if (searchParams.has("uploadToken")) {
      return NextResponse.json(
        { error: "Security violation: uploadToken must NOT be passed in URL query parameters. Pass tokens strictly via 'x-upload-token' header." },
        { status: 400 }
      );
    }

    const uploadId = searchParams.get("uploadId") || req.headers.get("x-upload-id");
    const uploadToken = req.headers.get("x-upload-token") || undefined;

    if (!uploadId) {
      return NextResponse.json(
        { error: "Missing required parameter: 'uploadId'." },
        { status: 400 }
      );
    }

    if (!uploadToken) {
      return NextResponse.json(
        { error: "Unauthorized: missing 'x-upload-token' header." },
        { status: 401 }
      );
    }

    const filename = searchParams.get("filename") || undefined;
    const fileSizeStr = searchParams.get("fileSize");
    const fileSize = fileSizeStr ? parseInt(fileSizeStr, 10) : undefined;
    const lastModifiedStr = searchParams.get("lastModified");
    const lastModified = lastModifiedStr ? parseInt(lastModifiedStr, 10) : undefined;
    const fingerprint = searchParams.get("fingerprint") || undefined;

    const status = await uploadManager.getSessionStatus(uploadId, uploadToken, {
      filename,
      fileSize,
      lastModified,
      fingerprint,
    });
    return NextResponse.json(status, { status: 200 });
  } catch (err: any) {
    const msg = err.message || "Failed to retrieve upload session status.";
    const status = msg.includes("not found")
      ? 404
      : msg.includes("Unauthorized")
      ? 401
      : msg.includes("expired")
      ? 410
      : msg.includes("Resume file identity mismatch")
      ? 400
      : 500;

    return NextResponse.json({ error: msg }, { status });
  }
}
