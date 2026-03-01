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
    caseIds: z.array(z.string().regex(/^C\d+$/)).length(1)
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

  if (parsed.data.type === "generate_automation") {
    const caseId = parsed.data.caseIds[0];
    const activeJob = listJobs().find(
      (job) =>
        job.type === "generate_automation" &&
        (job.status === "queued" || job.status === "running") &&
        (job.payload.caseIds || []).includes(caseId)
    );

    if (activeJob) {
      return NextResponse.json(
        {
          error: `Automation generation is already queued or running for case ${caseId}.`,
          activeJobId: activeJob.id
        },
        { status: 409 }
      );
    }
  }

  const payload = parsed.data.type === "generate_test_cases"
    ? { jiraId: parsed.data.jiraId }
    : { caseIds: parsed.data.caseIds };

  const job = createJob(parsed.data.type, payload);

  return NextResponse.json({ job }, { status: 202 });
}
