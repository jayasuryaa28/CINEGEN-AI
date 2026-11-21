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

    const body = await req.json().catch(() => ({}));
    const uploadId = body.uploadId || searchParams.get("uploadId") || req.headers.get("x-upload-id");
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

    const result = await uploadManager.cancelUpload(uploadId, uploadToken);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    const msg = err.message || "Failed to cancel upload session.";
    const status = msg.includes("not found")
      ? 404
      : msg.includes("Unauthorized")
      ? 401
      : msg.includes("expired")
      ? 410
      : 500;

    return NextResponse.json({ error: msg }, { status });
  }
}
