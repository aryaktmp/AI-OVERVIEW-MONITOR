import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildEightWeekBuckets } from "../lib/analytics.ts";
import {
  clearAllDemoData,
  DEMO_COMPETITORS,
  DEMO_GROUP_NAMES,
  DEMO_KEYWORDS,
} from "../lib/demo-data.ts";
import type { CheckStatus } from "../lib/detect.ts";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
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

const GROUP_PROBABILITIES: Record<string, number> = {
  "Produk HR": 0.7,
  "Panduan HR": 0.88,
  Perbandingan: 0.72,
  Merek: 0.6,
  Umum: 0.8,
};

function createRng(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const ownDomain = process.env.BRAND_DOMAIN || "linovhr.com";

  if (!supabaseUrl || !secretKey) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required in .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Seeding 8 Weeks of Demo Data (is_demo = true) ===");

  // 1. Bersihkan data contoh lama di keempat tabel agar idempoten
  await clearAllDemoData(supabase);

  // 2. Pastikan istilah merek standar tersedia
  await supabase.from("brand_terms").upsert(
    [
      { term: "LinovHR", enabled: true },
      { term: "Linov HR", enabled: true },
      { term: "PT Linov Roket Prestasi", enabled: true },
    ],
    { onConflict: "term" }
  );

  // 3. Simpan kompetitor contoh dengan is_demo = true (fallback jika kolom belum dimigrasi)
  const compWithDemo = await supabase
    .from("competitors")
    .upsert(
      DEMO_COMPETITORS.map((c) => ({ ...c, is_demo: true })),
      { onConflict: "domain" }
    );
  if (compWithDemo.error) {
    await supabase
      .from("competitors")
      .upsert(DEMO_COMPETITORS, { onConflict: "domain" });
  }

  // 4. Simpan grup keyword contoh dengan is_demo = true (fallback jika kolom belum dimigrasi)
  let groupRows: Array<{ id: string; name: string }> | null = null;
  const grpWithDemo = await supabase
    .from("keyword_groups")
    .upsert(
      DEMO_GROUP_NAMES.map((name) => ({ name, is_demo: true })),
      { onConflict: "name" }
    )
    .select("id, name");

  if (!grpWithDemo.error && grpWithDemo.data) {
    groupRows = grpWithDemo.data as Array<{ id: string; name: string }>;
  } else {
    const grpFallback = await supabase
      .from("keyword_groups")
      .upsert(
        DEMO_GROUP_NAMES.map((name) => ({ name })),
        { onConflict: "name" }
      )
      .select("id, name");
    if (grpFallback.error || !grpFallback.data) {
      throw new Error(`Failed to save keyword groups: ${grpFallback.error?.message}`);
    }
    groupRows = grpFallback.data as Array<{ id: string; name: string }>;
  }

  const groupIdByName = new Map<string, string>();
  for (const g of groupRows) {
    groupIdByName.set(g.name, g.id);
  }

  // 5. Simpan 19 keyword contoh dengan is_demo = true (fallback jika kolom belum dimigrasi)
  let kwRows: Array<{ id: string; text: string }> | null = null;
  const kwWithDemo = await supabase
    .from("keywords")
    .upsert(
      DEMO_KEYWORDS.map(([text, groupName]) => ({
        text,
        group_id: groupIdByName.get(groupName) ?? null,
        active: true,
        is_demo: true,
      })),
      { onConflict: "text" }
    )
    .select("id, text");

  if (!kwWithDemo.error && kwWithDemo.data) {
    kwRows = kwWithDemo.data as Array<{ id: string; text: string }>;
  } else {
    const kwFallback = await supabase
      .from("keywords")
      .upsert(
        DEMO_KEYWORDS.map(([text, groupName]) => ({
          text,
          group_id: groupIdByName.get(groupName) ?? null,
          active: true,
        })),
        { onConflict: "text" }
      )
      .select("id, text");
    if (kwFallback.error || !kwFallback.data) {
      throw new Error(`Failed to save demo keywords: ${kwFallback.error?.message}`);
    }
    kwRows = kwFallback.data as Array<{ id: string; text: string }>;
  }

  const kwIdByText = new Map<string, string>();
  for (const k of kwRows) {
    kwIdByText.set(k.text, k.id);
  }

  // 6. Susun pola 8 minggu persis seperti dashboard-ai-overview.html
  const buckets = buildEightWeekBuckets(new Date());
  const compDomains = DEMO_COMPETITORS.map((c) => c.domain);

  const generatedKeywords = DEMO_KEYWORDS.map(([kwText, grpName], i) => {
    const r = createRng(i * 97 + 13);
    const bias = r() * 0.35;
    const weeklyStates: Array<0 | 1 | 2> = [];
    for (let w = 0; w < 8; w++) {
      const hasAio = r() < (GROUP_PROBABILITIES[grpName] ?? 0.75);
      const isCited =
        r() <
        0.12 +
          bias +
          w * 0.035 +
          (grpName === "Merek" ? 0.4 : 0) +
          (grpName === "Umum" ? -0.1 : 0);
      weeklyStates.push(hasAio ? (isCited ? 2 : 1) : 0);
    }
    const detectionKind = Math.floor(createRng(i * 53 + 5)() * 3); // 0=domain, 1=text, 2=third_party
    return {
      id: kwIdByText.get(kwText)!,
      text: kwText,
      groupName: grpName,
      weeklyStates,
      detectionKind,
      seedIndex: i,
    };
  });

  let totalChecksInserted = 0;
  let totalSourcesInserted = 0;

  for (let w = 0; w < 8; w++) {
    const bucket = buckets[w]!;
    const checkedAtIso = new Date(bucket.startMs + 3600_000).toISOString();
    const finishedAtIso = new Date(bucket.startMs + 3900_000).toISOString();

    let runId: string;
    const withDemoInsert = await supabase
      .from("check_runs")
      .insert({
        started_at: checkedAtIso,
        finished_at: finishedAtIso,
        total: generatedKeywords.length,
        done: generatedKeywords.length,
        status: "done",
        is_demo: true,
      })
      .select("id")
      .single();

    if (withDemoInsert.error) {
      const fallbackInsert = await supabase
        .from("check_runs")
        .insert({
          started_at: checkedAtIso,
          finished_at: finishedAtIso,
          total: generatedKeywords.length,
          done: generatedKeywords.length,
          status: "done",
        })
        .select("id")
        .single();
      if (fallbackInsert.error || !fallbackInsert.data) {
        throw new Error(
          `Failed to create check_run for week ${w + 1}: ${fallbackInsert.error?.message}`
        );
      }
      runId = (fallbackInsert.data as { id: string }).id;
    } else {
      runId = (withDemoInsert.data as { id: string }).id;
    }

    const weekCheckPayloads = generatedKeywords.map((kw) => {
      const cell = kw.weeklyStates[w]!;
      const status: CheckStatus =
        cell === 2
          ? "detected"
          : cell === 1
            ? "not_detected"
            : "no_ai_overview";

      const hasAiOverview = cell > 0;
      const detectedDomain = cell === 2 && kw.detectionKind === 0;
      const detectedText =
        cell === 2 && (kw.detectionKind === 1 || kw.detectionKind === 0);
      const detectedThirdParty = cell === 2 && kw.detectionKind === 2;

      let answerText: string | null = null;
      if (hasAiOverview) {
        if (detectedText) {
          answerText = `Untuk kebutuhan "${kw.text}", perusahaan di Indonesia umumnya menggunakan sistem HRIS terintegrasi seperti LinovHR (PT Linov Roket Prestasi) guna mengelola absensi, penggajian (payroll), perhitungan PPh 21, serta manajemen talenta secara otomatis dan akurat.`;
        } else if (detectedThirdParty) {
          answerText = `Dalam memilih solusi terkait "${kw.text}", pastikan aplikasi mendukung kepatuhan regulasi ketenagakerjaan Indonesia, integrasi absensi real-time, serta kemudahan layanan mandiri karyawan (ESS). Beberapa ulasan industri juga membandingkan berbagai vendor HRIS lokal.`;
        } else {
          answerText = `Ringkasan AI Overview untuk "${kw.text}": Sistem informasi sumber daya manusia membantu tim HR mengotomatiskan administrasi karyawan, penggajian bulanan, pelaporan pajak, dan evaluasi kinerja secara terpusat.`;
        }
      }

      return {
        run_id: runId,
        keyword_id: kw.id,
        checked_at: checkedAtIso,
        answer_text: answerText,
        detected_domain: detectedDomain,
        detected_text: detectedText,
        detected_third_party: detectedThirdParty,
        status,
        raw: {
          ai_overview: hasAiOverview
            ? {
                text_blocks: [{ type: "paragraph", snippet: answerText ?? "" }],
              }
            : undefined,
          dry_run: true,
          demo_seed: true,
          week_label: bucket.label,
          serpapi_calls_count: 1,
        },
      };
    });

    const { data: insertedChecks, error: chkErr } = await supabase
      .from("checks")
      .insert(weekCheckPayloads)
      .select("id, keyword_id");

    if (chkErr || !insertedChecks) {
      throw new Error(`Failed to save checks for week ${w + 1}: ${chkErr?.message}`);
    }
    totalChecksInserted += insertedChecks.length;

    const checkIdByKwId = new Map<string, string>();
    for (const row of insertedChecks as Array<{ id: string; keyword_id: string }>) {
      checkIdByKwId.set(row.keyword_id, row.id);
    }

    const weekSourceRows: Array<{
      check_id: string;
      position: number;
      title: string;
      url: string;
      domain: string;
      is_own: boolean;
      is_competitor: boolean;
      mentions_brand: boolean;
    }> = [];

    for (const kw of generatedKeywords) {
      const cell = kw.weeklyStates[w]!;
      const hasAiOverview = cell > 0;
      if (!hasAiOverview) continue;

      const checkId = checkIdByKwId.get(kw.id);
      if (!checkId) continue;

      const detectedDomain = cell === 2 && kw.detectionKind === 0;
      const detectedThirdParty = cell === 2 && kw.detectionKind === 2;

      const pickRng = createRng(kw.seedIndex * 31 + 7 + w * 11);
      const pool = [...compDomains];
      const chosenDomains: string[] = [];

      if (detectedDomain) {
        chosenDomains.push(ownDomain);
      }
      while (chosenDomains.length < 3 && pool.length > 0) {
        const idx = Math.floor(pickRng() * pool.length);
        const picked = pool.splice(idx, 1)[0];
        if (picked) chosenDomains.push(picked);
      }

      const slug = kw.text.replace(/\s+/g, "-").toLowerCase();
      chosenDomains.forEach((domain, sIdx) => {
        weekSourceRows.push({
          check_id: checkId,
          position: sIdx + 1,
          title:
            domain === ownDomain
              ? `Comprehensive Guide: ${kw.text} — LinovHR`
              : `Reference Article: ${kw.text} (${domain})`,
          url: `https://${domain}/artikel/${slug}`,
          domain,
          is_own: domain === ownDomain,
          is_competitor: domain !== ownDomain,
          mentions_brand:
            domain === ownDomain || (detectedThirdParty && sIdx === 0),
        });
      });
    }

    if (weekSourceRows.length > 0) {
      const { error: srcErr } = await supabase
        .from("check_sources")
        .insert(weekSourceRows);
      if (srcErr) {
        throw new Error(`Failed to save check_sources: ${srcErr.message}`);
      }
      totalSourcesInserted += weekSourceRows.length;
    }
  }

  console.log(`Finished seeding 8 weeks of demo data (is_demo = true):`);
  console.log(`- ${DEMO_GROUP_NAMES.length} demo keyword_groups`);
  console.log(`- ${DEMO_KEYWORDS.length} demo keywords`);
  console.log(`- ${DEMO_COMPETITORS.length} demo competitors`);
  console.log(`- 8 check_runs (${totalChecksInserted} checks & ${totalSourcesInserted} check_sources)`);
}

main().catch((err) => {
  console.error("Failed to run seed:demo:", err);
  process.exit(1);
});
