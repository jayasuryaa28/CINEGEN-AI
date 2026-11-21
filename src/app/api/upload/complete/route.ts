import { NextRequest, NextResponse } from "next/server";
import { uploadManager } from "@/services/uploadManager";
import { UploadCompleteRequest } from "@/types";

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

    const body: UploadCompleteRequest = await req.json();

    if (!body.uploadId) {
      return NextResponse.json(
        { error: "Missing required field: 'uploadId'." },
        { status: 400 }
      );
    }

    const uploadToken = req.headers.get("x-upload-token") || undefined;
    if (!uploadToken) {
      return NextResponse.json(
        { error: "Unauthorized: missing 'x-upload-token' header." },
        { status: 401 }
      );
    }

    const result = await uploadManager.completeUpload(
      body.uploadId,
      uploadToken,
      body.clientSha256
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    const msg = err.message || "Failed to complete upload.";
    const status = msg.includes("not found")
      ? 404
      : msg.includes("Unauthorized")
      ? 401
      : msg.includes("expired")
      ? 410
      : msg.includes("SHA-256")
      ? 422
      : msg.includes("duration exceeds")
      ? 400
      : msg.includes("missing")
      ? 400
      : msg.includes("actively streaming") || msg.includes("finalizing")
      ? 409
      : 500;

    return NextResponse.json({ error: msg }, { status });
  }
}
