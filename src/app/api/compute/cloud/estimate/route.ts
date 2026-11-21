import { NextRequest, NextResponse } from "next/server";
import { CloudCostEstimator } from "@/compute/cloud/cloudCostEstimator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { videoDurationSeconds, targetResolution, provider, gpuId } = body;

    if (!videoDurationSeconds || videoDurationSeconds <= 0) {
      return NextResponse.json(
        { success: false, error: "videoDurationSeconds must be a positive number." },
        { status: 400 }
      );
    }

    if (!provider || (provider !== "runpod" && provider !== "vast")) {
      return NextResponse.json(
        { success: false, error: "provider must be 'runpod' or 'vast'." },
        { status: 400 }
      );
    }

    const estimate = CloudCostEstimator.estimate({
      videoDurationSeconds: Number(videoDurationSeconds),
      targetResolution: targetResolution || "1080p",
      provider,
      gpuId,
    });

    return NextResponse.json({ success: true, estimate });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to calculate cost estimate" },
      { status: 500 }
    );
  }
}
