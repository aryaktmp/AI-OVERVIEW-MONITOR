import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  cleanupExpiredRawPayloads,
  createSupabaseQueueStore,
  startCheckRun,
} from "@/lib/queue";
import { rotateActiveKeywordBatch } from "@/lib/keyword-batches";

export const dynamic = "force-dynamic";

async function handleStartRun(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized. Invalid Authorization Bearer header." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const store = createSupabaseQueueStore(supabase);

    const url = new URL(request.url);
    // Jadwal mingguan otomatis (Senin 00:00) secara bawaan merotasi batch berikutnya secara berurutan
    const shouldRotate = url.searchParams.get("rotate") !== "false";
    const force = url.searchParams.get("force") === "true";
    let batchRotation = null;

    if (shouldRotate) {
      batchRotation = await rotateActiveKeywordBatch(supabase, {
        actorId: "system:cron",
        force,
      });

      // Jika tidak ada batch yang memenuhi syarat (misal seluruh batch dinonaktifkan atau kosong)
      if (batchRotation.status === "no_candidates") {
        return NextResponse.json(
          {
            runId: null,
            status: "skipped_no_candidates",
            message: batchRotation.message,
            batchRotation,
          },
          { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
    }

    const [result, cleanedRawCount] = await Promise.all([
      startCheckRun(store),
      cleanupExpiredRawPayloads(supabase, 90).catch(() => 0),
    ]);

    return NextResponse.json(
      { ...result, cleanedRawCount, batchRotation },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to start check queue.",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

export async function GET(request: Request) {
  return handleStartRun(request);
}

export async function POST(request: Request) {
  return handleStartRun(request);
}
