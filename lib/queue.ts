import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_BRAND_TERMS,
  evaluateAiOverviewDetection,
  type AnnotatedCheckSource,
  type BrandTermConfig,
  type CheckStatus,
} from "./detect.ts";
import {
  fetchKeywordAiOverview,
  sanitizeSerpApiRaw,
  type SerpApiCheckResult,
  type SerpApiRawResponse,
} from "./serpapi.ts";
import { isKnownDemoKeywordText } from "./demo-data.ts";
import {
  createSupabasePageCacheStore,
  evaluateThirdPartySourcesForCheck,
  type PageCacheStore,
} from "./fetch-page.ts";

export const STUCK_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 60 menit
export const MAX_RETRIES = 2; // Maksimal 2 kali percobaan ulang (total 3 eksekusi sebelum state 'error')
export const DEFAULT_RETRY_BASE_DELAY_MS = 15 * 1000; // 15 detik, lalu 30 detik

export type RunItemState = "pending" | "processing" | "done" | "error";
export type CheckRunStatus = "running" | "done" | "failed";

export interface RunItemRecord {
  id: string;
  run_id: string;
  keyword_id: string;
  state: RunItemState;
  attempts: number;
  error: string | null;
  updated_at: string;
  run_is_demo?: boolean;
}

export interface CheckRunRecord {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: CheckRunStatus;
  total: number;
  done: number;
  is_demo?: boolean;
  serpapi_calls?: number;
}

export interface KeywordRecord {
  id: string;
  text: string;
  active: boolean;
  is_demo?: boolean;
}

export interface CheckInsertPayload {
  run_id: string;
  keyword_id: string;
  checked_at: string;
  status: CheckStatus;
  answer_text: string;
  detected_domain: boolean;
  detected_text: boolean;
  detected_third_party: boolean;
  raw: SerpApiRawResponse;
  serpapi_callsCount: number;
  sources: AnnotatedCheckSource[];
}

export interface RunSummary {
  runId: string;
  status: CheckRunStatus;
  total: number;
  done: number;
  errors: number;
  pending: number;
  serpApiCalls: number;
  isDemo: boolean;
}

export interface QueueStore {
  getRunningCheckRun(): Promise<CheckRunRecord | null>;
  getActiveKeywords(): Promise<KeywordRecord[]>;
  createCheckRun(
    total: number,
    nowIso: string,
    isDemo?: boolean
  ): Promise<CheckRunRecord>;
  insertRunItems(
    runId: string,
    keywordIds: string[],
    nowIso: string
  ): Promise<void>;
  recoverStuckProcessingItems(
    cutoffIso: string,
    nowIso: string
  ): Promise<string[]>;
  getHourlySerpApiCalls(sinceIso: string): Promise<number>;
  listPendingCandidates(limit: number): Promise<RunItemRecord[]>;
  claimPendingItemAtomically(
    itemId: string,
    nowIso: string
  ): Promise<RunItemRecord | null>;
  getKeywordById(keywordId: string): Promise<KeywordRecord | null>;
  getDetectionContext(): Promise<{
    brandTerms: BrandTermConfig[];
    competitorDomains: string[];
    enableThirdPartyCheck?: boolean;
    pageCacheStore?: PageCacheStore;
  }>;
  saveCheckAndSources(payload: CheckInsertPayload): Promise<string>;
  markRunItemDone(itemId: string, nowIso: string): Promise<void>;
  markRunItemFailedAttempt(
    itemId: string,
    nextState: "pending" | "error",
    attempts: number,
    errorMessage: string,
    callsUsedInAttempt: number,
    nowIso: string
  ): Promise<void>;
  syncRunProgress(
    runId: string,
    nowIso: string,
    forceIsDemo?: boolean
  ): Promise<RunSummary>;
}

/**
 * Menghitung jeda tunggu bertambah (exponential backoff) sebelum item gagal dicoba ulang.
 * - attempts = 0 -> 0 ms
 * - attempts = 1 (percobaan ulang ke-1) -> baseDelayMs * 1
 * - attempts = 2 (percobaan ulang ke-2) -> baseDelayMs * 2
 */
export function getRetryDelayMs(
  attempts: number,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS
): number {
  if (attempts <= 0 || baseDelayMs <= 0) return 0;
  return baseDelayMs * Math.pow(2, attempts - 1);
}

/**
 * Memeriksa apakah objek raw berasal dari dry-run / demo.
 */
export function isDryRunRaw(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>).dry_run === true;
}

/**
 * Mengekstrak jumlah panggilan SerpApi dari kolom raw pada tabel checks.
 * Menghitung panggilan ke-2 (page_token) sebagai 2 panggilan.
 * Jika includeDryRun = false (bawaan untuk batas laju per jam), panggilan dari dry-run bernilai 0.
 */
export function extractSerpApiCallsFromRaw(
  raw: unknown,
  options: { includeDryRun?: boolean } = {}
): number {
  const includeDryRun = options.includeDryRun ?? false;
  if (!raw || typeof raw !== "object") return 1;
  const obj = raw as Record<string, unknown>;
  if (!includeDryRun && obj.dry_run === true) {
    return 0;
  }
  if (
    typeof obj.serpapi_calls_count === "number" &&
    Number.isInteger(obj.serpapi_calls_count) &&
    obj.serpapi_calls_count > 0
  ) {
    return obj.serpapi_calls_count;
  }
  if (obj.ai_overview_followup || obj.used_followup_page_token === true) {
    return 2;
  }
  return 1;
}

/**
 * Menyimpan di checks.raw hanya blok ai_overview dan metadata panggilan
 * agar ukuran database tetap hemat (< 500 MB) dan tidak menyimpan organic_results dll.
 */
export function compactSerpApiRawForStorage(
  raw: SerpApiRawResponse,
  serpApiCallsCount: number
): SerpApiRawResponse {
  const sanitized = sanitizeSerpApiRaw(raw);

  const aiOverviewBlock =
    sanitized.ai_overview && typeof sanitized.ai_overview === "object"
      ? sanitized.ai_overview
      : Array.isArray(sanitized.text_blocks) || Array.isArray(sanitized.references)
        ? {
            text_blocks: sanitized.text_blocks,
            references: sanitized.references,
          }
        : undefined;

  let compactMeta: Record<string, unknown> | undefined;
  if (sanitized.search_metadata && typeof sanitized.search_metadata === "object") {
    const m = sanitized.search_metadata as Record<string, unknown>;
    compactMeta = {};
    for (const key of [
      "id",
      "status",
      "created_at",
      "processed_at",
      "total_time_taken",
    ]) {
      if (m[key] !== undefined) {
        compactMeta[key] = m[key];
      }
    }
    if (Object.keys(compactMeta).length === 0) {
      compactMeta = undefined;
    }
  }

  const compact: SerpApiRawResponse = {
    ...(aiOverviewBlock ? { ai_overview: aiOverviewBlock } : {}),
    ...(compactMeta ? { search_metadata: compactMeta } : {}),
    serpapi_calls_count: serpApiCallsCount,
    ...(sanitized.ai_overview_followup ||
    sanitized.used_followup_page_token === true
      ? { used_followup_page_token: true }
      : {}),
    ...(sanitized.dry_run === true ? { dry_run: true } : {}),
    ...(sanitized.demo_seed === true ? { demo_seed: true } : {}),
    ...(typeof sanitized.week_label === "string"
      ? { week_label: sanitized.week_label }
      : {}),
    ...(sanitized.third_party_check &&
    typeof sanitized.third_party_check === "object"
      ? { third_party_check: sanitized.third_party_check }
      : {}),
  };

  return compact;
}

/**
 * Mengekstrak catatan panggilan SerpApi yang gagal dari pesan error run_items (format "[serpapi_calls=N]").
 */
export function extractFailedCallsFromError(errorText: string | null): number {
  if (!errorText) return 0;
  const match = errorText.match(/\[serpapi_calls=(\d+)\]/);
  return match ? Number(match[1]) : 0;
}

export function createSupabaseQueueStore(supabase: SupabaseClient): QueueStore {
  return {
    async getRunningCheckRun(): Promise<CheckRunRecord | null> {
      const { data, error } = await supabase
        .from("check_runs")
        .select("*")
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1);

      if (error) {
        throw new Error(`Gagal memeriksa check_runs aktif: ${error.message}`);
      }
      if (!data || data.length === 0) return null;
      return data[0] as CheckRunRecord;
    },

    async getActiveKeywords(): Promise<KeywordRecord[]> {
      const withDemoRes = await supabase
        .from("keywords")
        .select("id, text, active, is_demo")
        .eq("active", true)
        .order("created_at", { ascending: true });

      if (!withDemoRes.error && withDemoRes.data) {
        return withDemoRes.data as KeywordRecord[];
      }

      const { data, error } = await supabase
        .from("keywords")
        .select("id, text, active")
        .eq("active", true)
        .order("created_at", { ascending: true });
      if (error) {
        throw new Error(`Gagal membaca keywords aktif: ${error.message}`);
      }
      return ((data ?? []) as KeywordRecord[]).map((kw) => ({
        ...kw,
        is_demo: isKnownDemoKeywordText(kw.text),
      }));
    },

    async createCheckRun(
      total: number,
      nowIso: string,
      isDemo: boolean = false
    ): Promise<CheckRunRecord> {
      const initialStatus: CheckRunStatus = total === 0 ? "done" : "running";
      const insertWithDemo = await supabase
        .from("check_runs")
        .insert({
          started_at: nowIso,
          finished_at: total === 0 ? nowIso : null,
          status: initialStatus,
          total,
          done: 0,
          is_demo: isDemo,
        })
        .select("*")
        .single();

      if (!insertWithDemo.error && insertWithDemo.data) {
        return insertWithDemo.data as CheckRunRecord;
      }

      // Fallback apabila kolom is_demo belum diterapkan di database
      const { data, error } = await supabase
        .from("check_runs")
        .insert({
          started_at: nowIso,
          finished_at: total === 0 ? nowIso : null,
          status: initialStatus,
          total,
          done: 0,
        })
        .select("*")
        .single();

      if (error || !data) {
        throw new Error(
          `Gagal membuat check_runs: ${error?.message ?? "unknown"}`
        );
      }
      return { ...(data as CheckRunRecord), is_demo: isDemo };
    },

    async insertRunItems(
      runId: string,
      keywordIds: string[],
      nowIso: string
    ): Promise<void> {
      if (keywordIds.length === 0) return;
      const rows = keywordIds.map((keyword_id) => ({
        run_id: runId,
        keyword_id,
        state: "pending" as const,
        attempts: 0,
        updated_at: nowIso,
      }));
      const { error } = await supabase.from("run_items").insert(rows);
      if (error) {
        throw new Error(`Gagal membuat run_items: ${error.message}`);
      }
    },

    async recoverStuckProcessingItems(
      cutoffIso: string,
      nowIso: string
    ): Promise<string[]> {
      const { data, error } = await supabase
        .from("run_items")
        .update({
          state: "pending",
          updated_at: nowIso,
        })
        .eq("state", "processing")
        .lt("updated_at", cutoffIso)
        .select("id");

      if (error) {
        throw new Error(
          `Gagal memulihkan run_items yang macet: ${error.message}`
        );
      }
      return (data ?? []).map((r: { id: string }) => r.id);
    },

    async getHourlySerpApiCalls(sinceIso: string): Promise<number> {
      const { data: checksData, error: checksError } = await supabase
        .from("checks")
        .select("raw, run_id, check_runs(is_demo)")
        .gte("checked_at", sinceIso);

      if (checksError) {
        // Fallback jika kolom is_demo belum ada di check_runs
        const fallback = await supabase
          .from("checks")
          .select("raw")
          .gte("checked_at", sinceIso);
        if (fallback.error) {
          throw new Error(
            `Gagal menghitung batas laju dari checks: ${fallback.error.message}`
          );
        }
        let fallbackCalls = 0;
        for (const row of fallback.data ?? []) {
          fallbackCalls += extractSerpApiCallsFromRaw(
            (row as { raw: unknown }).raw,
            { includeDryRun: false }
          );
        }
        return fallbackCalls;
      }

      let totalCalls = 0;
      for (const row of checksData ?? []) {
        const typedRow = row as unknown as {
          raw: unknown;
          check_runs?: { is_demo?: boolean } | Array<{ is_demo?: boolean }>;
        };
        const runObj = Array.isArray(typedRow.check_runs)
          ? typedRow.check_runs[0]
          : typedRow.check_runs;
        if (runObj?.is_demo === true) {
          continue;
        }
        totalCalls += extractSerpApiCallsFromRaw(typedRow.raw, {
          includeDryRun: false,
        });
      }

      // Hitung juga panggilan SerpApi pada run_items yang gagal dalam 60 menit terakhir (bukan demo)
      const { data: failedItems, error: itemsError } = await supabase
        .from("run_items")
        .select("error")
        .gt("attempts", 0)
        .neq("state", "done")
        .gte("updated_at", sinceIso);

      if (!itemsError && failedItems) {
        for (const item of failedItems) {
          totalCalls += extractFailedCallsFromError(
            (item as { error: string | null }).error
          );
        }
      }

      return totalCalls;
    },

    async listPendingCandidates(limit: number): Promise<RunItemRecord[]> {
      const withDemoRes = await supabase
        .from("run_items")
        .select(
          "id, run_id, keyword_id, state, attempts, error, updated_at, check_runs(is_demo)"
        )
        .eq("state", "pending")
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (!withDemoRes.error && withDemoRes.data) {
        return withDemoRes.data.map((row) => {
          const typed = row as unknown as RunItemRecord & {
            check_runs?: { is_demo?: boolean } | Array<{ is_demo?: boolean }>;
          };
          const runObj = Array.isArray(typed.check_runs)
            ? typed.check_runs[0]
            : typed.check_runs;
          return {
            id: typed.id,
            run_id: typed.run_id,
            keyword_id: typed.keyword_id,
            state: typed.state,
            attempts: typed.attempts,
            error: typed.error,
            updated_at: typed.updated_at,
            run_is_demo: Boolean(runObj?.is_demo),
          };
        });
      }

      const { data, error } = await supabase
        .from("run_items")
        .select("id, run_id, keyword_id, state, attempts, error, updated_at")
        .eq("state", "pending")
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Gagal mengambil kandidat pending: ${error.message}`);
      }
      return (data ?? []) as RunItemRecord[];
    },

    async claimPendingItemAtomically(
      itemId: string,
      nowIso: string
    ): Promise<RunItemRecord | null> {
      const { data, error } = await supabase
        .from("run_items")
        .update({
          state: "processing",
          updated_at: nowIso,
        })
        .eq("id", itemId)
        .eq("state", "pending")
        .select("id, run_id, keyword_id, state, attempts, error, updated_at");

      if (error) {
        throw new Error(`Gagal mengklaim run_item ${itemId}: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return null;
      }
      return data[0] as RunItemRecord;
    },

    async getKeywordById(keywordId: string): Promise<KeywordRecord | null> {
      const { data, error } = await supabase
        .from("keywords")
        .select("id, text, active")
        .eq("id", keywordId)
        .maybeSingle();

      if (error) {
        throw new Error(`Gagal membaca keyword ${keywordId}: ${error.message}`);
      }
      return (data as KeywordRecord | null) ?? null;
    },

    async getDetectionContext() {
      const [{ data: termsData }, { data: compData }, settingsRes] =
        await Promise.all([
          supabase.from("brand_terms").select("term, enabled"),
          supabase.from("competitors").select("domain"),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "search_config")
            .maybeSingle(),
        ]);

      const brandTerms: BrandTermConfig[] =
        termsData && termsData.length > 0
          ? (termsData as BrandTermConfig[])
          : DEFAULT_BRAND_TERMS;

      const competitorDomains: string[] = (compData ?? []).map(
        (c: { domain: string }) => c.domain
      );

      const enableThirdPartyCheck = Boolean(
        !settingsRes.error &&
          (
            settingsRes.data?.value as
              | { enable_third_party_check?: boolean }
              | undefined
          )?.enable_third_party_check === true
      );

      return {
        brandTerms,
        competitorDomains,
        enableThirdPartyCheck,
        pageCacheStore: createSupabasePageCacheStore(supabase),
      };
    },

    async saveCheckAndSources(payload: CheckInsertPayload): Promise<string> {
      const sanitizedRaw = compactSerpApiRawForStorage(
        payload.raw,
        payload.serpapi_callsCount
      );

      const { data: checkRow, error: checkError } = await supabase
        .from("checks")
        .insert({
          run_id: payload.run_id,
          keyword_id: payload.keyword_id,
          checked_at: payload.checked_at,
          status: payload.status,
          answer_text: payload.answer_text || null,
          detected_domain: payload.detected_domain,
          detected_text: payload.detected_text,
          detected_third_party: payload.detected_third_party,
          raw: sanitizedRaw,
        })
        .select("id")
        .single();

      if (checkError || !checkRow) {
        throw new Error(
          `Gagal menyimpan hasil ke tabel checks: ${checkError?.message ?? "unknown"}`
        );
      }

      const checkId = (checkRow as { id: string }).id;

      if (payload.sources.length > 0) {
        const sourceRows = payload.sources.map((src, idx) => ({
          check_id: checkId,
          position: typeof src.position === "number" ? src.position : idx,
          title: src.title || null,
          url: src.url,
          domain: src.domain,
          is_own: src.is_own,
          is_competitor: src.is_competitor,
          mentions_brand: src.mentions_brand,
        }));

        const { error: sourcesError } = await supabase
          .from("check_sources")
          .insert(sourceRows);

        if (sourcesError) {
          throw new Error(
            `Gagal menyimpan check_sources: ${sourcesError.message}`
          );
        }
      }

      return checkId;
    },

    async markRunItemDone(itemId: string, nowIso: string): Promise<void> {
      const { error } = await supabase
        .from("run_items")
        .update({
          state: "done",
          error: null,
          updated_at: nowIso,
        })
        .eq("id", itemId);

      if (error) {
        throw new Error(`Gagal menandai run_item done: ${error.message}`);
      }
    },

    async markRunItemFailedAttempt(
      itemId: string,
      nextState: "pending" | "error",
      attempts: number,
      errorMessage: string,
      callsUsedInAttempt: number,
      nowIso: string
    ): Promise<void> {
      const prevCallsMatch = errorMessage.match(/\[serpapi_calls=(\d+)\]/);
      const totalFailedCalls =
        (prevCallsMatch ? Number(prevCallsMatch[1]) : 0) + callsUsedInAttempt;
      const cleanMessage = errorMessage.replace(/\s*\[serpapi_calls=\d+\]/g, "");
      const annotatedError =
        totalFailedCalls > 0
          ? `${cleanMessage} [serpapi_calls=${totalFailedCalls}]`
          : cleanMessage;

      const { error } = await supabase
        .from("run_items")
        .update({
          state: nextState,
          attempts,
          error: annotatedError,
          updated_at: nowIso,
        })
        .eq("id", itemId);

      if (error) {
        throw new Error(`Gagal memperbarui kegagalan run_item: ${error.message}`);
      }
    },

    async syncRunProgress(
      runId: string,
      nowIso: string,
      forceIsDemo?: boolean
    ): Promise<RunSummary> {
      const { data: items, error: itemsErr } = await supabase
        .from("run_items")
        .select("state, error")
        .eq("run_id", runId);

      if (itemsErr) {
        throw new Error(
          `Gagal membaca progres run_items untuk run ${runId}: ${itemsErr.message}`
        );
      }

      const list = (items ?? []) as Array<{
        state: RunItemState;
        error: string | null;
      }>;
      const total = list.length;
      const done = list.filter((i) => i.state === "done").length;
      const errors = list.filter((i) => i.state === "error").length;
      const pending = list.filter(
        (i) => i.state === "pending" || i.state === "processing"
      ).length;

      const { data: runChecks } = await supabase
        .from("checks")
        .select("raw")
        .eq("run_id", runId);

      let serpApiCalls = 0;
      let hasDryRunCheck = false;
      for (const c of runChecks ?? []) {
        const rawObj = (c as { raw: unknown }).raw;
        if (isDryRunRaw(rawObj)) {
          hasDryRunCheck = true;
        }
        serpApiCalls += extractSerpApiCallsFromRaw(rawObj, {
          includeDryRun: true,
        });
      }
      for (const item of list) {
        if (item.state !== "done") {
          serpApiCalls += extractFailedCallsFromError(item.error);
        }
      }

      const isFinished = pending === 0;
      const status: CheckRunStatus = !isFinished
        ? "running"
        : total > 0 && errors === total
          ? "failed"
          : "done";

      const isDemo = Boolean(forceIsDemo || hasDryRunCheck);

      const updateWithDemo = await supabase
        .from("check_runs")
        .update({
          total,
          done,
          status,
          finished_at: isFinished ? nowIso : null,
          is_demo: isDemo,
        })
        .eq("id", runId);

      if (updateWithDemo.error) {
        await supabase
          .from("check_runs")
          .update({
            total,
            done,
            status,
            finished_at: isFinished ? nowIso : null,
          })
          .eq("id", runId);
      }

      return {
        runId,
        status,
        total,
        done,
        errors,
        pending,
        serpApiCalls,
        isDemo,
      };
    },
  };
}

export interface StartRunOptions {
  isDemo?: boolean;
}

export interface StartRunResult {
  runId: string;
  total: number;
  status: CheckRunStatus;
  isExisting: boolean;
  isDemo: boolean;
}

/**
 * Membuat satu baris check_runs dan satu run_items untuk setiap keyword aktif.
 * Bersifat idempoten: jika sudah ada run berstatus 'running', kembalikan run tersebut tanpa membuat baru.
 */
export async function startCheckRun(
  store: QueueStore,
  now: Date = new Date(),
  options: StartRunOptions = {}
): Promise<StartRunResult> {
  const existingRun = await store.getRunningCheckRun();
  if (existingRun) {
    return {
      runId: existingRun.id,
      total: existingRun.total,
      status: existingRun.status,
      isExisting: true,
      isDemo: Boolean(existingRun.is_demo),
    };
  }

  const isDemo =
    options.isDemo ??
    (process.env.SERPAPI_DRY_RUN === "true" ||
      process.env.SERPAPI_DRY_RUN === "1");

  const nowIso = now.toISOString();
  const allActiveKeywords = await store.getActiveKeywords();
  // Saat SERPAPI_DRY_RUN=false (isDemo === false), abaikan keyword dengan is_demo = true
  const activeKeywords = isDemo
    ? allActiveKeywords
    : allActiveKeywords.filter((k) => !k.is_demo);
  const run = await store.createCheckRun(activeKeywords.length, nowIso, isDemo);

  if (activeKeywords.length > 0) {
    await store.insertRunItems(
      run.id,
      activeKeywords.map((k) => k.id),
      nowIso
    );
  }

  return {
    runId: run.id,
    total: activeKeywords.length,
    status: run.status,
    isExisting: false,
    isDemo: Boolean(run.is_demo ?? isDemo),
  };
}

export type ProcessStoppedReason =
  | "queue_empty"
  | "rate_limit"
  | "time_limit"
  | "max_items";

export interface ProcessQueueOptions {
  maxPerHour?: number;
  maxItems?: number;
  maxDurationMs?: number;
  retryBaseDelayMs?: number;
  brandDomain?: string;
  dryRun?: boolean;
  enableThirdPartyCheck?: boolean;
  pageCacheStore?: PageCacheStore;
  nowFn?: () => Date;
  serpApiFetcher?: (
    keyword: string,
    options: { dryRun?: boolean }
  ) => Promise<SerpApiCheckResult>;
}

export interface ProcessQueueResult {
  recoveredCount: number;
  processedCount: number;
  succeededCount: number;
  retriedCount: number;
  failedCount: number;
  serpApiCallsUsedInBatch: number;
  hourlySerpApiCallsUsed: number;
  maxPerHour: number;
  stoppedReason: ProcessStoppedReason;
  runsSummary: RunSummary[];
}

/**
 * Memproses item antrean dengan:
 * 1. Pemulihan item macet (> 10 menit di state processing)
 * 2. Kepatuhan penuh terhadap batas laju SERPAPI_MAX_PER_HOUR (hanya menghitung panggilan non-dry-run)
 * 3. Klaim item pending secara atomik
 * 4. Percobaan ulang maksimal 2 kali dengan jeda bertambah sebelum ditandai error
 * 5. Satu item gagal tidak menghentikan run
 */
export async function processQueue(
  store: QueueStore,
  options: ProcessQueueOptions = {}
): Promise<ProcessQueueResult> {
  const nowFn = options.nowFn ?? (() => new Date());
  const startTimeMs = nowFn().getTime();

  const isDryRunMode =
    options.dryRun ??
    (!options.serpApiFetcher &&
      (process.env.SERPAPI_DRY_RUN === "true" ||
        process.env.SERPAPI_DRY_RUN === "1"));

  const maxPerHour =
    options.maxPerHour ??
    (Number(process.env.SERPAPI_MAX_PER_HOUR) > 0
      ? Number(process.env.SERPAPI_MAX_PER_HOUR)
      : 50);
  const maxItems = options.maxItems ?? 50;
  const maxDurationMs = options.maxDurationMs ?? 50_000;
  const retryBaseDelayMs =
    options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const brandDomain =
    options.brandDomain ?? process.env.BRAND_DOMAIN ?? "linovhr.com";
  const fetcher =
    options.serpApiFetcher ??
    ((kw: string, opts: { dryRun?: boolean }) =>
      fetchKeywordAiOverview(kw, { dryRun: opts.dryRun }));

  // 1. Pulihkan item yang macet di state processing lebih dari 10 menit
  const currentNow = nowFn();
  const stuckCutoffIso = new Date(
    currentNow.getTime() - STUCK_PROCESSING_TIMEOUT_MS
  ).toISOString();
  const recoveredIds = await store.recoverStuckProcessingItems(
    stuckCutoffIso,
    currentNow.toISOString()
  );

  // 2. Hitung panggilan SerpApi nyata (non-dry-run) dalam 60 menit terakhir dari database
  const oneHourAgoIso = new Date(
    currentNow.getTime() - RATE_LIMIT_WINDOW_MS
  ).toISOString();
  let hourlySerpApiCallsUsed = await store.getHourlySerpApiCalls(oneHourAgoIso);

  if (!isDryRunMode && hourlySerpApiCallsUsed >= maxPerHour) {
    return {
      recoveredCount: recoveredIds.length,
      processedCount: 0,
      succeededCount: 0,
      retriedCount: 0,
      failedCount: 0,
      serpApiCallsUsedInBatch: 0,
      hourlySerpApiCallsUsed,
      maxPerHour,
      stoppedReason: "rate_limit",
      runsSummary: [],
    };
  }

  const {
    brandTerms,
    competitorDomains,
    enableThirdPartyCheck: ctxThirdParty,
    pageCacheStore: ctxCacheStore,
  } = await store.getDetectionContext();

  const shouldCheckThirdParty =
    options.enableThirdPartyCheck ?? Boolean(ctxThirdParty);
  const activeCacheStore = options.pageCacheStore ?? ctxCacheStore;

  let processedCount = 0;
  let succeededCount = 0;
  let retriedCount = 0;
  let failedCount = 0;
  let serpApiCallsUsedInBatch = 0;
  let stoppedReason: ProcessStoppedReason = "queue_empty";
  const touchedRunIds = new Set<string>();

  while (processedCount < maxItems) {
    const loopNow = nowFn();
    if (loopNow.getTime() - startTimeMs >= maxDurationMs) {
      stoppedReason = "time_limit";
      break;
    }

    if (!isDryRunMode) {
      const latestHourlyCalls = await store.getHourlySerpApiCalls(oneHourAgoIso);
      hourlySerpApiCallsUsed = Math.max(
        hourlySerpApiCallsUsed,
        latestHourlyCalls
      );
      if (hourlySerpApiCallsUsed >= maxPerHour) {
        stoppedReason = "rate_limit";
        break;
      }
    }

    const candidates = await store.listPendingCandidates(20);
    const eligibleCandidate = candidates.find((item) => {
      // Saat SERPAPI_DRY_RUN=false (!isDryRunMode), jangan memproses item dari run is_demo = true
      if (!isDryRunMode && item.run_is_demo === true) {
        return false;
      }
      if (item.attempts <= 0) return true;
      const delayMs = getRetryDelayMs(item.attempts, retryBaseDelayMs);
      const updatedMs = Date.parse(item.updated_at);
      if (Number.isNaN(updatedMs)) return true;
      return loopNow.getTime() - updatedMs >= delayMs;
    });

    if (!eligibleCandidate) {
      stoppedReason = "queue_empty";
      break;
    }

    // Klaim secara atomik
    const claimed = await store.claimPendingItemAtomically(
      eligibleCandidate.id,
      loopNow.toISOString()
    );

    if (!claimed) {
      continue;
    }

    touchedRunIds.add(claimed.run_id);
    processedCount++;

    try {
      const keyword = await store.getKeywordById(claimed.keyword_id);
      if (!keyword) {
        throw new Error(`Keyword ${claimed.keyword_id} tidak ditemukan.`);
      }

      const serpResult = await fetcher(keyword.text, {
        dryRun: options.dryRun,
      });

      const callsUsed = serpResult.apiCallsCount;
      const itemIsDryRun =
        Boolean(options.dryRun) || isDryRunRaw(serpResult.raw);

      serpApiCallsUsedInBatch += callsUsed;
      if (!itemIsDryRun) {
        hourlySerpApiCallsUsed += callsUsed;
      }

      const baseEvaluation = evaluateAiOverviewDetection(serpResult.parsed, {
        brandDomain,
        brandTerms,
        competitorDomains,
      });

      const evaluation =
        shouldCheckThirdParty && serpResult.parsed.hasAiOverview
          ? await evaluateThirdPartySourcesForCheck(
              {
                hasAiOverview: serpResult.parsed.hasAiOverview,
                detected_domain: baseEvaluation.detected_domain,
                detected_text: baseEvaluation.detected_text,
                sources: baseEvaluation.sources,
              },
              {
                brandDomain,
                brandTerms,
                cacheStore: activeCacheStore,
                dryRun: itemIsDryRun,
                nowFn,
              }
            )
          : baseEvaluation;

      const rawWithThirdPartyStats =
        "thirdPartyStats" in evaluation && evaluation.thirdPartyStats
          ? {
              ...serpResult.raw,
              third_party_check: evaluation.thirdPartyStats,
            }
          : serpResult.raw;

      const doneIso = nowFn().toISOString();
      await store.saveCheckAndSources({
        run_id: claimed.run_id,
        keyword_id: claimed.keyword_id,
        checked_at: doneIso,
        status: evaluation.status,
        answer_text: serpResult.parsed.answerText,
        detected_domain: evaluation.detected_domain,
        detected_text: evaluation.detected_text,
        detected_third_party: evaluation.detected_third_party,
        raw: rawWithThirdPartyStats,
        serpapi_callsCount: callsUsed,
        sources: evaluation.sources,
      });

      await store.markRunItemDone(claimed.id, doneIso);
      succeededCount++;
    } catch (err) {
      const nextAttempts = claimed.attempts + 1;
      const nextState: "pending" | "error" =
        nextAttempts <= MAX_RETRIES ? "pending" : "error";
      const errMsg = err instanceof Error ? err.message : String(err);

      const callsUsedOnError =
        !isDryRunMode && /SerpApi/i.test(errMsg) ? 1 : 0;
      serpApiCallsUsedInBatch += callsUsedOnError;
      hourlySerpApiCallsUsed += callsUsedOnError;

      await store.markRunItemFailedAttempt(
        claimed.id,
        nextState,
        nextAttempts,
        errMsg,
        callsUsedOnError,
        nowFn().toISOString()
      );

      if (nextState === "pending") {
        retriedCount++;
      } else {
        failedCount++;
      }
    }

    if (processedCount >= maxItems) {
      stoppedReason = "max_items";
      break;
    }

    if (!isDryRunMode) {
      const latestHourlyCalls = await store.getHourlySerpApiCalls(oneHourAgoIso);
      hourlySerpApiCallsUsed = Math.max(
        hourlySerpApiCallsUsed,
        latestHourlyCalls
      );
      if (hourlySerpApiCallsUsed >= maxPerHour) {
        stoppedReason = "rate_limit";
        break;
      }
    }
  }

  const runsSummary: RunSummary[] = [];
  for (const runId of touchedRunIds) {
    const summary = await store.syncRunProgress(
      runId,
      nowFn().toISOString(),
      isDryRunMode ? true : undefined
    );
    runsSummary.push(summary);
  }

  return {
    recoveredCount: recoveredIds.length,
    processedCount,
    succeededCount,
    retriedCount,
    failedCount,
    serpApiCallsUsedInBatch,
    hourlySerpApiCallsUsed,
    maxPerHour,
    stoppedReason,
    runsSummary,
  };
}

/**
 * Mengosongkan kolom checks.raw yang lebih tua dari retentionDays (bawaan 90 hari)
 * untuk menjaga pemakaian ruang penyimpanan database.
 */
export async function cleanupExpiredRawPayloads(
  supabase: SupabaseClient,
  retentionDays: number = 90,
  now: Date = new Date()
): Promise<number> {
  const cutoffIso = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("checks")
    .update({ raw: null })
    .lt("checked_at", cutoffIso)
    .not("raw", "is", null)
    .select("id");

  if (error) {
    throw new Error(`Gagal membersihkan checks.raw lama: ${error.message}`);
  }

  return (data ?? []).length;
}

