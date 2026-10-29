import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseQueueStore,
  extractSerpApiCallsFromRaw,
  processQueue,
  startCheckRun,
} from "../lib/queue.ts";

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const SAMPLE_10_KEYWORDS: Array<{ text: string; group: string }> = [
  { text: "software hr terbaik", group: "Produk HR" },
  { text: "aplikasi hris indonesia", group: "Produk HR" },
  { text: "software payroll terbaik", group: "Produk HR" },
  { text: "aplikasi absensi karyawan", group: "Produk HR" },
  { text: "apa itu hris", group: "Panduan HR" },
  { text: "cara hitung pph 21 karyawan", group: "Panduan HR" },
  { text: "hris vs hrms", group: "Perbandingan" },
  { text: "linovhr", group: "Merek" },
  { text: "review linovhr", group: "Merek" },
  { text: "harga linovhr", group: "Merek" },
];

async function main() {
  loadEnvLocal();
  process.env.SERPAPI_DRY_RUN = "true";

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      "SUPABASE_URL dan SUPABASE_SECRET_KEY wajib diisi di .env.local."
    );
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Pastikan grup dan 10 keyword contoh tersedia untuk uji lokal dry-run
  const uniqueGroups = Array.from(
    new Set(SAMPLE_10_KEYWORDS.map((k) => k.group))
  );
  const groupIdByName: Record<string, string> = {};

  for (const name of uniqueGroups) {
    const { data: grp, error: grpErr } = await supabase
      .from("keyword_groups")
      .upsert({ name }, { onConflict: "name" })
      .select("id, name")
      .single();

    if (grpErr || !grp) {
      throw new Error(
        `Gagal menyiapkan grup keyword "${name}": ${grpErr?.message ?? "unknown"}`
      );
    }
    groupIdByName[name] = (grp as { id: string }).id;
  }

  for (const item of SAMPLE_10_KEYWORDS) {
    const { error: kwErr } = await supabase.from("keywords").upsert(
      {
        text: item.text,
        group_id: groupIdByName[item.group],
        active: true,
      },
      { onConflict: "text" }
    );
    if (kwErr) {
      throw new Error(
        `Gagal menyiapkan keyword "${item.text}": ${kwErr.message}`
      );
    }
  }

  const store = createSupabaseQueueStore(supabase);

  console.log("=== Memulai Uji Lokal Dry-Run (SERPAPI_DRY_RUN=true) ===");
  const started = await startCheckRun(store);
  console.log(
    `Run dibuat: runId=${started.runId}, totalKeyword=${started.total}, status=${started.status}`
  );

  const processed = await processQueue(store, {
    dryRun: true,
    maxItems: 20,
  });

  console.log("\n=== Ringkasan Pemrosesan Antrean ===");
  console.log(`Item dipulihkan (stuck)       : ${processed.recoveredCount}`);
  console.log(`Item diproses                 : ${processed.processedCount}`);
  console.log(`Berhasil (done)               : ${processed.succeededCount}`);
  console.log(`Dicoba ulang (retry)          : ${processed.retriedCount}`);
  console.log(`Gagal akhir (error)           : ${processed.failedCount}`);
  console.log(
    `Panggilan SerpApi batch ini   : ${processed.serpApiCallsUsedInBatch} (DRY RUN - 0 kuota asli terpakai)`
  );
  console.log(
    `Panggilan SerpApi 60m terakhir: ${processed.hourlySerpApiCallsUsed} / ${processed.maxPerHour}`
  );
  console.log(`Alasan berhenti               : ${processed.stoppedReason}`);

  if (processed.runsSummary.length > 0) {
    console.log(
      "Status akhir check_runs       :",
      JSON.stringify(processed.runsSummary[0])
    );
  }

  // Ambil hasil dari tabel checks untuk run ini
  const { data: checksRows, error: checksErr } = await supabase
    .from("checks")
    .select(
      "id, keyword_id, status, detected_domain, detected_text, detected_third_party, raw, keywords(text), check_sources(count)"
    )
    .eq("run_id", started.runId);

  if (checksErr) {
    throw new Error(`Gagal membaca hasil checks: ${checksErr.message}`);
  }

  console.log("\n=== Detail Hasil 10 Keyword di Database ===");
  for (const row of checksRows ?? []) {
    const r = row as unknown as {
      status: string;
      detected_domain: boolean;
      detected_text: boolean;
      detected_third_party: boolean;
      raw: Record<string, unknown>;
      keywords: { text: string } | Array<{ text: string }>;
      check_sources: Array<{ count: number }>;
    };
    const kwText = Array.isArray(r.keywords)
      ? r.keywords[0]?.text
      : r.keywords?.text;
    const srcCount = r.check_sources?.[0]?.count ?? 0;
    const calls = extractSerpApiCallsFromRaw(r.raw);
    const hasApiKeyLeak = JSON.stringify(r.raw).includes(
      process.env.SERPAPI_KEY ?? "___"
    );

    console.log(
      `- [${r.status.padEnd(14)}] "${kwText}" | calls=${calls} | sources=${srcCount} | domain=${r.detected_domain}, text=${r.detected_text}, 3rd=${r.detected_third_party} | api_key_bocoran=${hasApiKeyLeak}`
    );
  }
}

main().catch((err) => {
  console.error(
    "Gagal menjalankan dry-run:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
