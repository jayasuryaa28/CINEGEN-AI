import { NextResponse } from "next/server";
import { HardwareDetector } from "@/compute/local/hardwareDetector";
import { LocalCapabilityAdvisor } from "@/compute/local/localCapabilityAdvisor";

export async function GET() {
  try {
    const profile = await HardwareDetector.detect();
    const advice = LocalCapabilityAdvisor.evaluate(profile);
    return NextResponse.json({ success: true, profile, advice });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to detect local hardware" },
      { status: 500 }
    );
  }
}
