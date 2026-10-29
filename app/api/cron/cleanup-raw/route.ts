import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanupExpiredRawPayloads } from "@/lib/queue";

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Tidak diizinkan. Header Authorization Bearer tidak valid." },
      { status: 401 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const cleanedCount = await cleanupExpiredRawPayloads(supabase, 90);
    return NextResponse.json(
      { ok: true, retentionDays: 90, cleanedCount },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Gagal membersihkan data raw yang melebihi 90 hari.",
      },
      { status: 500 }
    );
  }
}
