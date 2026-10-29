import { describe, expect, it, vi, afterEach } from "vitest";
import { isDryRun } from "@/lib/dry-run";
import { fetchKeywordAiOverview } from "@/lib/serpapi";
import {
  startCheckRun,
  processQueue,
  extractSerpApiCallsFromRaw,
  type QueueStore,
  type CheckRunRecord,
  type RunItemRecord,
  type CheckRunStatus,
  type RunSummary,
  type KeywordRecord,
} from "@/lib/queue";
import { clearAllDemoData } from "@/lib/demo-data";
import type { SupabaseClient } from "@supabase/supabase-js";

function createMockQueueStore(options?: { hourlyCalls?: number }) {
  const keywords: KeywordRecord[] = [
    { id: "kw-1", text: "software hr terbaik", active: true },
  ];
  const runs: CheckRunRecord[] = [];
  const items: RunItemRecord[] = [];

  const store: QueueStore = {
    async getRunningCheckRun() {
      return runs.find((r) => r.status === "running") ?? null;
    },
    async getActiveKeywords() {
      return keywords.filter((k) => k.active);
    },
    async createCheckRun(total: number, nowIso: string, isDemo = false) {
      const run: CheckRunRecord = {
        id: `run-${runs.length + 1}`,
        started_at: nowIso,
        finished_at: null,
        status: "running" as CheckRunStatus,
        total,
        done: 0,
        is_demo: isDemo,
      };
      runs.push(run);
      return run;
    },
    async insertRunItems(runId: string, keywordIds: string[], nowIso: string) {
      const parent = runs.find((r) => r.id === runId);
      for (const kwId of keywordIds) {
        items.push({
          id: `item-${items.length + 1}`,
          run_id: runId,
          keyword_id: kwId,
          state: "pending",
          attempts: 0,
          error: null,
          updated_at: nowIso,
          run_is_demo: Boolean(parent?.is_demo),
        });
      }
    },
    async recoverStuckProcessingItems() {
      return [];
    },
    async getHourlySerpApiCalls() {
      return options?.hourlyCalls ?? 0;
    },
    async listPendingCandidates(limit = 20) {
      return items.filter((i) => i.state === "pending").slice(0, limit);
    },
    async claimPendingItemAtomically(itemId: string, nowIso: string) {
      const item = items.find((i) => i.id === itemId && i.state === "pending");
      if (!item) return null;
      item.state = "processing";
      item.updated_at = nowIso;
      return item;
    },
    async getKeywordById(id: string) {
      return keywords.find((k) => k.id === id) ?? null;
    },
    async getDetectionContext() {
      return {
        brandTerms: [],
        competitorDomains: [],
        enableThirdPartyCheck: false,
      };
    },
    async saveCheckAndSources() {
      return "chk-1";
    },
    async markRunItemDone(itemId: string) {
      const itm = items.find((i) => i.id === itemId);
      if (itm) itm.state = "done";
    },
    async markRunItemFailedAttempt() {},
    async syncRunProgress(runId: string): Promise<RunSummary> {
      const run = runs.find((r) => r.id === runId);
      return {
        runId,
        total: run?.total ?? 1,
        done: 1,
        errors: 0,
        pending: 0,
        status: "done" as CheckRunStatus,
        serpApiCalls: 2,
        isDemo: Boolean(run?.is_demo),
      };
    },
  };

  return { store, runs, items };
}

describe("Single source of truth: isDryRun (lib/dry-run.ts)", () => {
  const originalEnv = process.env.SERPAPI_DRY_RUN;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SERPAPI_DRY_RUN = originalEnv;
    } else {
      delete process.env.SERPAPI_DRY_RUN;
    }
  });

  it("mengevaluasi 'true' atau '1' sebagai mode dry run", () => {
    expect(isDryRun("true")).toBe(true);
    expect(isDryRun("TRUE")).toBe(true);
    expect(isDryRun(" 1 ")).toBe(true);
    expect(isDryRun("1")).toBe(true);
  });

  it("hanya mengevaluasi 'false' atau '0' sebagai mode nyata", () => {
    expect(isDryRun("false")).toBe(false);
    expect(isDryRun("FALSE")).toBe(false);
    expect(isDryRun(" 0 ")).toBe(false);
    expect(isDryRun("0")).toBe(false);
  });

  it("mengevaluasi variabel kosong, tidak ada, atau nilai lain sebagai dry run (gagal aman)", () => {
    expect(isDryRun("")).toBe(true);
    expect(isDryRun("   ")).toBe(true);
    expect(isDryRun(undefined)).toBe(true);
    expect(isDryRun(null)).toBe(true);
    expect(isDryRun("foobar")).toBe(true);
    expect(isDryRun("random")).toBe(true);
  });

  it("variabel kosong tidak menghasilkan panggilan jaringan", async () => {
    process.env.SERPAPI_DRY_RUN = "";
    const mockFetch = vi.fn<typeof fetch>();

    const result = await fetchKeywordAiOverview("software hr terbaik", {
      fetchFn: mockFetch,
    });

    // Tidak ada panggilan jaringan yang dilakukan
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.raw.dry_run).toBe(true);
    expect(typeof result.parsed.hasAiOverview).toBe("boolean");
  });

  it("'false' memanggil klien jaringan (di-mock)", async () => {
    process.env.SERPAPI_DRY_RUN = "false";
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          search_metadata: { id: "test-run" },
          ai_overview: {
            text_blocks: [{ type: "paragraph", snippet: "LinovHR is great" }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchKeywordAiOverview("software hr terbaik", {
      apiKey: "test_key",
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.apiCallsCount).toBe(1);
  });

  it("run mode nyata tidak bertanda is_demo", async () => {
    process.env.SERPAPI_DRY_RUN = "false";
    const { store, runs } = createMockQueueStore();

    const started = await startCheckRun(store, new Date("2026-10-30T00:00:00Z"));

    expect(started.isDemo).toBe(false);
    expect(runs[0]?.is_demo).toBe(false);
  });

  it("run mode dry run bertanda is_demo = true secara otomatis", async () => {
    process.env.SERPAPI_DRY_RUN = "true";
    const { store, runs } = createMockQueueStore();

    const started = await startCheckRun(store, new Date("2026-10-30T00:00:00Z"));

    expect(started.isDemo).toBe(true);
    expect(runs[0]?.is_demo).toBe(true);
  });

  it("batas laju per jam tetap menghitung panggilan mode nyata", async () => {
    // 1. Panggilan dry-run tidak dihitung ke batas laju per jam
    expect(
      extractSerpApiCallsFromRaw(
        { serpapi_calls_count: 5, dry_run: true },
        { includeDryRun: false }
      )
    ).toBe(0);

    // 2. Panggilan mode nyata dihitung ke batas laju per jam
    expect(
      extractSerpApiCallsFromRaw(
        { serpapi_calls_count: 5, dry_run: false },
        { includeDryRun: false }
      )
    ).toBe(5);

    // 3. Queue process in real mode increments hourly SerpApi calls
    const { store } = createMockQueueStore({ hourlyCalls: 10 });
    await startCheckRun(store, new Date("2026-10-30T00:00:00Z"), { isDemo: false });

    const processed = await processQueue(store, {
      dryRun: false,
      maxPerHour: 50,
      serpApiFetcher: async () => ({
        parsed: {
          hasAiOverview: false,
          sources: [],
          answerText: "",
          pageToken: null,
        },
        raw: { serpapi_calls_count: 2, dry_run: false },
        firstRaw: {},
        secondRaw: null,
        usedFollowUpPageToken: false,
        apiCallsCount: 2,
      }),
    });

    // 1 keyword processed using 2 calls: 10 + 2 = 12
    expect(processed.hourlySerpApiCallsUsed).toBe(12);
  });

  it("clearAllDemoData: menolak jika ada baris is_demo = true yang memiliki checks.raw.dry_run bukan true", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "check_runs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: "run-demo-1" }],
                error: null,
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "checks") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "chk-1",
                    run_id: "run-demo-1",
                    raw: { dry_run: false },
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }),
    } as unknown as SupabaseClient;

    await expect(clearAllDemoData(mockSupabase)).rejects.toThrow(
      /Safety violation/i
    );
  });

  it("clearAllDemoData: berhasil menghapus jika semua checks di is_demo = true memiliki checks.raw.dry_run = true", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "check_runs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: "run-demo-1" }],
                error: null,
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "checks") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "chk-1",
                    run_id: "run-demo-1",
                    raw: { dry_run: true },
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }),
    } as unknown as SupabaseClient;

    const result = await clearAllDemoData(mockSupabase);
    expect(result.deletedRunsCount).toBe(1);
  });
});
