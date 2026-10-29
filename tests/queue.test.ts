import { describe, it, expect } from "vitest";
import {
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
import { POST as processPost } from "@/app/api/cron/process/route";
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
    async getActiveKeywords() {
      return keywords.filter((k) => k.active);
    },
    async createCheckRun(total, nowIso) {
      const run: CheckRunRecord = {
        id: `run-${runs.length + 1}`,
        started_at: nowIso,
        finished_at: total === 0 ? nowIso : null,
        status: total === 0 ? "done" : "running",
        total,
        done: 0,
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
        (acc, c) => acc + c.serpapi_callsCount,
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
      const target = items.find((i) => i.id === itemId && i.state === "pending");
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
    async syncRunProgress(runId, nowIso): Promise<RunSummary> {
      const runItems = items.filter((i) => i.run_id === runId);
      const total = runItems.length;
      const done = runItems.filter((i) => i.state === "done").length;
      const errors = runItems.filter((i) => i.state === "error").length;
      const pending = runItems.filter(
        (i) => i.state === "pending" || i.state === "processing"
      ).length;
      const serpApiCalls = checks
        .filter((c) => c.run_id === runId)
        .reduce((sum, c) => sum + c.serpapi_callsCount, 0);

      const status =
        pending > 0
          ? "running"
          : total > 0 && errors === total
            ? "failed"
            : "done";

      const run = runs.find((r) => r.id === runId);
      if (run) {
        run.done = done;
        run.status = status;
        run.finished_at = pending === 0 ? nowIso : null;
        run.serpapi_calls = serpApiCalls;
      }

      return {
        runId,
        status,
        total,
        done,
        errors,
        pending,
        serpApiCalls,
      };
    },
  };

  return { store, runs, items, checks };
}

function makeFakeSerpResult(apiCallsCount: 1 | 2 = 1): SerpApiCheckResult {
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
    raw: { serpapi_calls_count: apiCallsCount },
    firstRaw: {},
    secondRaw: apiCallsCount === 2 ? {} : null,
    usedFollowUpPageToken: apiCallsCount === 2,
    apiCallsCount,
  };
}

describe("Fase 3: Antrean, Klaim Atomik, Batas Laju, Percobaan Ulang, & Cron Auth", () => {
  it("mengklaim item pending secara atomik sehingga dua pekerja paralel tidak memproses item yang sama", async () => {
    const { store, items } = createInMemoryQueueStore();
    await startCheckRun(store, new Date("2026-10-29T08:00:00Z"));

    const processedKeywords: string[] = [];
    const slowFetcher = async (kw: string) => {
      await new Promise((r) => setTimeout(r, 15));
      processedKeywords.push(kw);
      return makeFakeSerpResult(1);
    };

    const [worker1, worker2] = await Promise.all([
      processQueue(store, { serpApiFetcher: slowFetcher }),
      processQueue(store, { serpApiFetcher: slowFetcher }),
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
    ).toISOString(); // 12 menit lalu (> 10 menit)
    const recentTimeIso = new Date(
      baseTime.getTime() - 3 * 60 * 1000
    ).toISOString(); // 3 menit lalu (< 10 menit)

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
      nowFn: () => baseTime,
      serpApiFetcher: async () => makeFakeSerpResult(1),
    });

    expect(result.recoveredCount).toBe(1);
    expect(result.processedCount).toBe(1);
    expect(items.find((i) => i.id === "item-stuck")?.state).toBe("done");
    expect(items.find((i) => i.id === "item-recent")?.state).toBe("processing");
  });

  it("mematuhi batas laju SERPAPI_MAX_PER_HOUR termasuk menghitung 2 panggilan untuk kasus page_token", async () => {
    const { store, items } = createInMemoryQueueStore({
      hourlyCalls: 48, // Sudah terpakai 48 dari 50 dalam 60 menit terakhir
    });
    await startCheckRun(store, new Date("2026-10-29T09:00:00Z"));

    // Item pertama membutuhkan panggilan kedua page_token (2 panggilan SerpApi -> 48 + 2 = 50)
    const result = await processQueue(store, {
      maxPerHour: 50,
      serpApiFetcher: async () => makeFakeSerpResult(2),
    });

    expect(result.processedCount).toBe(1);
    expect(result.serpApiCallsUsedInBatch).toBe(2);
    expect(result.hourlySerpApiCallsUsed).toBe(50);
    expect(result.stoppedReason).toBe("rate_limit");

    // 1 item selesai, 2 item lainnya tetap pending
    expect(items.filter((i) => i.state === "done")).toHaveLength(1);
    expect(items.filter((i) => i.state === "pending")).toHaveLength(2);
    expect(extractSerpApiCallsFromRaw({ serpapi_calls_count: 2 })).toBe(2);
  });

  it("mengulangi item gagal maksimal 2 kali dengan jeda bertambah lalu menandai error tanpa menghentikan run", async () => {
    let currentClock = new Date("2026-10-29T10:00:00Z");
    const { store, items } = createInMemoryQueueStore({
      keywords: [
        { id: "kw-fail", text: "keyword selalu gagal", active: true },
        { id: "kw-ok", text: "keyword berhasil", active: true },
      ],
    });
    await startCheckRun(store, currentClock);

    const fetcher = async (kw: string) => {
      if (kw === "keyword selalu gagal") {
        throw new Error("SerpApi timeout sementara");
      }
      return makeFakeSerpResult(1);
    };

    // Run 1: kw-fail gagal ke-1 (attempts=1, kembali ke pending), kw-ok tetap berhasil (done)
    const res1 = await processQueue(store, {
      nowFn: () => currentClock,
      retryBaseDelayMs: 15_000,
      serpApiFetcher: fetcher,
    });
    expect(res1.succeededCount).toBe(1);
    expect(res1.retriedCount).toBe(1);
    const failItem = items.find((i) => i.keyword_id === "kw-fail")!;
    expect(failItem.state).toBe("pending");
    expect(failItem.attempts).toBe(1);

    // Jika dipanggil sebelum jeda 15 detik berlalu, item belum diambil
    currentClock = new Date(currentClock.getTime() + 5_000);
    const resTooEarly = await processQueue(store, {
      nowFn: () => currentClock,
      retryBaseDelayMs: 15_000,
      serpApiFetcher: fetcher,
    });
    expect(resTooEarly.processedCount).toBe(0);

    // Run 2 (setelah 16 detik): percobaan ulang ke-1 gagal -> attempts=2, state=pending, jeda berikutnya 30 detik
    currentClock = new Date(currentClock.getTime() + 15_000);
    const res2 = await processQueue(store, {
      nowFn: () => currentClock,
      retryBaseDelayMs: 15_000,
      serpApiFetcher: fetcher,
    });
    expect(res2.retriedCount).toBe(1);
    expect(failItem.state).toBe("pending");
    expect(failItem.attempts).toBe(2);
    expect(getRetryDelayMs(2, 15_000)).toBe(30_000);

    // Run 3 (setelah 31 detik): percobaan ulang ke-2 gagal -> attempts=3 (> MAX_RETRIES=2), state=error
    currentClock = new Date(currentClock.getTime() + 31_000);
    const res3 = await processQueue(store, {
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

  it("mengembalikan HTTP 401 pada POST /api/cron/start-run dan POST /api/cron/process jika tanpa header Authorization", async () => {
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
});
