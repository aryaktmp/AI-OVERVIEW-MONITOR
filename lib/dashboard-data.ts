import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeCompetitorDomainRanking,
  computeDashboardAnalytics,
  type AnalyticsCheckInput,
  type AnalyticsKeywordInput,
  type CompetitorRankingRow,
  type DashboardSummaryAnalytics,
  type SourceCitationInput,
} from "@/lib/analytics";
import {
  DEFAULT_BRAND_TERMS,
  type BrandTermConfig,
  type CheckStatus,
} from "@/lib/detect";
import {
  RATE_LIMIT_WINDOW_MS,
  createSupabaseQueueStore,
  extractSerpApiCallsFromRaw,
} from "@/lib/queue";
import {
  isKnownDemoCompetitorDomain,
  isKnownDemoGroupName,
  isKnownDemoKeywordText,
} from "@/lib/demo-data";

export interface SearchSettingsConfig {
  location: string;
  google_domain: string;
  gl: string;
  hl: string;
  enable_third_party_check: boolean;
}

export const DEFAULT_SEARCH_SETTINGS: SearchSettingsConfig = {
  location: "Indonesia",
  google_domain: "google.co.id",
  gl: "id",
  hl: "id",
  enable_third_party_check: false,
};

export async function getDashboardOverviewData(): Promise<{
  analytics: DashboardSummaryAnalytics;
  groups: Array<{ id: string; name: string }>;
}> {
  const supabase = createSupabaseAdminClient();

  const eightWeeksAgoIso = new Date(
    Date.now() - 60 * 24 * 60 * 60 * 1000
  ).toISOString();

  const [
    { data: groupsData, error: groupsErr },
    { data: keywordsData, error: kwErr },
    { data: checksData, error: checksErr },
    { data: runsData },
  ] = await Promise.all([
    supabase.from("keyword_groups").select("id, name").order("name"),
    supabase
      .from("keywords")
      .select("id, text, active, group_id, keyword_groups(name)")
      .order("created_at", { ascending: true }),
    // Hanya ambil kolom agregasi dari 8 minggu terakhir (tanpa menarik answer_text atau raw penuh ke memori/browser)
    supabase
      .from("checks")
      .select(
        "id, keyword_id, run_id, checked_at, status, detected_domain, detected_text, detected_third_party, raw->dry_run"
      )
      .gte("checked_at", eightWeeksAgoIso)
      .order("checked_at", { ascending: false }),
    supabase
      .from("check_runs")
      .select("id, started_at, status, total, done")
      .gte("started_at", eightWeeksAgoIso),
  ]);

  if (groupsErr) {
    throw new Error(`Gagal memuat grup keyword: ${groupsErr.message}`);
  }
  if (kwErr) {
    throw new Error(`Gagal memuat daftar keyword: ${kwErr.message}`);
  }
  if (checksErr) {
    throw new Error(`Gagal memuat data pengecekan: ${checksErr.message}`);
  }

  // Periksa apakah ada check_runs dengan is_demo = true (jika kolom sudah dimigrasi)
  const demoRunIds = new Set<string>();
  const { data: demoRuns } = await supabase
    .from("check_runs")
    .select("id, is_demo")
    .eq("is_demo", true);
  for (const r of demoRuns ?? []) {
    demoRunIds.add((r as { id: string }).id);
  }
  void runsData;

  const keywords: AnalyticsKeywordInput[] = (keywordsData ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      text: string;
      active: boolean;
      keyword_groups?: { name: string } | Array<{ name: string }> | null;
    };
    const grpObj = Array.isArray(r.keyword_groups)
      ? r.keyword_groups[0]
      : r.keyword_groups;
    return {
      id: r.id,
      text: r.text,
      active: r.active,
      groupName: grpObj?.name ?? "Tanpa Grup",
    };
  });

  const checks: AnalyticsCheckInput[] = (checksData ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      keyword_id: string;
      run_id: string;
      checked_at: string;
      status: CheckStatus;
      detected_domain: boolean;
      detected_text: boolean;
      detected_third_party: boolean;
      dry_run?: boolean;
    };
    return {
      id: r.id,
      keyword_id: r.keyword_id,
      run_id: r.run_id,
      checked_at: r.checked_at,
      status: r.status,
      detected_domain: r.detected_domain,
      detected_text: r.detected_text,
      detected_third_party: r.detected_third_party,
      is_demo: Boolean(r.dry_run === true || demoRunIds.has(r.run_id)),
    };
  });

  const analytics = computeDashboardAnalytics(keywords, checks);
  const hasDemoKeywordsOrGroups =
    keywords.some((k) => isKnownDemoKeywordText(k.text)) ||
    (groupsData ?? []).some((g: { name: string }) =>
      isKnownDemoGroupName(g.name)
    );
  if (hasDemoKeywordsOrGroups || demoRunIds.size > 0) {
    analytics.hasDemoData = true;
  }

  return {
    analytics,
    groups: (groupsData ?? []) as Array<{ id: string; name: string }>,
  };
}

export interface KeywordDetailCheckItem {
  id: string;
  checked_at: string;
  status: CheckStatus;
  answer_text: string | null;
  detected_domain: boolean;
  detected_text: boolean;
  detected_third_party: boolean;
  is_demo: boolean;
  serpapi_calls: number;
  sources: Array<{
    id: string;
    position: number;
    title: string | null;
    url: string;
    domain: string;
    is_own: boolean;
    is_competitor: boolean;
    mentions_brand: boolean;
  }>;
}

export async function getKeywordDetailData(keywordId: string): Promise<{
  keyword: {
    id: string;
    text: string;
    active: boolean;
    groupName: string;
  } | null;
  checks: KeywordDetailCheckItem[];
  brandTerms: BrandTermConfig[];
  hasDemoData: boolean;
}> {
  const supabase = createSupabaseAdminClient();

  const [
    { data: kwRow, error: kwErr },
    { data: checksRows, error: checksErr },
    { data: termsRows },
  ] = await Promise.all([
    supabase
      .from("keywords")
      .select("id, text, active, keyword_groups(name)")
      .eq("id", keywordId)
      .maybeSingle(),
    supabase
      .from("checks")
      .select(
        "id, run_id, checked_at, status, answer_text, detected_domain, detected_text, detected_third_party, raw, check_sources(id, position, title, url, domain, is_own, is_competitor, mentions_brand)"
      )
      .eq("keyword_id", keywordId)
      .order("checked_at", { ascending: false })
      .limit(20),
    supabase.from("brand_terms").select("term, enabled").order("term"),
  ]);

  if (kwErr) {
    throw new Error(`Gagal memuat detail keyword: ${kwErr.message}`);
  }
  if (checksErr) {
    throw new Error(`Gagal memuat riwayat pengecekan: ${checksErr.message}`);
  }

  if (!kwRow) {
    return {
      keyword: null,
      checks: [],
      brandTerms: DEFAULT_BRAND_TERMS,
      hasDemoData: false,
    };
  }

  const typedKw = kwRow as unknown as {
    id: string;
    text: string;
    active: boolean;
    keyword_groups?: { name: string } | Array<{ name: string }> | null;
  };
  const grpObj = Array.isArray(typedKw.keyword_groups)
    ? typedKw.keyword_groups[0]
    : typedKw.keyword_groups;

  let hasDemoData = false;
  const checks: KeywordDetailCheckItem[] = (checksRows ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      checked_at: string;
      status: CheckStatus;
      answer_text: string | null;
      detected_domain: boolean;
      detected_text: boolean;
      detected_third_party: boolean;
      raw: Record<string, unknown> | null;
      check_sources: Array<{
        id: string;
        position: number;
        title: string | null;
        url: string;
        domain: string;
        is_own: boolean;
        is_competitor: boolean;
        mentions_brand: boolean;
      }>;
    };
    const isDemo = Boolean(r.raw?.dry_run === true);
    if (isDemo) hasDemoData = true;

    const sortedSources = [...(r.check_sources ?? [])].sort(
      (a, b) => a.position - b.position
    );

    return {
      id: r.id,
      checked_at: r.checked_at,
      status: r.status,
      answer_text: r.answer_text,
      detected_domain: r.detected_domain,
      detected_text: r.detected_text,
      detected_third_party: r.detected_third_party,
      is_demo: isDemo,
      serpapi_calls: extractSerpApiCallsFromRaw(r.raw, {
        includeDryRun: true,
      }),
      sources: sortedSources,
    };
  });

  const brandTerms: BrandTermConfig[] =
    termsRows && termsRows.length > 0
      ? (termsRows as BrandTermConfig[])
      : DEFAULT_BRAND_TERMS;

  return {
    keyword: {
      id: typedKw.id,
      text: typedKw.text,
      active: typedKw.active,
      groupName: grpObj?.name ?? "Tanpa Grup",
    },
    checks,
    brandTerms,
    hasDemoData,
  };
}

export async function getCompetitorPageData(): Promise<{
  ranking: CompetitorRankingRow[];
  competitors: Array<{ id: string; name: string; domain: string }>;
  hasDemoData: boolean;
  totalChecksAnalyzed: number;
}> {
  const supabase = createSupabaseAdminClient();
  const ownDomain = process.env.BRAND_DOMAIN ?? "linovhr.com";

  const [{ data: compRows, error: compErr }, { data: recentChecks, error: chkErr }] =
    await Promise.all([
      supabase.from("competitors").select("id, name, domain").order("name"),
      supabase
        .from("checks")
        .select(
          "id, keyword_id, checked_at, raw->dry_run, check_sources(domain, url)"
        )
        .order("checked_at", { ascending: false })
        .limit(300),
    ]);

  if (compErr) {
    throw new Error(`Gagal memuat daftar kompetitor: ${compErr.message}`);
  }
  if (chkErr) {
    throw new Error(`Gagal memuat sumber kutipan: ${chkErr.message}`);
  }

  // Ambil hanya cek terbaru untuk setiap keyword_id
  const seenKeywordIds = new Set<string>();
  const citations: SourceCitationInput[] = [];
  let hasDemoData = false;

  for (const row of recentChecks ?? []) {
    const r = row as unknown as {
      id: string;
      keyword_id: string;
      dry_run?: boolean;
      check_sources?: Array<{ domain: string; url: string }>;
    };
    if (seenKeywordIds.has(r.keyword_id)) continue;
    seenKeywordIds.add(r.keyword_id);

    if (r.dry_run === true) {
      hasDemoData = true;
    }

    for (const src of r.check_sources ?? []) {
      citations.push({
        keyword_id: r.keyword_id,
        domain: src.domain,
        url: src.url,
      });
    }
  }

  const competitors = (compRows ?? []) as Array<{
    id: string;
    name: string;
    domain: string;
  }>;

  const ranking = computeCompetitorDomainRanking(
    citations,
    ownDomain,
    competitors.map((c) => c.domain)
  );

  return {
    ranking,
    competitors,
    hasDemoData,
    totalChecksAnalyzed: seenKeywordIds.size,
  };
}

export interface RunHistoryRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total: number;
  done: number;
  is_demo: boolean;
  serpapi_calls: number;
}

export interface DatabaseStorageStats {
  usedBytes: number;
  usedMb: number;
  quotaMb: number;
  percentUsed: number;
}

export async function getSettingsPageData(): Promise<{
  brandTerms: Array<{ id: string; term: string; enabled: boolean }>;
  competitors: Array<{ id: string; name: string; domain: string }>;
  searchSettings: SearchSettingsConfig;
  recentRuns: RunHistoryRow[];
  activeKeywordsCount: number;
  estimatedCallsForNextRun: number;
  hourlyCallsUsed: number;
  maxPerHour: number;
  isDryRunEnv: boolean;
  hasDemoData: boolean;
  databaseStorage: DatabaseStorageStats;
  runningRun: RunHistoryRow | null;
}> {
  const supabase = createSupabaseAdminClient();
  const store = createSupabaseQueueStore(supabase);

  const oneHourAgoIso = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MS
  ).toISOString();

  const [
    { data: termsData },
    { data: compData },
    { data: runsData },
    { count: activeKwCount },
    { count: totalChecksCount },
    { count: totalSourcesCount },
    hourlyCallsUsed,
    dbSizeRpc,
  ] = await Promise.all([
    supabase
      .from("brand_terms")
      .select("id, term, enabled")
      .order("term", { ascending: true }),
    supabase
      .from("competitors")
      .select("id, name, domain")
      .order("name", { ascending: true }),
    supabase
      .from("check_runs")
      .select("id, started_at, finished_at, status, total, done")
      .order("started_at", { ascending: false })
      .limit(15),
    supabase
      .from("keywords")
      .select("id", { count: "exact" })
      .eq("active", true)
      .limit(0),
    supabase.from("checks").select("id", { count: "exact" }).limit(0),
    supabase.from("check_sources").select("id", { count: "exact" }).limit(0),
    store.getHourlySerpApiCalls(oneHourAgoIso),
    supabase.rpc("get_database_size_bytes"),
  ]);

  // Baca tabel settings (dengan fallback jika tabel settings belum dimigrasi)
  let searchSettings: SearchSettingsConfig = { ...DEFAULT_SEARCH_SETTINGS };
  const settingsRes = await supabase
    .from("settings")
    .select("value")
    .eq("key", "search_config")
    .maybeSingle();

  if (!settingsRes.error && settingsRes.data?.value) {
    const val = settingsRes.data.value as Partial<SearchSettingsConfig>;
    searchSettings = {
      location: val.location ?? DEFAULT_SEARCH_SETTINGS.location,
      google_domain: val.google_domain ?? DEFAULT_SEARCH_SETTINGS.google_domain,
      gl: val.gl ?? DEFAULT_SEARCH_SETTINGS.gl,
      hl: val.hl ?? DEFAULT_SEARCH_SETTINGS.hl,
      enable_third_party_check:
        val.enable_third_party_check ??
        DEFAULT_SEARCH_SETTINGS.enable_third_party_check,
    };
  }

  const runIds = (runsData ?? []).map((r: { id: string }) => r.id);
  const callsByRunId = new Map<string, number>();
  const demoByRunId = new Map<string, boolean>();

  if (runIds.length > 0) {
    const { data: runChecks } = await supabase
      .from("checks")
      .select("run_id, raw")
      .in("run_id", runIds);

    for (const c of runChecks ?? []) {
      const typed = c as { run_id: string; raw: Record<string, unknown> | null };
      const prev = callsByRunId.get(typed.run_id) ?? 0;
      callsByRunId.set(
        typed.run_id,
        prev + extractSerpApiCallsFromRaw(typed.raw, { includeDryRun: true })
      );
      if (typed.raw?.dry_run === true) {
        demoByRunId.set(typed.run_id, true);
      }
    }
  }

  let hasDemoData = false;
  const recentRuns: RunHistoryRow[] = (runsData ?? []).map((r) => {
    const typed = r as {
      id: string;
      started_at: string;
      finished_at: string | null;
      status: string;
      total: number;
      done: number;
    };
    const isDemo = Boolean(demoByRunId.get(typed.id));
    if (isDemo) hasDemoData = true;
    return {
      ...typed,
      is_demo: isDemo,
      serpapi_calls: callsByRunId.get(typed.id) ?? 0,
    };
  });

  const activeKeywordsCount = activeKwCount ?? 0;
  // Perkiraan 1 s/d 2 panggilan per keyword (rata-rata ~1.3 panggilan jika ada page_token)
  const estimatedCallsForNextRun = Math.ceil(activeKeywordsCount * 1.3);
  const maxPerHour =
    Number(process.env.SERPAPI_MAX_PER_HOUR) > 0
      ? Number(process.env.SERPAPI_MAX_PER_HOUR)
      : 50;
  const isDryRunEnv =
    process.env.SERPAPI_DRY_RUN === "true" ||
    process.env.SERPAPI_DRY_RUN === "1";

  const hasDemoCompetitors = (compData ?? []).some((c: { domain: string }) =>
    isKnownDemoCompetitorDomain(c.domain)
  );
  if (hasDemoCompetitors) {
    hasDemoData = true;
  }

  // Ukuran database (dari fungsi SQL get_database_size_bytes() atau estimasi ruang jika migrasi belum dijalankan)
  const baseOverheadBytes = 8 * 1024 * 1024; // ~8 MB sistem & katalog Postgres dasar
  const estimatedRowsBytes =
    (totalChecksCount ?? 0) * 4096 + (totalSourcesCount ?? 0) * 512;
  const rpcBytes =
    !dbSizeRpc.error && dbSizeRpc.data !== null && dbSizeRpc.data !== undefined
      ? Number(dbSizeRpc.data)
      : Number.NaN;
  const usedBytes =
    Number.isFinite(rpcBytes) && rpcBytes > 0
      ? rpcBytes
      : baseOverheadBytes + estimatedRowsBytes;
  const quotaMb = 500;
  const usedMb = Math.round((usedBytes / (1024 * 1024)) * 100) / 100;
  const percentUsed = Math.min(
    100,
    Math.round((usedMb / quotaMb) * 1000) / 10
  );

  const runningRun =
    recentRuns.find((r) => r.status === "running") ?? null;

  return {
    brandTerms: (termsData ?? []) as Array<{
      id: string;
      term: string;
      enabled: boolean;
    }>,
    competitors: (compData ?? []) as Array<{
      id: string;
      name: string;
      domain: string;
    }>,
    searchSettings,
    recentRuns,
    activeKeywordsCount,
    estimatedCallsForNextRun,
    hourlyCallsUsed,
    maxPerHour,
    isDryRunEnv,
    hasDemoData,
    databaseStorage: {
      usedBytes,
      usedMb,
      quotaMb,
      percentUsed,
    },
    runningRun,
  };
}
