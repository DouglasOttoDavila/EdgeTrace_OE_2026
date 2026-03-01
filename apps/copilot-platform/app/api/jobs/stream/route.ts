import { listJobs } from "@/lib/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

const createPayload = () => JSON.stringify({ jobs: listJobs() });

export async function GET() {
  let timer: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let previousPayload = "";

      const push = () => {
        const nextPayload = createPayload();
        if (nextPayload === previousPayload) {
          return;
        }
        previousPayload = nextPayload;
        controller.enqueue(encoder.encode(`data: ${nextPayload}\n\n`));
      };

      push();
      timer = setInterval(push, 1200);
    },
    cancel() {
      if (timer) {
        clearInterval(timer);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}