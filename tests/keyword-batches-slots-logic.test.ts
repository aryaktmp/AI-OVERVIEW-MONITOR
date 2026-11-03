import { describe, expect, it, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getActiveWeekOfMonth,
  getSlotWeekNumber,
  getMondayOccurrenceOfMonth,
  getMonthlyRunCount,
  getBatchScheduleSlots,
  syncDefaultScheduleSlots,
  assignBatchToSlot,
  resetSlotsToDefault,
  rotateActiveBatchBySlot,
  type KeywordBatchRecord,
  type BatchScheduleSettingsRecord,
  type BatchScheduleSlotRecord,
  type BatchAuditLogRecord,
} from "../lib/keyword-batches";

interface MockCheckRun {
  id: string;
  status: string;
  is_demo: boolean;
  started_at: string;
}

function createMockSupabaseForSlots() {
  const batches: KeywordBatchRecord[] = [
    {
      id: "b-1",
      name: "Batch 1",
      description: "Batch 1 description",
      color: "#3b82f6",
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
      description: "Batch 2 description",
      color: "#10b981",
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
      description: "Batch 3 description",
      color: "#f59e0b",
      order_index: 3,
      is_active: false,
      is_enabled: true,
      is_demo: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
  ];

  let slots: BatchScheduleSlotRecord[] = [
    {
      id: "slot-1",
      week_number: 1,
      batch_id: "b-1",
      is_override: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "slot-2",
      week_number: 2,
      batch_id: "b-2",
      is_override: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "slot-3",
      week_number: 3,
      batch_id: "b-3",
      is_override: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "slot-4",
      week_number: 4,
      batch_id: "b-1",
      is_override: false,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
  ];

  const settings: BatchScheduleSettingsRecord = {
    id: 1,
    mode: "auto",
    max_runs_per_month: 4,
    override_until: null,
    updated_at: "2026-11-01T00:00:00Z",
  };

  const auditLogs: BatchAuditLogRecord[] = [];
  const checkRuns: MockCheckRun[] = [];

  const client = {
    from: (table: string) => {
      let filterId: string | number | null = null;
      let filterWeekNumber: number | null = null;
      let filterStatus: string | null = null;
      let filterIsDemo: boolean | null = null;
      let filterGteStartedAt: string | null = null;
      let filterLteStartedAt: string | null = null;
      let filterIsActive: boolean | null = null;

      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          if (col === "id") filterId = val as string | number;
          if (col === "week_number") filterWeekNumber = val as number;
          if (col === "status") filterStatus = val as string;
          if (col === "is_demo") filterIsDemo = val as boolean;
          if (col === "is_active") filterIsActive = val as boolean;
          return builder;
        },
        gte: (col: string, val: unknown) => {
          if (col === "started_at") filterGteStartedAt = val as string;
          return builder;
        },
        lte: (col: string, val: unknown) => {
          if (col === "started_at") filterLteStartedAt = val as string;
          return builder;
        },
        neq: () => builder,
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
          if (table === "batch_schedule_slots") {
            const found = slots.find((s) => s.week_number === filterWeekNumber || s.id === filterId);
            return { data: found ? { ...found } : null, error: found ? null : { message: "Not found" } };
          }
          return { data: null, error: null };
        },
        then: (resolve: (val: unknown) => unknown) => {
          if (table === "batch_schedule_slots") {
            const res = slots
              .filter((s) => filterWeekNumber === null || s.week_number === filterWeekNumber)
              .sort((a, b) => a.week_number - b.week_number);
            return Promise.resolve(resolve({ data: res.map((s) => ({ ...s })), error: null }));
          }
          if (table === "keyword_batches") {
            const res = batches.filter((b) => {
              if (filterIsActive !== null && b.is_active !== filterIsActive) return false;
              if (filterId !== null && b.id !== filterId) return false;
              return true;
            });
            return Promise.resolve(resolve({ data: res.map((b) => ({ ...b })), error: null }));
          }
          if (table === "check_runs") {
            const res = checkRuns.filter((r) => {
              if (filterStatus !== null && r.status !== filterStatus) return false;
              if (filterIsDemo !== null && r.is_demo !== filterIsDemo) return false;
              if (filterGteStartedAt !== null && r.started_at < filterGteStartedAt) return false;
              if (filterLteStartedAt !== null && r.started_at > filterLteStartedAt) return false;
              return true;
            });
            return Promise.resolve(resolve({ data: res.map((r) => ({ ...r })), error: null }));
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
          if (table === "batch_schedule_slots") {
            const row = { id: `slot-${slots.length + 1}`, ...(data as Record<string, unknown>) } as BatchScheduleSlotRecord;
            slots.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { ...row }, error: null }),
              }),
            };
          }
          return Promise.resolve({ data, error: null });
        },
        update: (payload: Record<string, unknown>) => {
          return {
            eq: (col: string, val: unknown) => {
              if (table === "batch_schedule_slots" && col === "week_number") {
                const target = slots.find((s) => s.week_number === val);
                if (target) Object.assign(target, payload);
              }
              if (table === "keyword_batches" && col === "id") {
                const target = batches.find((b) => b.id === val);
                if (target) Object.assign(target, payload);
              }
              if (table === "batch_schedule_settings" && col === "id") {
                Object.assign(settings, payload);
              }
              return {
                select: () => ({
                  single: async () => ({ data: payload, error: null }),
                }),
                then: (resolve: (val: unknown) => unknown) => {
                  return Promise.resolve(resolve({ data: null, error: null }));
                },
              };
            },
            gte: () => ({
              lte: () => {
                if (table === "batch_schedule_slots") {
                  for (const s of slots) {
                    Object.assign(s, payload);
                  }
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
            neq: () => {
              if (table === "batch_schedule_slots") {
                for (const s of slots) {
                  Object.assign(s, payload);
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

  return { client, batches, slots, settings, auditLogs, checkRuns };
}

describe("Fase Logika: Penjadwalan 4 Slot Mingguan & Batas 4 Eksekusi Bulanan", () => {
  let ctx: ReturnType<typeof createMockSupabaseForSlots>;

  beforeEach(() => {
    ctx = createMockSupabaseForSlots();
  });

  it("1. getActiveWeekOfMonth menghitung minggu berbasis hari Senin dan mengarahkan hari sebelum Senin pertama ke Week 0", () => {
    // 1 November 2026 adalah hari Minggu sebelum Senin pertama (pra-siklus)
    expect(getActiveWeekOfMonth(new Date("2026-11-01"))).toBe(0);
    expect(getSlotWeekNumber(new Date("2026-11-01"))).toBe(4);

    // Week 1 dimulai pada Senin pertama (2 November 2026) s/d Minggu (8 November 2026)
    expect(getActiveWeekOfMonth(new Date("2026-11-02"))).toBe(1); // Senin ke-1
    expect(getActiveWeekOfMonth(new Date("2026-11-05"))).toBe(1); // Kamis
    expect(getActiveWeekOfMonth(new Date("2026-11-08"))).toBe(1); // Minggu (masih Week 1, bukan Week 2!)

    // Week 2 dimulai pada Senin kedua (9 November 2026) s/d Minggu (15 November 2026)
    expect(getActiveWeekOfMonth(new Date("2026-11-09"))).toBe(2); // Senin ke-2
    expect(getActiveWeekOfMonth(new Date("2026-11-15"))).toBe(2); // Minggu (masih Week 2, bukan Week 3!)

    // Week 3 dimulai pada Senin ketiga (16 November 2026) s/d Minggu (22 November 2026)
    expect(getActiveWeekOfMonth(new Date("2026-11-16"))).toBe(3);
    expect(getActiveWeekOfMonth(new Date("2026-11-22"))).toBe(3);

    // Week 4 dimulai pada Senin keempat (23 November 2026) s/d Minggu (29 November 2026)
    expect(getActiveWeekOfMonth(new Date("2026-11-23"))).toBe(4);
    expect(getActiveWeekOfMonth(new Date("2026-11-29"))).toBe(4);

    // Senin ke-5 (30 November 2026)
    expect(getActiveWeekOfMonth(new Date("2026-11-30"))).toBe(5);
    expect(getSlotWeekNumber(new Date("2026-11-30"))).toBe(1); // Wrap-around ke Slot 1
  });

  it("2. syncDefaultScheduleSlots menerapkan pola rotasi: looping saat batch < 4", async () => {
    // Awal: 3 batch (b-1, b-2, b-3)
    await syncDefaultScheduleSlots(ctx.client);
    const slots = await getBatchScheduleSlots(ctx.client);

    expect(slots).toHaveLength(4);
    expect(slots[0].week_number).toBe(1);
    expect(slots[0].batch?.name).toBe("Batch 1");
    expect(slots[1].week_number).toBe(2);
    expect(slots[1].batch?.name).toBe("Batch 2");
    expect(slots[2].week_number).toBe(3);
    expect(slots[2].batch?.name).toBe("Batch 3");
    expect(slots[3].week_number).toBe(4);
    // Aturan spesifikasi: Jika batch < 4, ulangi dari batch pertama setelah habis
    expect(slots[3].batch?.name).toBe("Batch 1");
  });

  it("3. syncDefaultScheduleSlots menerapkan pola rotasi: 4 batch pertama saat batch > 4", async () => {
    // Tambahkan Batch 4 dan Batch 5
    ctx.batches.push(
      {
        id: "b-4",
        name: "Batch 4",
        description: null,
        color: "#8b5cf6",
        order_index: 4,
        is_active: false,
        is_enabled: true,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
      {
        id: "b-5",
        name: "Batch 5",
        description: null,
        color: "#ec4899",
        order_index: 5,
        is_active: false,
        is_enabled: true,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      }
    );

    await syncDefaultScheduleSlots(ctx.client);
    const slots = await getBatchScheduleSlots(ctx.client);

    expect(slots).toHaveLength(4);
    expect(slots[0].batch?.name).toBe("Batch 1");
    expect(slots[1].batch?.name).toBe("Batch 2");
    expect(slots[2].batch?.name).toBe("Batch 3");
    // Aturan spesifikasi: Jika batch > 4, gunakan 4 batch pertama secara berurutan
    expect(slots[3].batch?.name).toBe("Batch 4");
  });

  it("4. assignBatchToSlot menetapkan batch ke slot tertentu dan mempertahankan is_override", async () => {
    // Admin secara manual menugaskan Batch 3 ke Slot Week 1
    const res = await assignBatchToSlot(ctx.client, 1, "b-3", true, "admin-user");
    expect(res.ok).toBe(true);

    const slot1 = ctx.slots.find((s) => s.week_number === 1);
    expect(slot1?.batch_id).toBe("b-3");
    expect(slot1?.is_override).toBe(true);

    // Saat syncDefaultScheduleSlots dijalankan, slot yang di-override tidak boleh tertimpa
    await syncDefaultScheduleSlots(ctx.client);
    expect(slot1?.batch_id).toBe("b-3");
    expect(slot1?.is_override).toBe(true);
  });

  it("5. resetSlotsToDefault mereset seluruh slot kembali ke pola bawaan", async () => {
    // Berikan override pada Slot 2
    await assignBatchToSlot(ctx.client, 2, "b-3", true);
    expect(ctx.slots.find((s) => s.week_number === 2)?.is_override).toBe(true);

    // Reset ke bawaan
    const resetRes = await resetSlotsToDefault(ctx.client);
    expect(resetRes.ok).toBe(true);
    expect(ctx.slots.find((s) => s.week_number === 2)?.is_override).toBe(false);
    expect(ctx.slots.find((s) => s.week_number === 2)?.batch_id).toBe("b-2");
  });

  it("6. rotateActiveBatchBySlot mengaktifkan batch sesuai slot minggu kalender", async () => {
    // Uji tanggal 10 November (Week 2: slot 2 menunjuk ke b-2 / Batch 2)
    const testDate = new Date("2026-11-10T08:00:00Z");
    const res = await rotateActiveBatchBySlot(ctx.client, { now: testDate });

    expect(res.status).toBe("rotated");
    expect(res.newBatch?.id).toBe("b-2");
    expect(ctx.batches.find((b) => b.id === "b-2")?.is_active).toBe(true);
    expect(ctx.batches.find((b) => b.id === "b-1")?.is_active).toBe(false);
  });

  it("7. rotateActiveBatchBySlot membatasi maksimal 4 eksekusi per bulan (skipped_monthly_limit)", async () => {
    // Simulasikan 4 run yang telah sukses berjalan pada bulan November 2026
    for (let i = 1; i <= 4; i++) {
      ctx.checkRuns.push({
        id: `run-nov-${i}`,
        status: "completed",
        is_demo: false,
        started_at: `2026-11-${String(i * 7).padStart(2, "0")}T08:00:00Z`,
      });
    }

    const testDate = new Date("2026-11-29T08:00:00Z"); // Senin ke-5
    const res = await rotateActiveBatchBySlot(ctx.client, { now: testDate });

    expect(res.status).toBe("skipped_monthly_limit");
    expect(res.message).toContain("4/4");

    // Jika dipaksa (force: true), batas bulanan dilewati
    const forceRes = await rotateActiveBatchBySlot(ctx.client, { now: testDate, force: true });
    expect(forceRes.status).toBe("rotated");
  });

  it("8. getMonthlyRunCount menghitung jumlah run non-demo dalam bulan berjalan", async () => {
    ctx.checkRuns.push(
      { id: "r1", status: "completed", is_demo: false, started_at: "2026-11-02T01:00:00Z" },
      { id: "r2", status: "completed", is_demo: false, started_at: "2026-11-09T01:00:00Z" },
      { id: "r-demo", status: "completed", is_demo: true, started_at: "2026-11-10T01:00:00Z" }, // diabaikan karena demo
      { id: "r-oct", status: "completed", is_demo: false, started_at: "2026-10-25T01:00:00Z" } // diabaikan karena bulan Oktober
    );

    const countNov = await getMonthlyRunCount(ctx.client, new Date("2026-11-15T00:00:00Z"));
    expect(countNov).toBe(2);

    const countOct = await getMonthlyRunCount(ctx.client, new Date("2026-10-30T00:00:00Z"));
    expect(countOct).toBe(1);
  });

  it("9. getMondayOccurrenceOfMonth mendeteksi Senin ke-1 s/d Senin ke-5 serta total Senin per bulan", () => {
    // 2 November 2026: Senin pertama
    const mon1 = getMondayOccurrenceOfMonth(new Date("2026-11-02T10:00:00Z"));
    expect(mon1.occurrence).toBe(1);
    expect(mon1.isMonday).toBe(true);
    expect(mon1.totalMondays).toBe(5);
    expect(mon1.label).toContain("Monday #1 of November 2026");
    expect(mon1.formattedWib).toContain("Senin ke-1 (November 2026)");

    // 9 November 2026: Senin kedua
    const mon2 = getMondayOccurrenceOfMonth(new Date("2026-11-09T10:00:00Z"));
    expect(mon2.occurrence).toBe(2);
    expect(mon2.isMonday).toBe(true);

    // 30 November 2026: Senin kelima (bulan 5 minggu)
    const mon5 = getMondayOccurrenceOfMonth(new Date("2026-11-30T10:00:00Z"));
    expect(mon5.occurrence).toBe(5);
    expect(mon5.isMonday).toBe(true);
    expect(mon5.label).toContain("Monday #5 of November 2026");
  });

  it("10. rotateActiveBatchBySlot mengizinkan rotasi tanpa batas saat enforceMonthlyLimit: false", async () => {
    // Simulasikan sudah ada 4 run pada bulan berjalan
    for (let i = 1; i <= 4; i++) {
      ctx.checkRuns.push({
        id: `run-limit-${i}`,
        status: "completed",
        is_demo: false,
        started_at: `2026-11-${String(i * 7).padStart(2, "0")}T08:00:00Z`,
      });
    }

    // Hari Senin ke-5: 30 November
    const testDate = new Date("2026-11-30T08:00:00Z");

    // Jika enforceMonthlyLimit: false, rotasi tetap berjalan mulus tanpa skipped_monthly_limit
    const res = await rotateActiveBatchBySlot(ctx.client, {
      now: testDate,
      enforceMonthlyLimit: false,
    });

    expect(res.status).toBe("rotated");
    expect(res.newBatch).toBeDefined();
  });
});
