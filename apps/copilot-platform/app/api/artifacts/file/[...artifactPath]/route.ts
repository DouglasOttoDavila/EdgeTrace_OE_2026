import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const contentTypeByExt: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".html": "text/html; charset=utf-8",
  ".zip": "application/zip",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const resolveSafePath = (segments: string[]): string | null => {
  const decoded = segments.map((segment) => decodeURIComponent(segment)).join("/").replaceAll("\\", "/");
  if (!decoded || decoded.startsWith("/") || decoded.includes("..")) {
    return null;
  }

  const absolute = path.resolve(workspaceRoot, decoded);
  if (!absolute.startsWith(workspaceRoot)) {
    return null;
  }

  return absolute;
};

export async function GET(
  _: Request,
  context: { params: Promise<{ artifactPath?: string[] }> }
) {
  const params = await context.params;
  const segments = params.artifactPath || [];
  const absolutePath = resolveSafePath(segments);

  if (!absolutePath) {
    return NextResponse.json({ error: "Invalid artifact path" }, { status: 400 });
  }

  try {
    const file = await readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = contentTypeByExt[ext] || "application/octet-stream";

    return new NextResponse(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }
}
