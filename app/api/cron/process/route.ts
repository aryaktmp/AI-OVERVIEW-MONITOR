import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseQueueStore, processQueue } from "@/lib/queue";

// Batas durasi maksimum fungsi serverless (detik)
export const maxDuration = 60;

// Berhenti memproses 10 detik sebelum batas waktu fungsi habis
const SAFE_PROCESS_BUDGET_MS = (maxDuration - 10) * 1000;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Tidak diizinkan. Header Authorization Bearer tidak valid." },
      { status: 401 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const store = createSupabaseQueueStore(supabase);
    const result = await processQueue(store, {
      maxDurationMs: SAFE_PROCESS_BUDGET_MS,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Gagal memproses antrean pengecekan.",
      },
      { status: 500 }
    );
  }
}
