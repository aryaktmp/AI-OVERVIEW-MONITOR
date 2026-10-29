import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  cleanupExpiredRawPayloads,
  createSupabaseQueueStore,
  startCheckRun,
} from "@/lib/queue";

export const dynamic = "force-dynamic";

async function handleStartRun(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Tidak diizinkan. Header Authorization Bearer tidak valid." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const store = createSupabaseQueueStore(supabase);
    const [result, cleanedRawCount] = await Promise.all([
      startCheckRun(store),
      cleanupExpiredRawPayloads(supabase, 90).catch(() => 0),
    ]);

    return NextResponse.json(
      { ...result, cleanedRawCount },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Gagal memulai antrean pengecekan.",
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
