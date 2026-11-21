import { NextRequest, NextResponse } from "next/server";
import { GpuCatalog } from "@/compute/cloud/gpuCatalog";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider") as "runpod" | "vast" | null;
    const catalog = GpuCatalog.getCatalog(provider || undefined);
    return NextResponse.json({ success: true, catalog });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load GPU catalog" },
      { status: 500 }
    );
  }
}
