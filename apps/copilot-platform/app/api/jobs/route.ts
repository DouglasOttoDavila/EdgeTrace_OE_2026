import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, listJobs } from "@/lib/job-store";

export const runtime = "nodejs";

const createJobSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("generate_test_cases"),
    jiraId: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/)
  }),
  z.object({
    type: z.literal("generate_automation"),
    caseIds: z.array(z.string().regex(/^C\d+$/)).min(1)
  })
]);

export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const payload = parsed.data.type === "generate_test_cases"
    ? { jiraId: parsed.data.jiraId }
    : { caseIds: parsed.data.caseIds };

  const job = createJob(parsed.data.type, payload);

  return NextResponse.json({ job }, { status: 202 });
}