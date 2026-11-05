import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncScheduledKeywordBatch } from "@/lib/keyword-batches";

export const dynamic = "force-dynamic";

async function handleRotateBatch(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized. Invalid Authorization Bearer header." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "true";

    const result = await syncScheduledKeywordBatch(supabase, {
      actorId: "system:cron",
      force,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Gagal memproses sinkronisasi batch terjadwal.",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

export async function GET(request: Request) {
  return handleRotateBatch(request);
}

export async function POST(request: Request) {
  return handleRotateBatch(request);
}
