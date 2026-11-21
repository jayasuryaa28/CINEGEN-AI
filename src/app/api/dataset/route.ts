import { NextRequest, NextResponse } from "next/server";
import { datasetManager } from "@/dataset/manager";
import { PRESET_DEGRADATION_PROFILES } from "@/dataset/profiles";

export async function GET() {
  try {
    const manifest = datasetManager.getManifest();
    const stats = datasetManager.getStatistics();
    return NextResponse.json({
      success: true,
      stats,
      manifest,
      availableProfiles: PRESET_DEGRADATION_PROFILES,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, sourceId, profileId, sourceFilePath, license, split } = body;

    if (action === "import") {
      if (!sourceFilePath) {
        return NextResponse.json({ error: "sourceFilePath is required for import" }, { status: 400 });
      }
      const result = await datasetManager.importSourceVideo(sourceFilePath, license, split);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "generate_pair") {
      if (!sourceId || !profileId) {
        return NextResponse.json({ error: "sourceId and profileId are required" }, { status: 400 });
      }
      const pair = await datasetManager.generateDegradedPair(sourceId, profileId);
      return NextResponse.json({ success: true, pair });
    }

    if (action === "validate") {
      const report = await datasetManager.validateDataset();
      return NextResponse.json({ success: true, report });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
