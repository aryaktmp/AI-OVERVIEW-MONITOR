import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  cleanupExpiredRawPayloads,
  createSupabaseQueueStore,
  startCheckRun,
} from "@/lib/queue";
import {
  getScheduledBatchForDate,
  listKeywordBatches,
  getBatchScheduleSettings,
  activateKeywordBatch,
  getJakartaWeekBoundaries,
} from "@/lib/keyword-batches";

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
    const force = url.searchParams.get("force") === "true";
    const now = new Date();

    // 1. Idempoten per minggu Jakarta:
    // Jika sudah ada run non-demo berstatus running atau done yang started_at-nya di minggu Jakarta yang sama,
    // kembalikan 200 dengan skipped: "already_ran_this_week" dan runId yang ada.
    // Run berstatus failed tidak memblokir. Pemicu manual dengan ?force=true wajib memakai Bearer CRON_SECRET.
    if (!force) {
      const { startIso, endIso } = getJakartaWeekBoundaries(now);
      const { data: existingRuns } = await supabase
        .from("check_runs")
        .select("id, status, total, started_at, is_demo")
        .eq("is_demo", false)
        .in("status", ["running", "done"])
        .gte("started_at", startIso)
        .lte("started_at", endIso)
        .order("started_at", { ascending: false })
        .limit(1);

      if (existingRuns && existingRuns.length > 0) {
        const existing = existingRuns[0]!;
        return NextResponse.json(
          {
            runId: existing.id,
            total: existing.total,
            status: existing.status,
            isExisting: true,
            isDemo: false,
            skipped: "already_ran_this_week",
            message: `Pemindaian non-demo sudah pernah dijalankan pada minggu ini (run_id: ${existing.id}, status: ${existing.status}). Gunakan ?force=true dengan Authorization Bearer untuk memaksa pemindaian baru.`,
          },
          { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
    }

    // 2. Tentukan batch terjadwal untuk sekarang (atau override aktif)
    const [allBatches, settings] = await Promise.all([
      listKeywordBatches(supabase),
      getBatchScheduleSettings(supabase),
    ]);

    const activeBatch = allBatches.find((b) => b.is_active) ?? null;
    const scheduled = getScheduledBatchForDate(now, allBatches, {
      mode: settings.mode,
      override_until: settings.override_until,
      activeBatchId: activeBatch?.id,
    });

    if (!scheduled.batch) {
      return NextResponse.json(
        {
          runId: null,
          total: 0,
          isExisting: false,
          isDemo: false,
          skipped: "no_active_batch",
          message:
            "Tidak ada batch keyword yang aktif atau diaktifkan untuk dijadwalkan.",
          scheduled,
        },
        { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const targetBatch = scheduled.batch;

    // 3. Panggil activate_keyword_batch bila is_active berbeda (agar UI sinkron)
    if (!targetBatch.is_active) {
      await activateKeywordBatch(supabase, targetBatch.id, {
        actorId: scheduled.isOverride ? "system:override" : "system:schedule",
        notes: scheduled.isOverride
          ? `Aktivasi batch override manual (${targetBatch.name})`
          : `Aktivasi batch terjadwal turunan minggu ${scheduled.targetWeekMonday} (${targetBatch.name})`,
      });
    }

    // 4. Batch terjadwal yang kosong: start-run mengembalikan 200 dengan skipped: "empty_batch" tanpa membuat run
    const activeKeywordsInBatch = await store.getActiveKeywords(targetBatch.id);
    const nonDemoActiveKeywords = activeKeywordsInBatch.filter((k) => !k.is_demo);
    if (nonDemoActiveKeywords.length === 0) {
      return NextResponse.json(
        {
          runId: null,
          total: 0,
          isExisting: false,
          isDemo: false,
          skipped: "empty_batch",
          batchId: targetBatch.id,
          batchName: targetBatch.name,
          message: `Batch terjadwal "${targetBatch.name}" tidak memiliki keyword aktif non-demo. Pemindaian dilewati tanpa membuat run.`,
          scheduled,
        },
        { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // 5. Jalankan startCheckRun untuk batch itu (bukan demo saat cron jalan)
    const [result, cleanedRawCount] = await Promise.all([
      startCheckRun(store, now, { batchId: targetBatch.id, isDemo: false }),
      cleanupExpiredRawPayloads(supabase, 90).catch(() => 0),
    ]);

    return NextResponse.json(
      {
        ...result,
        batchId: targetBatch.id,
        batchName: targetBatch.name,
        scheduled,
        cleanedRawCount,
      },
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
