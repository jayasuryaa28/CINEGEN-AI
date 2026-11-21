import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { jobRepository } from "@/services/db";
import { queueManager } from "@/services/queue";
import { getResolutionForQuality } from "@/services/pipeline";
import { ProcessingJob, OutputQuality, VideoMetadata } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filePath, originalFilename, quality, metadata } = body as {
      filePath: string;
      originalFilename: string;
      quality: OutputQuality;
      metadata: VideoMetadata;
    };

    if (!filePath || !metadata) {
      return NextResponse.json({ error: "Missing required job parameters." }, { status: 400 });
    }

    const validQualities: OutputQuality[] = ["720p", "1080p", "1440p", "4K"];
    const targetQuality = validQualities.includes(quality) ? quality : "1080p";
    const targetResolution = getResolutionForQuality(targetQuality);

    const jobId = uuidv4().substring(0, 8);

    const newJob: ProcessingJob = {
      id: jobId,
      originalFilename: originalFilename || metadata.filename,
      inputFilePath: filePath,
      outputQuality: targetQuality,
      targetResolution,
      metadata,
      status: "queued",
      progress: 0,
      currentStage: "Job created. Awaiting worker processing.",
      chunksTotal: 0,
      chunksCompleted: 0,
      aiModulesStatus: {
        cinevision: "placeholder",
        cineframe: "placeholder",
        noisenet: "placeholder",
        stemnet: "placeholder",
        echonet: "placeholder",
        voicenet: "placeholder",
        cinesync: "placeholder",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store in DB
    await jobRepository.create(newJob);

    // Queue job to worker
    await queueManager.addJob(jobId);

    return NextResponse.json({
      success: true,
      job: newJob,
    });
  } catch (err: any) {
    console.error("Jobs API error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create processing job." },
      { status: 500 }
    );
  }
}
