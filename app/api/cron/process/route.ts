import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSupabaseQueueStore,
  getConfiguredMaxDurationMs,
  processQueue,
} from "@/lib/queue";

export const dynamic = "force-dynamic";

// Tetap diekspor untuk kompatibilitas runtime serverless, sedangkan batas waktu kerja
// sesungguhnya dikendalikan oleh variabel lingkungan MAX_DURATION_MS (nilai awal 50000 ms).
export const maxDuration = 60;

async function handleProcessQueue(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized. Invalid Authorization Bearer header." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const store = createSupabaseQueueStore(supabase);
    const maxDurationMs = getConfiguredMaxDurationMs();
    const result = await processQueue(store, {
      maxDurationMs,
    });

    return NextResponse.json(
      {
        ...result,
        pending: result.pending,
        stoppedReason: result.stoppedReason,
        runStatus: result.runStatus,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to process check queue.",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

export async function GET(request: Request) {
  return handleProcessQueue(request);
}

export async function POST(request: Request) {
  return handleProcessQueue(request);
}
