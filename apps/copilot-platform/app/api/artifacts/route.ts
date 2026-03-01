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
  ".zip": "application/zip"
};

const resolveSafePath = (relativePath: string): string | null => {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    return null;
  }

  const absolute = path.resolve(workspaceRoot, normalized);
  if (!absolute.startsWith(workspaceRoot)) {
    return null;
  }
  return absolute;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedPath = url.searchParams.get("path") || "";
  const absolutePath = resolveSafePath(requestedPath);

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