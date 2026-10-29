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
 * Menghapus seluruh data contoh di keempat tabel:
 * 1. check_runs (beserta checks & check_sources via ON DELETE CASCADE)
 * 2. keywords (is_demo = true)
 * 3. keyword_groups (is_demo = true)
 * 4. competitors (is_demo = true)
 */
export async function clearAllDemoData(supabase: SupabaseClient): Promise<{
  deletedRunsCount: number;
}> {
  // 1. Cari semua run_id yang memiliki checks dengan dry_run = true
  const { data: dryChecks } = await supabase
    .from("checks")
    .select("run_id, raw");

  const demoRunIds = new Set<string>();
  for (const c of dryChecks ?? []) {
    const typed = c as { run_id: string; raw: Record<string, unknown> | null };
    if (typed.raw?.dry_run === true) {
      demoRunIds.add(typed.run_id);
    }
  }

  // Hapus check_runs dengan is_demo = true (jika kolom sudah dimigrasi)
  const { data: demoRuns } = await supabase
    .from("check_runs")
    .select("id")
    .eq("is_demo", true);
  for (const r of demoRuns ?? []) {
    demoRunIds.add((r as { id: string }).id);
  }

  await supabase.from("check_runs").delete().eq("is_demo", true);

  if (demoRunIds.size > 0) {
    await supabase
      .from("check_runs")
      .delete()
      .in("id", Array.from(demoRunIds));
  }

  // 2. Hapus keywords contoh (is_demo = true, dengan fallback daftar teks seeder)
  const delKwRes = await supabase
    .from("keywords")
    .delete()
    .eq("is_demo", true);
  if (delKwRes.error) {
    await supabase
      .from("keywords")
      .delete()
      .in("text", ALL_KNOWN_DEMO_KEYWORD_TEXTS);
  }

  // 3. Hapus keyword_groups contoh (is_demo = true, dengan fallback nama grup seeder)
  const delGrpRes = await supabase
    .from("keyword_groups")
    .delete()
    .eq("is_demo", true);
  if (delGrpRes.error) {
    await supabase
      .from("keyword_groups")
      .delete()
      .in("name", DEMO_GROUP_NAMES);
  }

  // 4. Hapus competitors contoh (is_demo = true, dengan fallback domain seeder)
  const delCompRes = await supabase
    .from("competitors")
    .delete()
    .eq("is_demo", true);
  if (delCompRes.error) {
    await supabase
      .from("competitors")
      .delete()
      .in("domain", DEMO_COMPETITOR_DOMAINS);
  }

  return {
    deletedRunsCount: demoRunIds.size,
  };
}
