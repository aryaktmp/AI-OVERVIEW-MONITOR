import { describe, expect, it, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  rotateActiveKeywordBatch,
  overrideActiveKeywordBatch,
  setBatchScheduleMode,
  listKeywordBatchesWithCounts,
  createKeywordBatch,
  listKeywordsForBatchSelection,
  parseKeywordsInput,
  type KeywordBatchRecord,
  type BatchScheduleSettingsRecord,
  type BatchAuditLogRecord,
} from "../lib/keyword-batches";
import { createSupabaseQueueStore } from "../lib/queue";

interface MockKeyword {
  id: string;
  text: string;
  active: boolean;
  batch_id: string | null;
  is_demo: boolean;
  created_at: string;
}

interface MockCheckRun {
  id: string;
  status: string;
  started_at: string;
}

function createMockSupabase() {
  const batches: KeywordBatchRecord[] = [
    {
      id: "b-1",
      name: "Batch 1",
      description: "Batch HR Core",
      order_index: 1,
      is_active: true,
      is_enabled: true,
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "b-2",
      name: "Batch 2",
      description: "Batch Payroll",
      order_index: 2,
      is_active: false,
      is_enabled: true,
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "b-3",
      name: "Batch 3",
      description: "Batch Recruitment",
      order_index: 3,
      is_active: false,
      is_enabled: true,
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
  ];

  const keywords: MockKeyword[] = [
    {
      id: "k-1",
      text: "software hris",
      active: true,
      batch_id: "b-1",
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "k-2",
      text: "aplikasi absensi",
      active: true,
      batch_id: "b-1",
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "k-3",
      text: "software payroll",
      active: true,
      batch_id: "b-2",
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "k-4",
      text: "aplikasi slip gaji",
      active: true,
      batch_id: "b-2",
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "k-5",
      text: "software rekrutmen",
      active: true,
      batch_id: "b-3",
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "k-6",
      text: "aplikasi timesheet online",
      active: true,
      batch_id: null,
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
    },
  ];

  let settings: BatchScheduleSettingsRecord = {
    id: 1,
    mode: "auto",
    override_until: null,
    updated_at: "2026-11-01T00:00:00Z",
  };

  const auditLogs: BatchAuditLogRecord[] = [];
  const checkRuns: MockCheckRun[] = [];

  const client = {
    from: (table: string) => {
      let filterBatchId: string | null = null;
      let filterActive: boolean | null = null;
      let filterIsActive: boolean | null = null;
      let filterId: string | number | null = null;
      let filterStatus: string | null = null;
      let filterIds: string[] | null = null;

      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          if (col === "batch_id") filterBatchId = val as string;
          if (col === "active") filterActive = val as boolean;
          if (col === "is_active") filterIsActive = val as boolean;
          if (col === "id") filterId = val as string | number;
          if (col === "status") filterStatus = val as string;
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          if (col === "id") filterIds = vals as string[];
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === "keyword_batches") {
            const found = batches.find((b) => {
              if (filterIsActive !== null && b.is_active !== filterIsActive) return false;
              if (filterId !== null && b.id !== filterId) return false;
              return true;
            });
            return { data: found ? { ...found } : null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === "batch_schedule_settings") {
            return { data: { ...settings }, error: null };
          }
          if (table === "keyword_batches") {
            const found = batches.find((b) => b.id === filterId);
            return { data: found ? { ...found } : null, error: found ? null : { message: "Not found" } };
          }
          return { data: null, error: null };
        },
        then: (resolve: (val: unknown) => unknown) => {
          if (table === "keyword_batches") {
            const filtered = batches.filter((b) => {
              if (filterIsActive !== null && b.is_active !== filterIsActive) return false;
              if (filterId !== null && b.id !== filterId) return false;
              return true;
            });
            return Promise.resolve(resolve({ data: filtered.map((b) => ({ ...b })), error: null }));
          }
          if (table === "keywords") {
            const filtered = keywords.filter((k) => {
              if (filterIds !== null && !filterIds.includes(k.id)) return false;
              if (filterBatchId !== null && k.batch_id !== filterBatchId) return false;
              if (filterActive !== null && k.active !== filterActive) return false;
              return true;
            });
            return Promise.resolve(resolve({ data: filtered.map((k) => ({ ...k })), error: null }));
          }
          if (table === "check_runs") {
            const filtered = checkRuns.filter((r) => {
              if (filterStatus !== null && r.status !== filterStatus) return false;
              return true;
            });
            return Promise.resolve(resolve({ data: filtered.map((r) => ({ ...r })), error: null }));
          }
          if (table === "batch_audit_logs") {
            return Promise.resolve(resolve({ data: auditLogs.map((l) => ({ ...l })), error: null }));
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        },
        insert: (data: unknown) => {
          if (table === "batch_audit_logs") {
            const row = { id: `log-${auditLogs.length + 1}`, ...(data as Record<string, unknown>) } as BatchAuditLogRecord;
            auditLogs.unshift(row);
            return Promise.resolve({ data: row, error: null });
          }
          if (table === "keyword_batches") {
            const row = { id: `b-${batches.length + 1}`, ...(data as Record<string, unknown>) } as KeywordBatchRecord;
            batches.push(row);
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          }
          if (table === "keywords") {
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              const row = {
                id: `k-${keywords.length + 1}`,
                active: true,
                batch_id: null,
                is_demo: false,
                created_at: "2026-11-01T00:00:00Z",
                ...(item as Record<string, unknown>),
              } as MockKeyword;
              keywords.push(row);
            }
            return Promise.resolve({ data: items, error: null });
          }
          return Promise.resolve({ data, error: null });
        },
        update: (payload: Record<string, unknown>) => {
          return {
            eq: (col: string, val: unknown) => {
              if (table === "keyword_batches" && col === "id") {
                const target = batches.find((b) => b.id === val);
                if (target) {
                  Object.assign(target, payload);
                }
              }
              if (table === "batch_schedule_settings" && col === "id") {
                Object.assign(settings, payload);
              }
              return {
                select: () => ({
                  single: async () => ({ data: { ...settings }, error: null }),
                }),
                then: (resolve: (val: unknown) => unknown) => {
                  return Promise.resolve(resolve({ data: null, error: null }));
                },
              };
            },
            in: (col: string, vals: unknown[]) => {
              if (table === "keywords" && col === "id") {
                for (const kw of keywords) {
                  if (vals.includes(kw.id)) {
                    Object.assign(kw, payload);
                  }
                }
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };

      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, batches, keywords, settings, auditLogs, checkRuns };
}

describe("Fase Logika: Rotasi, Kontrol Manual, & Search Filtering", () => {
  let ctx: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    ctx = createMockSupabase();
  });

  it("1. Melakukan rotasi batch otomatis berurutan (Batch 1 -> Batch 2 -> Batch 3 -> Batch 1)", async () => {
    // Awal: Batch 1 aktif
    expect(ctx.batches[0].is_active).toBe(true);
    expect(ctx.batches[1].is_active).toBe(false);
    expect(ctx.batches[2].is_active).toBe(false);

    // Rotasi ke-1: Harus berpindah ke Batch 2
    const res1 = await rotateActiveKeywordBatch(ctx.client, { actorId: "system:cron" });
    expect(res1.status).toBe("rotated");
    expect(res1.newBatch?.name).toBe("Batch 2");
    expect(ctx.batches[0].is_active).toBe(false);
    expect(ctx.batches[1].is_active).toBe(true);
    expect(ctx.batches[2].is_active).toBe(false);
    expect(ctx.auditLogs).toHaveLength(1);
    expect(ctx.auditLogs[0].trigger_type).toBe("auto_schedule");

    // Rotasi ke-2: Harus berpindah ke Batch 3
    const res2 = await rotateActiveKeywordBatch(ctx.client, { actorId: "system:cron" });
    expect(res2.status).toBe("rotated");
    expect(res2.newBatch?.name).toBe("Batch 3");
    expect(ctx.batches[1].is_active).toBe(false);
    expect(ctx.batches[2].is_active).toBe(true);

    // Rotasi ke-3: Wrap-around kembali ke Batch 1
    const res3 = await rotateActiveKeywordBatch(ctx.client, { actorId: "system:cron" });
    expect(res3.status).toBe("rotated");
    expect(res3.newBatch?.name).toBe("Batch 1");
    expect(ctx.batches[0].is_active).toBe(true);
    expect(ctx.batches[2].is_active).toBe(false);
  });

  it("2. Melewati batch kosong (skip empty batch) dan melompat ke batch berikutnya yang punya keyword", async () => {
    // Kosongkan keyword di Batch 2
    for (const kw of ctx.keywords) {
      if (kw.batch_id === "b-2") {
        kw.active = false; // Nonaktifkan keyword di Batch 2
      }
    }

    // Awal di Batch 1 (punya 2 keyword aktif)
    // Batch 2 punya 0 keyword aktif
    // Batch 3 punya 1 keyword aktif
    const res = await rotateActiveKeywordBatch(ctx.client);
    expect(res.status).toBe("rotated");
    // Karena Batch 2 kosong, rotasi harus otomatis MELOMPAT ke Batch 3!
    expect(res.newBatch?.name).toBe("Batch 3");
    expect(ctx.batches[0].is_active).toBe(false);
    expect(ctx.batches[1].is_active).toBe(false);
    expect(ctx.batches[2].is_active).toBe(true);

    // Memverifikasi audit log notifikasi empty_batch_warning tercatat
    const emptyLog = ctx.auditLogs.find((l) => l.trigger_type === "empty_batch_warning");
    expect(emptyLog).toBeDefined();
    expect(emptyLog?.notes).toContain("Batch 2");
  });

  it("3. Mengembalikan status no_candidates jika seluruh batch kosong tanpa mematikan batch saat ini", async () => {
    // Nonaktifkan semua keyword
    for (const kw of ctx.keywords) {
      kw.active = false;
    }

    const res = await rotateActiveKeywordBatch(ctx.client);
    expect(res.status).toBe("no_candidates");
    // Batch 1 tetap tidak dimatikan sembarangan
    expect(ctx.batches[0].is_active).toBe(true);
    // Log peringatan dicatat
    expect(ctx.auditLogs[0].trigger_type).toBe("warning");
  });

  it("4. Mencegah rotasi jika terdapat pemindaian yang masih berjalan (schedule overlap protection)", async () => {
    // Simulasikan ada run yang masih 'running'
    ctx.checkRuns.push({
      id: "run-active-101",
      status: "running",
      started_at: new Date().toISOString(),
    });

    const res = await rotateActiveKeywordBatch(ctx.client);
    expect(res.status).toBe("skipped_running_run");
    expect(res.message).toContain("run-active-101");
    // Batch tidak boleh berpindah saat run sedang aktif
    expect(ctx.batches[0].is_active).toBe(true);
    expect(ctx.batches[1].is_active).toBe(false);
  });

  it("5. Menghormati mode manual_frozen kecuali jika dipaksa dengan flag force", async () => {
    // Set mode ke manual_frozen
    ctx.settings.mode = "manual_frozen";

    // Panggilan rotasi rutin harus dilewati
    const resSkipped = await rotateActiveKeywordBatch(ctx.client);
    expect(resSkipped.status).toBe("skipped_manual_frozen");
    expect(ctx.batches[0].is_active).toBe(true);

    // Panggilan rotasi dengan force = true harus tetap dieksekusi
    const resForced = await rotateActiveKeywordBatch(ctx.client, { force: true });
    expect(resForced.status).toBe("rotated");
    expect(resForced.newBatch?.name).toBe("Batch 2");
    expect(ctx.batches[1].is_active).toBe(true);
  });

  it("6. Menghormati jadwal override_until sementara dan kembali ke auto setelah kedaluwarsa", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    ctx.settings.override_until = futureDate;

    // Saat masih sebelum override_until, rotasi dilewati
    const resActive = await rotateActiveKeywordBatch(ctx.client, {
      now: new Date(),
    });
    expect(resActive.status).toBe("skipped_override_active");

    // Saat waktu simulasi sudah melampaui override_until (2 hari kemudian)
    const twoDaysLater = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const resExpired = await rotateActiveKeywordBatch(ctx.client, {
      now: twoDaysLater,
    });
    expect(resExpired.status).toBe("rotated");
    expect(resExpired.newBatch?.name).toBe("Batch 2");
    expect(ctx.settings.override_until).toBeNull();
  });

  it("7. Melakukan manual override ke batch target dan mengubah mode", async () => {
    const res = await overrideActiveKeywordBatch(ctx.client, "b-3", {
      actorId: "admin-ryan",
      freezeMode: true,
      notes: "Ubah manual ke batch recruitment untuk evaluasi khusus",
    });

    expect(res.ok).toBe(true);
    expect(res.newBatch.name).toBe("Batch 3");
    expect(res.mode).toBe("manual_frozen");
    expect(ctx.batches[0].is_active).toBe(false);
    expect(ctx.batches[2].is_active).toBe(true);

    expect(ctx.auditLogs[0].trigger_type).toBe("admin_override");
    expect(ctx.auditLogs[0].actor_id).toBe("admin-ryan");
    expect(ctx.auditLogs[0].notes).toContain("Ubah manual ke batch recruitment");
  });

  it("8. Memastikan antrean search hanya membaca keyword dari batch yang aktif (Search Implementation)", async () => {
    const store = createSupabaseQueueStore(ctx.client);

    // Saat Batch 1 aktif: hanya mengambil 2 keyword milik Batch 1 (k-1, k-2)
    const keywordsBatch1 = await store.getActiveKeywords();
    expect(keywordsBatch1).toHaveLength(2);
    expect(keywordsBatch1.map((k) => k.id)).toEqual(["k-1", "k-2"]);

    // Pindah batch aktif ke Batch 2
    await overrideActiveKeywordBatch(ctx.client, "b-2");

    // Sekarang getActiveKeywords() otomatis hanya mengambil 2 keyword milik Batch 2 (k-3, k-4)
    const keywordsBatch2 = await store.getActiveKeywords();
    expect(keywordsBatch2).toHaveLength(2);
    expect(keywordsBatch2.map((k) => k.id)).toEqual(["k-3", "k-4"]);

    // Pindah batch aktif ke Batch 3
    await overrideActiveKeywordBatch(ctx.client, "b-3");

    // Sekarang getActiveKeywords() hanya mengambil 1 keyword milik Batch 3 (k-5)
    const keywordsBatch3 = await store.getActiveKeywords();
    expect(keywordsBatch3).toHaveLength(1);
    expect(keywordsBatch3.map((k) => k.id)).toEqual(["k-5"]);
  });

  it("9. parseKeywordsInput mem-parse format newline/koma, deduplikasi, dan membuang item tidak valid", () => {
    // Null/undefined/empty
    expect(parseKeywordsInput(null)).toEqual([]);
    expect(parseKeywordsInput("")).toEqual([]);

    // Comma and newline separated with duplicate ignoring case and trimming
    const raw = `
      software hris indonesia,
      SOFTWARE HRIS INDONESIA,
      aplikasi payroll online
      a
      linovhr attendance
    `;
    const parsed = parseKeywordsInput(raw);
    expect(parsed).toEqual([
      "software hris indonesia",
      "aplikasi payroll online",
      "linovhr attendance",
    ]);

    // Array input
    const fromArray = parseKeywordsInput([
      "  software hris ",
      "aplikasi payroll",
      "SOFTWARE HRIS",
      "x",
    ]);
    expect(fromArray).toEqual(["software hris", "aplikasi payroll"]);
  });

  it("10. createKeywordBatch dapat memilih keyword unassigned via keywordIds (multi-select) dan menambahkan keyword baru", async () => {
    // Awal: k-6 belum punya batch (unassigned)
    const k6 = ctx.keywords.find((k) => k.id === "k-6");
    expect(k6?.batch_id).toBeNull();

    // Buat Batch 4 dengan memilih k-6 (unassigned) dan menambahkan 2 keyword baru
    const result = await createKeywordBatch(ctx.client, {
      name: "Batch 4 - New Generation",
      description: "Batch baru dengan multi-select keyword unassigned",
      keywordIds: ["k-6"],
      keywords: [
        "aplikasi performance appraisal", // Keyword baru 1
        "software reimbursement", // Keyword baru 2
      ],
    });

    expect(result.id).toBe("b-4");
    expect(result.name).toBe("Batch 4 - New Generation");
    expect(result.order_index).toBe(4);
    expect(result.keywordsCount).toBe(3);

    // Keyword unassigned (k-6) berhasil ditautkan ke batch baru (b-4)
    expect(k6?.batch_id).toBe("b-4");

    // Keyword baru harus terdaftar di tabel keywords dengan batch_id b-4 dan active = true
    const newKw1 = ctx.keywords.find(
      (k) => k.text === "aplikasi performance appraisal"
    );
    expect(newKw1).toBeDefined();
    expect(newKw1?.batch_id).toBe("b-4");
    expect(newKw1?.active).toBe(true);

    const newKw2 = ctx.keywords.find(
      (k) => k.text === "software reimbursement"
    );
    expect(newKw2).toBeDefined();
    expect(newKw2?.batch_id).toBe("b-4");
    expect(newKw2?.active).toBe(true);
  });

  it("11. createKeywordBatch MENOLAK seleksi keyword yang sudah masuk ke batch lain", async () => {
    // k-1 ("software hris") sudah masuk di b-1
    expect(ctx.keywords[0].batch_id).toBe("b-1");

    // Coba buat batch baru dengan memilih k-1
    await expect(
      createKeywordBatch(ctx.client, {
        name: "Batch Invalid Selection",
        keywordIds: ["k-1"],
      })
    ).rejects.toThrowError(
      /Tidak dapat memilih keyword yang sudah masuk ke batch lain/
    );

    // Pastikan k-1 tetap berada di b-1 dan tidak berpindah
    expect(ctx.keywords[0].batch_id).toBe("b-1");
  });

  it("12. listKeywordsForBatchSelection membaca daftar seluruh keyword dan membedakan batch yang aktif/unassigned", async () => {
    const list = await listKeywordsForBatchSelection(ctx.client);
    expect(list.length).toBeGreaterThanOrEqual(6);

    const kw1 = list.find((k) => k.id === "k-1");
    expect(kw1?.batch_id).toBe("b-1");
    expect(kw1?.batch_name).toBe("Batch 1");

    const kw6 = list.find((k) => k.id === "k-6");
    expect(kw6?.batch_id).toBeNull();
    expect(kw6?.batch_name).toBeNull();
  });
});
