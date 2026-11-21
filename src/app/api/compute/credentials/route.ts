import { NextRequest, NextResponse } from "next/server";
import { CredentialManager, CloudProviderId } from "@/compute/cloud/credentialManager";
import { RunPodProvider } from "@/compute/cloud/runpodProvider";
import { VastProvider } from "@/compute/cloud/vastProvider";

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id") || "default_user";
    const credentials = await CredentialManager.getMaskedCredentials(userId);
    return NextResponse.json({ success: true, credentials });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load credentials" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id") || "default_user";
    const body = await req.json();
    const { provider, apiKey, testConnection } = body;

    if (!provider || (provider !== "runpod" && provider !== "vast")) {
      return NextResponse.json(
        { success: false, error: "Invalid provider. Must be 'runpod' or 'vast'." },
        { status: 400 }
      );
    }

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "API key cannot be empty." },
        { status: 400 }
      );
    }

    const cleanKey = apiKey.trim();

    // If test connection requested
    if (testConnection) {
      if (provider === "runpod") {
        const val = await RunPodProvider.validateApiKey(cleanKey);
        if (!val.valid) {
          return NextResponse.json(
            { success: false, error: `RunPod API key validation failed: ${val.error}` },
            { status: 400 }
          );
        }
      } else {
        const val = await VastProvider.validateApiKey(cleanKey);
        if (!val.valid) {
          return NextResponse.json(
            { success: false, error: `Vast.ai API key validation failed: ${val.error}` },
            { status: 400 }
          );
        }
      }
    }

    const saved = await CredentialManager.saveCredential(userId, provider as CloudProviderId, cleanKey);
    return NextResponse.json({ success: true, credential: saved });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to save credential" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id") || "default_user";
    const body = await req.json();
    const { provider } = body;

    if (!provider || (provider !== "runpod" && provider !== "vast")) {
      return NextResponse.json(
        { success: false, error: "Invalid provider. Must be 'runpod' or 'vast'." },
        { status: 400 }
      );
    }

    const deleted = await CredentialManager.deleteCredential(userId, provider as CloudProviderId);
    return NextResponse.json({ success: true, disconnected: deleted });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to delete credential" },
      { status: 500 }
    );
  }
}
