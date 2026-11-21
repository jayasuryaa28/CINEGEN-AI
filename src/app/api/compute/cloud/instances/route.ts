import { NextRequest, NextResponse } from "next/server";
import { InstanceManager } from "@/compute/cloud/instanceManager";

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id") || "default_user";
    const instances = InstanceManager.getUserInstances(userId);
    return NextResponse.json({ success: true, instances });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load instances" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id") || "default_user";
    const body = await req.json();
    const { action, provider, gpuId, userApprovedCost, instanceRecordId } = body;

    if (action === "provision") {
      if (!provider || !gpuId) {
        return NextResponse.json(
          { success: false, error: "Missing required parameters 'provider' or 'gpuId'." },
          { status: 400 }
        );
      }
      if (!userApprovedCost) {
        return NextResponse.json(
          {
            success: false,
            error: "Cost confirmation required before cloud instance provisioning.",
          },
          { status: 400 }
        );
      }

      const instance = await InstanceManager.provisionInstance({
        userId,
        provider,
        gpuId,
        userApprovedCost: true,
      });

      return NextResponse.json({ success: true, instance });
    } else if (action === "terminate") {
      if (!instanceRecordId) {
        return NextResponse.json(
          { success: false, error: "Missing required parameter 'instanceRecordId'." },
          { status: 400 }
        );
      }

      const result = await InstanceManager.terminateInstance(userId, instanceRecordId);
      return NextResponse.json({ ...result });
    } else {
      return NextResponse.json(
        { success: false, error: `Invalid action '${action}'. Must be 'provision' or 'terminate'.` },
        { status: 400 }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Instance operation failed" },
      { status: 500 }
    );
  }
}
