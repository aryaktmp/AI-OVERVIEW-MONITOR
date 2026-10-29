import { describe, it, expect } from "vitest";
import {
  compactSerpApiRawForStorage,
  extractSerpApiCallsFromRaw,
  getRetryDelayMs,
  processQueue,
  startCheckRun,
  type CheckInsertPayload,
  type CheckRunRecord,
  type KeywordRecord,
  type QueueStore,
  type RunItemRecord,
  type RunSummary,
} from "@/lib/queue";
import { DEFAULT_BRAND_TERMS } from "@/lib/detect";
import { POST as startRunPost } from "@/app/api/cron/start-run/route";
import {
  POST as processPost,
  maxDuration as processMaxDuration,
} from "@/app/api/cron/process/route";
import type { SerpApiCheckResult } from "@/lib/serpapi";

function createInMemoryQueueStore(initial?: {
  keywords?: KeywordRecord[];
  items?: RunItemRecord[];
  hourlyCalls?: number;
}) {
  const keywords: KeywordRecord[] = initial?.keywords ?? [
    { id: "kw-1", text: "software hr terbaik", active: true },
    { id: "kw-2", text: "aplikasi payroll indonesia", active: true },
    { id: "kw-3", text: "linovhr", active: true },
  ];
  const runs: CheckRunRecord[] = [];
  const items: RunItemRecord[] = [...(initial?.items ?? [])];
  const checks: CheckInsertPayload[] = [];
  const baseHourlyCalls = initial?.hourlyCalls ?? 0;

  const store: QueueStore = {
    async getRunningCheckRun() {
      return runs.find((r) => r.status === "running") ?? null;
    },
    async getActiveKeywords() {
      return keywords.filter((k) => k.active);
    },
    async createCheckRun(total, nowIso, isDemo = false) {
      const run: CheckRunRecord = {
        id: `run-${runs.length + 1}`,
        started_at: nowIso,
        finished_at: total === 0 ? nowIso : null,
        status: total === 0 ? "done" : "running",
        total,
        done: 0,
        is_demo: isDemo,
        serpapi_calls: 0,
      };
      runs.push(run);
      return run;
    },
    async insertRunItems(runId, keywordIds, nowIso) {
      for (const kwId of keywordIds) {
        items.push({
          id: `item-${items.length + 1}`,
          run_id: runId,
          keyword_id: kwId,
          state: "pending",
          attempts: 0,
          error: null,
          updated_at: nowIso,
        });
      }
    },
    async recoverStuckProcessingItems(cutoffIso, nowIso) {
      const cutoffMs = Date.parse(cutoffIso);
      const recoveredIds: string[] = [];
      for (const item of items) {
        if (
          item.state === "processing" &&
          Date.parse(item.updated_at) < cutoffMs
        ) {
          item.state = "pending";
          item.updated_at = nowIso;
          recoveredIds.push(item.id);
        }
      }
      return recoveredIds;
    },
    async getHourlySerpApiCalls() {
      const fromSavedChecks = checks.reduce(
        (acc, c) =>
          acc +
          extractSerpApiCallsFromRaw(c.raw, {
            includeDryRun: false,
          }),
        0
      );
      return baseHourlyCalls + fromSavedChecks;
    },
    async listPendingCandidates(limit) {
      return items
        .filter((i) => i.state === "pending")
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
        .slice(0, limit)
        .map((i) => ({ ...i }));
    },
    async claimPendingItemAtomically(itemId, nowIso) {
      const target = items.find(
        (i) => i.id === itemId && i.state === "pending"
      );
      if (!target) return null;
      target.state = "processing";
      target.updated_at = nowIso;
      return { ...target };
    },
    async getKeywordById(keywordId) {
      return keywords.find((k) => k.id === keywordId) ?? null;
    },
    async getDetectionContext() {
      return {
        brandTerms: DEFAULT_BRAND_TERMS,
        competitorDomains: ["gadjian.com"],
      };
    },
    async saveCheckAndSources(payload) {
      checks.push(payload);
      return `chk-${checks.length}`;
    },
    async markRunItemDone(itemId, nowIso) {
      const target = items.find((i) => i.id === itemId);
      if (target) {
        target.state = "done";
        target.error = null;
        target.updated_at = nowIso;
      }
    },
    async markRunItemFailedAttempt(
      itemId,
      nextState,
      attempts,
      errorMessage,
      _callsUsed,
      nowIso
    ) {
      const target = items.find((i) => i.id === itemId);
      if (target) {
        target.state = nextState;
        target.attempts = attempts;
        target.error = errorMessage;
        target.updated_at = nowIso;
      }
    },
    async syncRunProgress(
      runId,
      nowIso,
      forceIsDemo
    ): Promise<RunSummary> {
      const runItems = items.filter((i) => i.run_id === runId);
      const total = runItems.length;
      const done = runItems.filter((i) => i.state === "done").length;
      const errors = runItems.filter((i) => i.state === "error").length;
      const pending = runItems.filter(
        (i) => i.state === "pending" || i.state === "processing"
      ).length;
      const runChecks = checks.filter((c) => c.run_id === runId);
      const serpApiCalls = runChecks.reduce(
        (sum, c) =>
          sum + extractSerpApiCallsFromRaw(c.raw, { includeDryRun: true }),
        0
      );
      const hasDryRun = runChecks.some((c) => c.raw.dry_run === true);

      const status =
        pending > 0
          ? "running"
          : total > 0 && errors === total
            ? "failed"
            : "done";

      const run = runs.find((r) => r.id === runId);
      const isDemo = Boolean(forceIsDemo || run?.is_demo || hasDryRun);
      if (run) {
        run.done = done;
        run.status = status;
        run.finished_at = pending === 0 ? nowIso : null;
        run.serpapi_calls = serpApiCalls;
        run.is_demo = isDemo;
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

  return { store, runs, items, checks };
}

function makeFakeSerpResult(
  apiCallsCount: 1 | 2 = 1,
  dryRun = false
): SerpApiCheckResult {
  return {
    parsed: {
      hasAiOverview: true,
      answerText: "LinovHR adalah software HRIS di Indonesia.",
      sources: [
        {
          position: 0,
          title: "LinovHR",
          url: "https://www.linovhr.com/",
          domain: "www.linovhr.com",
        },
      ],
      pageToken: null,
    },
    raw: { serpapi_calls_count: apiCallsCount, dry_run: dryRun },
    firstRaw: {},
    secondRaw: apiCallsCount === 2 ? {} : null,
    usedFollowUpPageToken: apiCallsCount === 2,
    apiCallsCount,
  };
}

describe("Fase 3 & Perbaikan Bagian A: Antrean, Idempotensi, Batas Laju, & Cron", () => {
  it("memastikan startCheckRun bersifat idempoten saat sudah ada run berstatus running", async () => {
    const { store, runs, items } = createInMemoryQueueStore();

    const first = await startCheckRun(store, new Date("2026-10-29T08:00:00Z"), {
      isDemo: false,
    });
    expect(first.isExisting).toBe(false);
    expect(first.runId).toBe("run-1");
    expect(runs).toHaveLength(1);
    expect(items).toHaveLength(3);

    // Panggilan kedua saat run-1 masih berstatus running
    const second = await startCheckRun(
      store,
      new Date("2026-10-29T08:01:00Z"),
      { isDemo: false }
    );
    expect(second.isExisting).toBe(true);
    expect(second.runId).toBe("run-1");
    expect(runs).toHaveLength(1);
    expect(items).toHaveLength(3);
  });

  it("mengklaim item pending secara atomik sehingga dua pekerja paralel tidak memproses item yang sama", async () => {
    const { store, items } = createInMemoryQueueStore();
    await startCheckRun(store, new Date("2026-10-29T08:00:00Z"), {
      isDemo: false,
    });

    const processedKeywords: string[] = [];
    const slowFetcher = async (kw: string) => {
      await new Promise((r) => setTimeout(r, 15));
      processedKeywords.push(kw);
      return makeFakeSerpResult(1);
    };

    const [worker1, worker2] = await Promise.all([
      processQueue(store, { dryRun: false, serpApiFetcher: slowFetcher }),
      processQueue(store, { dryRun: false, serpApiFetcher: slowFetcher }),
    ]);

    expect(worker1.processedCount + worker2.processedCount).toBe(3);
    expect(processedKeywords).toHaveLength(3);
    expect(new Set(processedKeywords).size).toBe(3);
    expect(items.every((i) => i.state === "done")).toBe(true);
  });

  it("memulihkan item yang macet di state processing lebih dari 10 menit kembali ke pending", async () => {
    const baseTime = new Date("2026-10-29T09:00:00Z");
    const stuckTimeIso = new Date(
      baseTime.getTime() - 12 * 60 * 1000
    ).toISOString();
    const recentTimeIso = new Date(
      baseTime.getTime() - 3 * 60 * 1000
    ).toISOString();

    const { store, items } = createInMemoryQueueStore({
      items: [
        {
          id: "item-stuck",
          run_id: "run-1",
          keyword_id: "kw-1",
          state: "processing",
          attempts: 0,
          error: null,
          updated_at: stuckTimeIso,
        },
        {
          id: "item-recent",
          run_id: "run-1",
          keyword_id: "kw-2",
          state: "processing",
          attempts: 0,
          error: null,
          updated_at: recentTimeIso,
        },
      ],
    });

    const result = await processQueue(store, {
      dryRun: false,
      nowFn: () => baseTime,
      serpApiFetcher: async () => makeFakeSerpResult(1),
    });

    expect(result.recoveredCount).toBe(1);
    expect(result.processedCount).toBe(1);
    expect(items.find((i) => i.id === "item-stuck")?.state).toBe("done");
    expect(items.find((i) => i.id === "item-recent")?.state).toBe("processing");
  });

  it("mematuhi batas laju SERPAPI_MAX_PER_HOUR untuk panggilan nyata dan tidak menghitung panggilan dry-run", async () => {
    // 1. Pastikan dry-run tidak dihitung ke batas laju per jam
    expect(
      extractSerpApiCallsFromRaw(
        { serpapi_calls_count: 2, dry_run: true },
        { includeDryRun: false }
      )
    ).toBe(0);
    expect(
      extractSerpApiCallsFromRaw(
        { serpapi_calls_count: 2, dry_run: true },
        { includeDryRun: true }
      )
    ).toBe(2);

    const { store: dryStore, runs: dryRuns } = createInMemoryQueueStore({
      hourlyCalls: 49,
    });
    await startCheckRun(dryStore, new Date("2026-10-29T09:00:00Z"), {
      isDemo: true,
    });

    const dryResult = await processQueue(dryStore, {
      maxPerHour: 50,
      dryRun: true,
      serpApiFetcher: async () => makeFakeSerpResult(2, true),
    });
    expect(dryResult.processedCount).toBe(3);
    expect(dryResult.hourlySerpApiCallsUsed).toBe(49); // Tidak bertambah karena dry-run
    expect(dryRuns[0]?.is_demo).toBe(true);

    // 2. Pastikan panggilan nyata dihitung termasuk panggilan kedua page_token (48 + 2 = 50 -> berhenti)
    const { store, items } = createInMemoryQueueStore({
      hourlyCalls: 48,
    });
    await startCheckRun(store, new Date("2026-10-29T09:00:00Z"), {
      isDemo: false,
    });

    const result = await processQueue(store, {
      maxPerHour: 50,
      dryRun: false,
      serpApiFetcher: async () => makeFakeSerpResult(2, false),
    });

    expect(result.processedCount).toBe(1);
    expect(result.serpApiCallsUsedInBatch).toBe(2);
    expect(result.hourlySerpApiCallsUsed).toBe(50);
    expect(result.stoppedReason).toBe("rate_limit");
    expect(items.filter((i) => i.state === "done")).toHaveLength(1);
    expect(items.filter((i) => i.state === "pending")).toHaveLength(2);
  });

  it("mengulangi item gagal maksimal 2 kali dengan jeda bertambah lalu menandai error tanpa menghentikan run", async () => {
    let currentClock = new Date("2026-10-29T10:00:00Z");
    const { store, items } = createInMemoryQueueStore({
      keywords: [
        { id: "kw-fail", text: "keyword selalu gagal", active: true },
        { id: "kw-ok", text: "keyword berhasil", active: true },
      ],
    });
    await startCheckRun(store, currentClock, { isDemo: false });

    const fetcher = async (kw: string) => {
      if (kw === "keyword selalu gagal") {
        throw new Error("SerpApi timeout sementara");
      }
      return makeFakeSerpResult(1);
    };

    const res1 = await processQueue(store, {
      dryRun: false,
      nowFn: () => currentClock,
      retryBaseDelayMs: 15_000,
      serpApiFetcher: fetcher,
    });
    expect(res1.succeededCount).toBe(1);
    expect(res1.retriedCount).toBe(1);
    const failItem = items.find((i) => i.keyword_id === "kw-fail")!;
    expect(failItem.state).toBe("pending");
    expect(failItem.attempts).toBe(1);

    currentClock = new Date(currentClock.getTime() + 5_000);
    const resTooEarly = await processQueue(store, {
      dryRun: false,
      nowFn: () => currentClock,
      retryBaseDelayMs: 15_000,
      serpApiFetcher: fetcher,
    });
    expect(resTooEarly.processedCount).toBe(0);

    currentClock = new Date(currentClock.getTime() + 15_000);
    const res2 = await processQueue(store, {
      dryRun: false,
      nowFn: () => currentClock,
      retryBaseDelayMs: 15_000,
      serpApiFetcher: fetcher,
    });
    expect(res2.retriedCount).toBe(1);
    expect(failItem.state).toBe("pending");
    expect(failItem.attempts).toBe(2);
    expect(getRetryDelayMs(2, 15_000)).toBe(30_000);

    currentClock = new Date(currentClock.getTime() + 31_000);
    const res3 = await processQueue(store, {
      dryRun: false,
      nowFn: () => currentClock,
      retryBaseDelayMs: 15_000,
      serpApiFetcher: fetcher,
    });
    expect(res3.failedCount).toBe(1);
    expect(failItem.state).toBe("error");
    expect(failItem.attempts).toBe(3);
    expect(failItem.error).toContain("SerpApi timeout sementara");
    expect(res3.runsSummary[0]?.status).toBe("done");
  });

  it("mengekspor maxDuration pada /api/cron/process dan mengembalikan HTTP 401 jika tanpa header Authorization", async () => {
    expect(processMaxDuration).toBeGreaterThanOrEqual(30);
    process.env.CRON_SECRET = "a".repeat(32);

    const reqWithoutHeader1 = new Request(
      "http://localhost:3000/api/cron/start-run",
      { method: "POST" }
    );
    const res1 = await startRunPost(reqWithoutHeader1);
    expect(res1.status).toBe(401);

    const reqWithoutHeader2 = new Request(
      "http://localhost:3000/api/cron/process",
      { method: "POST" }
    );
    const res2 = await processPost(reqWithoutHeader2);
    expect(res2.status).toBe(401);

    const reqWrongToken = new Request(
      "http://localhost:3000/api/cron/process",
      {
        method: "POST",
        headers: { Authorization: "Bearer token-salah" },
      }
    );
    const res3 = await processPost(reqWrongToken);
    expect(res3.status).toBe(401);
  });

  it("mengabaikan keyword dengan is_demo = true saat SERPAPI_DRY_RUN=false (isDemo = false)", async () => {
    const { store, items } = createInMemoryQueueStore({
      keywords: [
        { id: "kw-demo-1", text: "software hr terbaik", active: true, is_demo: true },
        { id: "kw-demo-2", text: "aplikasi hris indonesia", active: true, is_demo: true },
        { id: "kw-real-1", text: "keyword produksi nyata", active: true, is_demo: false },
      ],
    });

    const realRun = await startCheckRun(store, new Date("2026-10-29T12:00:00Z"), {
      isDemo: false,
    });

    expect(realRun.total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.keyword_id).toBe("kw-real-1");
  });

  it("menyimpan di checks.raw hanya blok ai_overview dan metadata panggilan", () => {
    const fullRaw = {
      search_metadata: {
        id: "search-123",
        status: "Success",
        total_time_taken: 1.42,
        json_endpoint: "https://serpapi.com/searches/123?api_key=secret123",
      },
      search_parameters: {
        engine: "google",
        q: "software hr terbaik",
        api_key: "secret123",
      },
      organic_results: [{ position: 1, title: "Organic 1" }],
      related_questions: [{ question: "Apa itu HR?" }],
      ai_overview: {
        text_blocks: [{ type: "paragraph", snippet: "LinovHR adalah HRIS." }],
        references: [{ index: 1, title: "LinovHR", link: "https://linovhr.com" }],
      },
      ai_overview_followup: {
        text_blocks: [{ type: "paragraph", snippet: "LinovHR adalah HRIS." }],
      },
    };

    const compact = compactSerpApiRawForStorage(fullRaw, 2);

    expect(compact.ai_overview).toBeDefined();
    expect(compact.serpapi_calls_count).toBe(2);
    expect(compact.used_followup_page_token).toBe(true);
    expect(compact.search_metadata).toEqual({
      id: "search-123",
      status: "Success",
      total_time_taken: 1.42,
    });
    expect(compact.organic_results).toBeUndefined();
    expect(compact.related_questions).toBeUndefined();
    expect(compact.search_parameters).toBeUndefined();
    expect(compact.ai_overview_followup).toBeUndefined();
  });
});
