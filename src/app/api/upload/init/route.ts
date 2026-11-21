import { NextRequest, NextResponse } from "next/server";
import { uploadManager, getClientIp } from "@/services/uploadManager";
import { UploadInitRequest } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    if (!uploadManager.checkIpRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too Many Requests: upload initialization rate limit exceeded. Please try again later." },
        { status: 429 }
      );
    }

    const body: UploadInitRequest = await req.json();

    if (!body.filename || !body.fileSize) {
      return NextResponse.json(
        { error: "Missing required fields: 'filename' and 'fileSize' must be provided." },
        { status: 400 }
      );
    }

    const userId = req.headers.get("x-user-id") || body.userId || "local-user";
    const response = await uploadManager.initSession({
      ...body,
      userId,
    });

    return NextResponse.json(response, { status: 201 });
  } catch (err: any) {
    console.error("[Upload Init API Error]:", err);
    const msg = err.message || "Failed to initialize upload session.";
    const status = msg.includes("Server busy")
      ? 503
      : msg.includes("Insufficient physical disk capacity")
      ? 507
      : 400;

    return NextResponse.json(
      { error: msg },
      { status }
    );
  }
}
