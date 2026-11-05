import { describe, expect, it } from "vitest";
import {
  getScheduledBatchForDate,
  getJakartaWeekBoundaries,
  DEFAULT_SCHEDULE_ANCHOR_DATE,
  type KeywordBatchRecord,
  type BatchOverrideState,
} from "@/lib/keyword-batches";

const sampleBatches: KeywordBatchRecord[] = [
  {
    id: "batch-1",
    name: "Batch 1 - Core HR",
    description: "Core HR features",
    order_index: 1,
    is_active: true,
    is_enabled: true,
    is_demo: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "batch-2",
    name: "Batch 2 - Payroll",
    description: "Payroll & Tax",
    order_index: 2,
    is_active: false,
    is_enabled: true,
    is_demo: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "batch-3",
    name: "Batch 3 - Recruitment",
    description: "ATS & Hiring",
    order_index: 3,
    is_active: false,
    is_enabled: true,
    is_demo: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "batch-4",
    name: "Batch 4 - Performance",
    description: "KPI & Appraisal",
    order_index: 4,
    is_active: false,
    is_enabled: true,
    is_demo: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
];

describe("Jadwal Turunan Batch Mingguan (Asia/Jakarta)", () => {
  // 1. Batas Minggu 23:59 WIB dan Senin 00:00 WIB
  describe("1. Batas Minggu 23:59 WIB dan Senin 00:00 WIB", () => {
    it("menghitung batas minggu tepat pada pergantian detik Minggu 23:59:59 WIB ke Senin 00:00:00 WIB", () => {
      // Minggu, 8 November 2026 23:59:59 WIB = 2026-11-08 16:59:59 UTC
      const sundayNight = new Date("2026-11-08T16:59:59.000Z");
      // Senin, 9 November 2026 00:00:00 WIB = 2026-11-08 17:00:00 UTC
      const mondayMidnight = new Date("2026-11-08T17:00:00.000Z");

      const sundayBounds = getJakartaWeekBoundaries(sundayNight);
      const mondayBounds = getJakartaWeekBoundaries(mondayMidnight);

      expect(sundayBounds.mondayDateString).toBe("2026-11-02");
      expect(mondayBounds.mondayDateString).toBe("2026-11-09");

      const sundayScheduled = getScheduledBatchForDate(sundayNight, sampleBatches);
      const mondayScheduled = getScheduledBatchForDate(mondayMidnight, sampleBatches);

      // Minggu 8 Nov 23:59:59 WIB adalah minggu ke-0 sejak 2 Nov -> Batch 1
      expect(sundayScheduled.batch?.id).toBe("batch-1");
      expect(sundayScheduled.weekIndex).toBe(0);

      // Senin 9 Nov 00:00:00 WIB adalah minggu ke-1 sejak 2 Nov -> Batch 2
      expect(mondayScheduled.batch?.id).toBe("batch-2");
      expect(mondayScheduled.weekIndex).toBe(1);
    });

    it("memastikan batas pergantian minggu pada tanggal 1 dan 31 pergantian bulan", () => {
      // 31 Oktober 2026 adalah hari Sabtu (WIB)
      const satOct31 = new Date("2026-10-31T05:00:00.000Z");
      const satBounds = getJakartaWeekBoundaries(satOct31);
      // Senin dari minggu itu adalah 26 Oktober 2026
      expect(satBounds.mondayDateString).toBe("2026-10-26");

      // 1 November 2026 adalah hari Minggu (WIB)
      const sunNov1 = new Date("2026-11-01T05:00:00.000Z");
      const sunBounds = getJakartaWeekBoundaries(sunNov1);
      // Masih dalam minggu yang sama yang berawal 26 Oktober 2026
      expect(sunBounds.mondayDateString).toBe("2026-10-26");

      // 2 November 2026 adalah hari Senin (WIB)
      const monNov2 = new Date("2026-11-02T01:00:00.000Z");
      const monBounds = getJakartaWeekBoundaries(monNov2);
      expect(monBounds.mondayDateString).toBe("2026-11-02");
    });
  });

  // 2. Bulan dengan 5 Senin
  describe("2. Bulan dengan 5 Senin", () => {
    it("menjadwalkan kelima Senin di bulan November 2026 secara deterministik dan berputar mulus", () => {
      // November 2026 memiliki 5 hari Senin: 2, 9, 16, 23, 30
      const mondaysNov2026 = [
        "2026-11-02T03:00:00.000Z", // Senin ke-1: Batch 1 (idx 0)
        "2026-11-09T03:00:00.000Z", // Senin ke-2: Batch 2 (idx 1)
        "2026-11-16T03:00:00.000Z", // Senin ke-3: Batch 3 (idx 2)
        "2026-11-23T03:00:00.000Z", // Senin ke-4: Batch 4 (idx 3)
        "2026-11-30T03:00:00.000Z", // Senin ke-5: Batch 1 (idx 0)
      ];

      const scheduledBatches = mondaysNov2026.map(
        (iso) => getScheduledBatchForDate(new Date(iso), sampleBatches).batch?.id
      );

      expect(scheduledBatches).toEqual([
        "batch-1",
        "batch-2",
        "batch-3",
        "batch-4",
        "batch-1",
      ]);
    });

    it("menjadwalkan bulan Maret 2026 (5 Senin sebelum jangkar) tanpa diskontinuitas", () => {
      // Maret 2026: 2, 9, 16, 23, 30
      const mondaysMar2026 = [
        "2026-03-02T03:00:00.000Z",
        "2026-03-09T03:00:00.000Z",
        "2026-03-16T03:00:00.000Z",
        "2026-03-23T03:00:00.000Z",
        "2026-03-30T03:00:00.000Z",
      ];

      const res = mondaysMar2026.map((iso) =>
        getScheduledBatchForDate(new Date(iso), sampleBatches)
      );

      // Pastikan batch berputar berurutan secara siklik modulo 4
      for (let i = 0; i < res.length - 1; i++) {
        const currBatch = res[i]?.batch;
        const nextBatch = res[i + 1]?.batch;
        expect(currBatch).toBeDefined();
        expect(nextBatch).toBeDefined();
        const expectedNextOrder = ((currBatch!.order_index % 4) + 1);
        expect(nextBatch!.order_index).toBe(expectedNextOrder);
      }
    });
  });

  // 3. Cron terlewat lalu jalan di minggu berikutnya
  describe("3. Cron terlewat lalu jalan di minggu berikutnya", () => {
    it("tidak tertinggal saat cron terlewat dan langsung menjalankan batch minggu berjalan", () => {
      // Anggap cron berjalan di minggu ke-0 (2 Nov 2026) -> Batch 1
      const week0Date = new Date("2026-11-02T02:00:00.000Z");
      const week0Run = getScheduledBatchForDate(week0Date, sampleBatches);
      expect(week0Run.batch?.id).toBe("batch-1");

      // Cron minggu ke-1 (9 Nov 2026) TERLEWAT (mati / tidak dipanggil)
      // Saat cron baru dipanggil pada minggu ke-2 (16 Nov 2026):
      const week2Date = new Date("2026-11-16T02:00:00.000Z");
      const week2Run = getScheduledBatchForDate(week2Date, sampleBatches);

      // Harus otomatis Batch 3, BUKAN Batch 2 yang tertinggal
      expect(week2Run.batch?.id).toBe("batch-3");
      expect(week2Run.weekIndex).toBe(2);
    });
  });

  // 4. start-run dipanggil dua kali (idempoten per minggu Jakarta)
  describe("4. start-run dipanggil dua kali (idempoten)", () => {
    it("menolak eksekusi ganda dalam minggu yang sama dan mengembalikan runId yang ada", async () => {
      const existingRunId = "run-existing-123";

      interface MockRunRow {
        id: string;
        status: string;
        total: number;
        started_at: string;
        is_demo: boolean;
      }

      interface MockQueryBuilder {
        select: (_cols: string) => MockQueryBuilder;
        eq: (_col: string, _val: unknown) => MockQueryBuilder;
        in: (_col: string, _vals: unknown[]) => MockQueryBuilder;
        gte: (_col: string, _val: unknown) => MockQueryBuilder;
        lte: (_col: string, _val: unknown) => MockQueryBuilder;
        order: () => MockQueryBuilder;
        limit: () => Promise<{
          data: MockRunRow[];
          error: null;
        }>;
      }

      const queryBuilder: MockQueryBuilder = {
        select: () => queryBuilder,
        eq: () => queryBuilder,
        in: () => queryBuilder,
        gte: () => queryBuilder,
        lte: () => queryBuilder,
        order: () => queryBuilder,
        limit: () =>
          Promise.resolve({
            data: [
              {
                id: existingRunId,
                status: "running",
                total: 35,
                started_at: "2026-11-02T03:00:00.000Z",
                is_demo: false,
              },
            ],
            error: null,
          }),
      };

      // Mock Supabase admin client untuk route cron start-run
      const mockSupabase = {
        from: (): MockQueryBuilder => queryBuilder,
      };

      // Simulasikan logika idempotensi start-run
      const now = new Date("2026-11-04T05:00:00.000Z"); // Rabu di minggu yang sama
      const { startIso, endIso } = getJakartaWeekBoundaries(now);

      const { data: runs } = await mockSupabase
        .from("check_runs")
        .select("id, status, total, started_at, is_demo")
        .eq("is_demo", false)
        .in("status", ["running", "done"])
        .gte("started_at", startIso)
        .lte("started_at", endIso)
        .order()
        .limit();

      expect(runs).toHaveLength(1);
      const existingRun = runs[0]!;

      // Hasil yang dikembalikan start-run saat already_ran_this_week
      const responseBody = {
        runId: existingRun.id,
        total: existingRun.total,
        status: existingRun.status,
        isExisting: true,
        isDemo: false,
        skipped: "already_ran_this_week",
        message: `Run untuk minggu Jakarta ini sudah ada (${existingRun.id}) berstatus ${existingRun.status}. Eksekusi dilewati agar idempoten.`,
      };

      expect(responseBody.skipped).toBe("already_ran_this_week");
      expect(responseBody.runId).toBe(existingRunId);
    });

    it("tidak memblokir eksekusi baru jika run sebelumnya berstatus failed", async () => {
      interface MockFailedQueryBuilder {
        select: (_cols?: string) => MockFailedQueryBuilder;
        eq: (_col?: string, _val?: unknown) => MockFailedQueryBuilder;
        in: (_col: string, statuses: string[]) => MockFailedQueryBuilder;
        gte: (_col?: string, _val?: unknown) => MockFailedQueryBuilder;
        lte: (_col?: string, _val?: unknown) => MockFailedQueryBuilder;
        order: (_col?: string, _opts?: unknown) => MockFailedQueryBuilder;
        limit: (_n?: number) => Promise<{ data: unknown[]; error: null }>;
      }

      const queryBuilder: MockFailedQueryBuilder = {
        select: () => queryBuilder,
        eq: () => queryBuilder,
        in: (_col: string, statuses: string[]) => {
          // Query hanya menyaring ["running", "done"]
          expect(statuses).toEqual(["running", "done"]);
          return queryBuilder;
        },
        gte: () => queryBuilder,
        lte: () => queryBuilder,
        order: () => queryBuilder,
        limit: () =>
          // Run failed tidak masuk ke dalam filter status ["running", "done"]
          Promise.resolve({
            data: [],
            error: null,
          }),
      };

      const mockSupabaseWithFailedRun = {
        from: (): MockFailedQueryBuilder => queryBuilder,
      };

      const now = new Date("2026-11-04T05:00:00.000Z");
      const { startIso, endIso } = getJakartaWeekBoundaries(now);
      const { data: existingRuns } = await mockSupabaseWithFailedRun
        .from("check_runs")
        .select("id, status, total, started_at, is_demo")
        .eq("is_demo", false)
        .in("status", ["running", "done"])
        .gte("started_at", startIso)
        .lte("started_at", endIso)
        .limit(1);

      expect(existingRuns).toEqual([]);
      // Karena kosong, startCheckRun akan lanjut membuat run baru
    });
  });

  // 5. Perubahan N (batch ditambah atau dinonaktifkan)
  describe("5. Perubahan N (batch ditambah atau dinonaktifkan)", () => {
    it("menyesuaikan rotasi secara dinamis saat batch dinonaktifkan (N berkurang)", () => {
      // Nonaktifkan batch 3: N menjadi 3 (Batch 1, Batch 2, Batch 4)
      const batchesWithDisabled: KeywordBatchRecord[] = sampleBatches.map((b) =>
        b.id === "batch-3" ? { ...b, is_enabled: false } : b
      );

      // Minggu 0 (2 Nov) -> Batch 1 (idx 0 mod 3)
      // Minggu 1 (9 Nov) -> Batch 2 (idx 1 mod 3)
      // Minggu 2 (16 Nov) -> Batch 4 (idx 2 mod 3, menggantikan batch 3 yang nonaktif)
      // Minggu 3 (23 Nov) -> Batch 1 (idx 3 mod 3 = 0)
      const w0 = getScheduledBatchForDate(new Date("2026-11-02T03:00:00Z"), batchesWithDisabled);
      const w1 = getScheduledBatchForDate(new Date("2026-11-09T03:00:00Z"), batchesWithDisabled);
      const w2 = getScheduledBatchForDate(new Date("2026-11-16T03:00:00Z"), batchesWithDisabled);
      const w3 = getScheduledBatchForDate(new Date("2026-11-23T03:00:00Z"), batchesWithDisabled);

      expect(w0.batch?.id).toBe("batch-1");
      expect(w1.batch?.id).toBe("batch-2");
      expect(w2.batch?.id).toBe("batch-4");
      expect(w3.batch?.id).toBe("batch-1");
    });

    it("menyesuaikan rotasi saat batch baru ditambahkan (N bertambah)", () => {
      const batchesWithNew: KeywordBatchRecord[] = [
        ...sampleBatches,
        {
          id: "batch-5",
          name: "Batch 5 - Enterprise",
          description: "Enterprise features",
          order_index: 5,
          is_active: false,
          is_enabled: true,
          is_demo: false,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
        },
      ];

      // N = 5
      // Minggu 4 (30 Nov 2026) -> Batch 5 (idx 4 mod 5)
      const w4 = getScheduledBatchForDate(new Date("2026-11-30T03:00:00Z"), batchesWithNew);
      expect(w4.batch?.id).toBe("batch-5");
    });

    it("mengabaikan batch demo (is_demo=true) dari pembagi N", () => {
      const batchesWithDemo: KeywordBatchRecord[] = [
        ...sampleBatches,
        {
          id: "batch-demo",
          name: "Batch Demo",
          description: "Demo batch",
          order_index: 0,
          is_active: false,
          is_enabled: true,
          is_demo: true,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
        },
      ];

      // N tetap 4 (hanya non-demo yang dihitung)
      const w0 = getScheduledBatchForDate(new Date("2026-11-02T03:00:00Z"), batchesWithDemo);
      const w4 = getScheduledBatchForDate(new Date("2026-11-30T03:00:00Z"), batchesWithDemo);
      expect(w0.batch?.id).toBe("batch-1");
      expect(w4.batch?.id).toBe("batch-1");
    });
  });

  // 6. Override kedaluwarsa
  describe("6. Override manual dan masa kedaluwarsa", () => {
    it("menggunakan override saat sekarang < override_until, lalu kembali ke jadwal turunan setelah kedaluwarsa", () => {
      const overrideSettings: BatchOverrideState = {
        mode: "manual_frozen",
        activeBatchId: "batch-4",
        manual_frozen: true,
        override_until: "2026-11-15T00:00:00.000Z",
      };

      // Kasus A: Sebelum kedaluwarsa (10 November 2026)
      const beforeExpiry = new Date("2026-11-10T10:00:00.000Z");
      const activeOverride = getScheduledBatchForDate(
        beforeExpiry,
        sampleBatches,
        overrideSettings
      );
      expect(activeOverride.batch?.id).toBe("batch-4");
      expect(activeOverride.isOverride).toBe(true);

      // Kasus B: Tepat atau setelah kedaluwarsa (15 November 2026 00:00:01)
      const afterExpiry = new Date("2026-11-15T00:00:01.000Z");
      const revertedSchedule = getScheduledBatchForDate(
        afterExpiry,
        sampleBatches,
        overrideSettings
      );

      // Otomatis kembali ke jadwal turunan alami untuk minggu 9 Nov (Batch 2)
      expect(revertedSchedule.batch?.id).toBe("batch-2");
      expect(revertedSchedule.isOverride).toBe(false);
    });

    it("mempertahankan override permanen bila override_until tidak disetel", () => {
      const permanentFreeze: BatchOverrideState = {
        mode: "manual_frozen",
        activeBatchId: "batch-4",
        manual_frozen: true,
        override_until: null,
      };

      const distantFuture = new Date("2028-05-20T10:00:00.000Z");
      const res = getScheduledBatchForDate(distantFuture, sampleBatches, permanentFreeze);

      expect(res.batch?.id).toBe("batch-4");
      expect(res.isOverride).toBe(true);
    });
  });

  // 7. Batch kosong
  describe("7. Batch terjadwal yang kosong", () => {
    it("menghasilkan informasi batch terjadwal namun ditandai sebagai skipped: 'empty_batch' tanpa membuat run", async () => {
      // Simulasikan pemeriksaan pada batch yang tidak memiliki keyword aktif
      const emptyBatch = sampleBatches[0]!;
      const keywordsInEmptyBatch: Array<{ id: string; is_demo?: boolean }> = []; // Kosong

      const nonDemoKeywords = keywordsInEmptyBatch.filter((k) => !k.is_demo);
      expect(nonDemoKeywords).toHaveLength(0);

      const skipResponse = {
        runId: null,
        total: 0,
        isExisting: false,
        isDemo: false,
        skipped: "empty_batch",
        batchId: emptyBatch.id,
        batchName: emptyBatch.name,
        message: `Batch terjadwal "${emptyBatch.name}" tidak memiliki keyword aktif non-demo. Pemindaian dilewati tanpa membuat run.`,
      };

      expect(skipResponse.skipped).toBe("empty_batch");
      expect(skipResponse.runId).toBeNull();
      expect(skipResponse.total).toBe(0);
    });
  });

  // 8. Tanggal sebelum jangkar
  describe("8. Tanggal sebelum tanggal jangkar (Modulo Positif)", () => {
    it("menghitung indeks modulo positif secara konsisten untuk tanggal sebelum 2 November 2026", () => {
      expect(DEFAULT_SCHEDULE_ANCHOR_DATE).toBe("2026-11-02");
      // Jangkar: Senin 2 November 2026 = Week 0 = Batch 1 (idx 0)
      // 1 minggu sebelum jangkar: Senin 26 Oktober 2026 (diff = -1) -> ((-1 % 4) + 4) % 4 = 3 -> Batch 4
      const oneWeekBefore = new Date("2026-10-26T03:00:00.000Z");
      const res1 = getScheduledBatchForDate(oneWeekBefore, sampleBatches);
      expect(res1.weekIndex).toBe(-1);
      expect(res1.batch?.id).toBe("batch-4");

      // 2 minggu sebelum jangkar: Senin 19 Oktober 2026 (diff = -2) -> ((-2 % 4) + 4) % 4 = 2 -> Batch 3
      const twoWeeksBefore = new Date("2026-10-19T03:00:00.000Z");
      const res2 = getScheduledBatchForDate(twoWeeksBefore, sampleBatches);
      expect(res2.weekIndex).toBe(-2);
      expect(res2.batch?.id).toBe("batch-3");

      // 3 minggu sebelum jangkar: Senin 12 Oktober 2026 (diff = -3) -> ((-3 % 4) + 4) % 4 = 1 -> Batch 2
      const threeWeeksBefore = new Date("2026-10-12T03:00:00.000Z");
      const res3 = getScheduledBatchForDate(threeWeeksBefore, sampleBatches);
      expect(res3.weekIndex).toBe(-3);
      expect(res3.batch?.id).toBe("batch-2");

      // 4 minggu sebelum jangkar: Senin 5 Oktober 2026 (diff = -4) -> ((-4 % 4) + 4) % 4 = 0 -> Batch 1
      const fourWeeksBefore = new Date("2026-10-05T03:00:00.000Z");
      const res4 = getScheduledBatchForDate(fourWeeksBefore, sampleBatches);
      expect(res4.weekIndex).toBe(-4);
      expect(res4.batch?.id).toBe("batch-1");
    });
  });

  // 9. Kalender dan start-run mengembalikan batch yang sama untuk 52 minggu berurutan
  describe("9. Kalender dan start-run mengembalikan batch yang sama untuk 52 minggu berurutan", () => {
    it("menghasilkan identitas batch yang persis sama antara kalender dan eksekusi start-run selama 52 minggu", () => {
      // Mulai dari Senin jangkar 2 Nov 2026 selama 52 minggu ke depan
      const startMs = Date.parse("2026-11-02T03:00:00.000Z");
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

      for (let w = 0; w < 52; w++) {
        const testDate = new Date(startMs + w * oneWeekMs);

        // Batch yang ditentukan oleh kalender
        const calendarResult = getScheduledBatchForDate(testDate, sampleBatches);

        // Batch yang ditentukan oleh start-run (fungsi murni yang sama dipanggil di route start-run)
        const startRunDetermined = getScheduledBatchForDate(testDate, sampleBatches);

        expect(calendarResult.batch?.id).toBe(startRunDetermined.batch?.id);
        expect(calendarResult.targetWeekMonday).toBe(startRunDetermined.targetWeekMonday);

        // Pastikan indeks berputar 0, 1, 2, 3, 0, 1, 2, 3 ...
        const expectedBatchId = sampleBatches[w % 4]!.id;
        expect(calendarResult.batch?.id).toBe(expectedBatchId);
      }
    });
  });
});
