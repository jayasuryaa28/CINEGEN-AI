import { NextRequest, NextResponse } from "next/server";
import { ComputeModeManager } from "@/compute/computeModeManager";

export async function GET() {
  try {
    const settings = await ComputeModeManager.getSettings();
    return NextResponse.json({ success: true, settings });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load compute settings" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { activeMode, preferredCloudProvider, preferredGpuId, maxLocalConcurrency, memorySafetyLimitGb } = body;

    if (activeMode && activeMode !== "own_pc" && activeMode !== "cloud_gpu") {
      return NextResponse.json(
        { success: false, error: "Invalid compute mode. Must be 'own_pc' or 'cloud_gpu'." },
        { status: 400 }
      );
    }

    const updated = await ComputeModeManager.saveSettings({
      activeMode,
      preferredCloudProvider,
      preferredGpuId,
      maxLocalConcurrency,
      memorySafetyLimitGb,
    });

    return NextResponse.json({ success: true, settings: updated });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to update compute settings" },
      { status: 500 }
    );
  }
}
