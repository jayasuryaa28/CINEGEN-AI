import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { jobRepository } from "@/services/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await jobRepository.findById(id);

    if (!job || !job.outputVideoPath || !fs.existsSync(job.outputVideoPath)) {
      return NextResponse.json({ error: "Processed video file not found." }, { status: 404 });
    }

    const stat = await fs.promises.stat(job.outputVideoPath);
    const fileSize = stat.size;
    const range = req.headers.get("range");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(job.outputVideoPath, { start, end });

      const headers = new Headers({
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize.toString(),
        "Content-Type": "video/mp4",
      });

      return new Response(fileStream as any, {
        status: 206,
        headers,
      });
    } else {
      const fileStream = fs.createReadStream(job.outputVideoPath);
      const headers = new Headers({
        "Content-Length": fileSize.toString(),
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="CINEGEN_${job.id}_${job.outputQuality}.mp4"`,
      });

      return new Response(fileStream as any, {
        status: 200,
        headers,
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
