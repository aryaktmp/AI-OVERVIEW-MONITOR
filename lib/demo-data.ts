import type { SupabaseClient } from "@supabase/supabase-js";

export const DEMO_COMPETITORS = [
  { name: "HRISKu", domain: "hrisku.id" },
  { name: "PayrollPintar", domain: "payrollpintar.com" },
  { name: "Timesheet ID", domain: "timesheet.co.id" },
  { name: "Blog SDM", domain: "blogsdm.id" },
  { name: "KerjaPlus", domain: "kerjaplus.com" },
];

export const DEMO_KEYWORDS: Array<[string, string]> = [
  ["software hr terbaik", "Produk HR"],
  ["aplikasi hris indonesia", "Produk HR"],
  ["software payroll terbaik", "Produk HR"],
  ["aplikasi absensi karyawan", "Produk HR"],
  ["software rekrutmen terbaik", "Produk HR"],
  ["apa itu hris", "Panduan HR"],
  ["cara hitung pph 21 karyawan", "Panduan HR"],
  ["cara mengelola cuti karyawan", "Panduan HR"],
  ["cara membuat slip gaji", "Panduan HR"],
  ["hris vs hrms", "Perbandingan"],
  ["hris lokal vs global", "Perbandingan"],
  ["payroll manual vs software", "Perbandingan"],
  ["linovhr", "Merek"],
  ["review linovhr", "Merek"],
  ["harga linovhr", "Merek"],
  ["linovhr vs aplikasi hr lain", "Merek"],
  ["software manajemen proyek terbaik", "Umum"],
  ["aplikasi akuntansi terbaik", "Umum"],
  ["cara meningkatkan produktivitas tim", "Umum"],
];

export const DEMO_GROUP_NAMES = Array.from(
  new Set(DEMO_KEYWORDS.map((k) => k[1]))
);

export const ALL_KNOWN_DEMO_KEYWORD_TEXTS = Array.from(
  new Set([
    ...DEMO_KEYWORDS.map((k) => k[0]),
    "software hris indonesia",
    "aplikasi absensi online",
    "aplikasi slip gaji karyawan",
    "sistem manajemen sdm",
    "aplikasi penilaian kinerja karyawan",
  ])
);

export const DEMO_COMPETITOR_DOMAINS = DEMO_COMPETITORS.map((c) => c.domain);

export function isKnownDemoKeywordText(text: string): boolean {
  return ALL_KNOWN_DEMO_KEYWORD_TEXTS.includes(text.trim().toLowerCase());
}

export function isKnownDemoGroupName(name: string): boolean {
  return DEMO_GROUP_NAMES.includes(name.trim());
}

export function isKnownDemoCompetitorDomain(domain: string): boolean {
  return DEMO_COMPETITOR_DOMAINS.includes(domain.trim().toLowerCase());
}

/**
 * Deletes demo data strictly where is_demo = true across:
 * 1. check_runs (and associated checks/sources via ON DELETE CASCADE)
 * 2. keywords (is_demo = true)
 * 3. keyword_groups (is_demo = true)
 * 4. competitors (is_demo = true)
 *
 * Safety check:
 * Rejects if there are any check_runs with is_demo = true whose checks have raw.dry_run !== true.
 */
export async function clearAllDemoData(supabase: SupabaseClient): Promise<{
  deletedRunsCount: number;
}> {
  // 1. Find all check_runs with is_demo = true
  const { data: demoRuns, error: runsErr } = await supabase
    .from("check_runs")
    .select("id")
    .eq("is_demo", true);

  if (runsErr) {
    throw new Error(`Failed to query demo check_runs: ${runsErr.message}`);
  }

  const demoRunIds = (demoRuns ?? []).map((r: { id: string }) => r.id);

  if (demoRunIds.length > 0) {
    // 2. Safety check: inspect all checks under demo runs
    const { data: demoChecks, error: checksErr } = await supabase
      .from("checks")
      .select("id, run_id, raw")
      .in("run_id", demoRunIds);

    if (checksErr) {
      throw new Error(
        `Failed to inspect demo checks for safety verification: ${checksErr.message}`
      );
    }

    for (const chk of demoChecks ?? []) {
      const typed = chk as {
        id: string;
        run_id: string;
        raw: Record<string, unknown> | null;
      };
      if (!typed.raw || typed.raw.dry_run !== true) {
        throw new Error(
          `Safety violation: Check ${typed.id} in is_demo run ${typed.run_id} does not have checks.raw.dry_run = true. Aborting demo clear.`
        );
      }
    }

    // 3. Delete check_runs where is_demo = true
    const { error: delRunsErr } = await supabase
      .from("check_runs")
      .delete()
      .eq("is_demo", true);

    if (delRunsErr) {
      throw new Error(
        `Failed to delete demo check_runs: ${delRunsErr.message}`
      );
    }
  }

  // 4. Delete keywords where is_demo = true
  const { error: delKwErr } = await supabase
    .from("keywords")
    .delete()
    .eq("is_demo", true);

  if (delKwErr) {
    throw new Error(`Failed to delete demo keywords: ${delKwErr.message}`);
  }

  // 5. Delete keyword_groups where is_demo = true
  const { error: delGrpErr } = await supabase
    .from("keyword_groups")
    .delete()
    .eq("is_demo", true);

  if (delGrpErr) {
    throw new Error(
      `Failed to delete demo keyword_groups: ${delGrpErr.message}`
    );
  }

  // 6. Delete competitors where is_demo = true
  const { error: delCompErr } = await supabase
    .from("competitors")
    .delete()
    .eq("is_demo", true);

  if (delCompErr) {
    throw new Error(`Failed to delete demo competitors: ${delCompErr.message}`);
  }

  return {
    deletedRunsCount: demoRunIds.length,
  };
}
