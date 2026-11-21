import { NextRequest, NextResponse } from "next/server";
import { jobRepository } from "@/services/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await jobRepository.findById(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to retrieve job status." },
      { status: 500 }
    );
  }
}
