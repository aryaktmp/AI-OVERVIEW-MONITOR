// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

describe("Fase Data: Sistem Batch Keyword dan Penjadwalan Mingguan", () => {
  const rootDir = process.cwd();
  const migrationsDir = path.join(rootDir, "supabase", "migrations");
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();

    // Stub peran dasar Supabase
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
    );
    await db.exec(
      "CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE auth.users (id uuid primary key, email text, created_at timestamptz default now());"
    );

    // Jalankan seluruh migrasi secara berurutan
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const f of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), "utf-8");
      try {
        await db.exec(sql);
      } catch (e: unknown) {
        const errMessage = e instanceof Error ? e.message : String(e);
        if (f.includes("000000") && errMessage.includes("pgcrypto")) {
          const withoutExt = sql.replace(/create extension [^;]+;/gi, "");
          await db.exec(withoutExt);
        } else {
          throw e;
        }
      }
    }
  });

  it("membuat tabel keyword_batches dengan kolom-kolom yang sesuai dan menginisialisasi 3 batch awal", async () => {
    const batches = await db.query<{
      id: string;
      name: string;
      order_index: number;
      is_active: boolean;
      is_enabled: boolean;
    }>(
      "SELECT id, name, order_index, is_active, is_enabled FROM public.keyword_batches ORDER BY order_index ASC;"
    );

    expect(batches.rows.length).toBeGreaterThanOrEqual(3);
    expect(batches.rows[0].name).toBe("Batch 1");
    expect(batches.rows[0].order_index).toBe(1);
    expect(batches.rows[0].is_active).toBe(true);

    expect(batches.rows[1].name).toBe("Batch 2");
    expect(batches.rows[1].order_index).toBe(2);
    expect(batches.rows[1].is_active).toBe(false);

    expect(batches.rows[2].name).toBe("Batch 3");
    expect(batches.rows[2].order_index).toBe(3);
    expect(batches.rows[2].is_active).toBe(false);
  });

  it("memastikan tabel keywords memiliki kolom batch_id dan terhubung foreign key ke keyword_batches(id)", async () => {
    const colCheck = await db.query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'keywords' AND column_name = 'batch_id';
    `);

    expect(colCheck.rows.length).toBe(1);
    expect(colCheck.rows[0].column_name).toBe("batch_id");
    expect(colCheck.rows[0].data_type).toBe("uuid");

    // Periksa foreign key constraint
    const fkCheck = await db.query<{ conname: string }>(`
      SELECT con.conname
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_class ref_c ON ref_c.oid = con.confrelid
      WHERE c.relname = 'keywords' 
        AND ref_c.relname = 'keyword_batches' 
        AND con.contype = 'f';
    `);

    expect(fkCheck.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("menghubungkan keyword ke batch dan mendukung on delete set null ketika batch dihapus", async () => {
    // 1. Buat batch uji coba
    const createBatchRes = await db.query<{ id: string }>(`
      INSERT INTO public.keyword_batches (name, order_index, is_active, is_enabled)
      VALUES ('Batch Test Deletion', 999, false, true)
      RETURNING id;
    `);
    const testBatchId = createBatchRes.rows[0].id;

    // 2. Buat keyword uji coba yang menunjuk ke batch ini
    const createKwRes = await db.query<{ id: string; batch_id: string }>(`
      INSERT INTO public.keywords (text, batch_id, active)
      VALUES ('keyword test for batch deletion', '${testBatchId}', true)
      RETURNING id, batch_id;
    `);
    const kwId = createKwRes.rows[0].id;
    expect(createKwRes.rows[0].batch_id).toBe(testBatchId);

    // 3. Hapus batch uji coba
    await db.query(`DELETE FROM public.keyword_batches WHERE id = '${testBatchId}';`);

    // 4. Pastikan batch_id pada keyword berubah menjadi NULL tanpa menghapus keyword
    const kwAfter = await db.query<{ batch_id: string | null }>(`
      SELECT batch_id FROM public.keywords WHERE id = '${kwId}';
    `);
    expect(kwAfter.rows.length).toBe(1);
    expect(kwAfter.rows[0].batch_id).toBeNull();

    // Bersihkan keyword uji coba
    await db.query(`DELETE FROM public.keywords WHERE id = '${kwId}';`);
  });

  it("mencegah dua batch memiliki status is_active = true secara bersamaan melalui indeks unik parsial", async () => {
    // Di inisialisasi, Batch 1 sudah is_active = true.
    // Menambahkan atau mengupdate batch lain menjadi is_active = true tanpa menonaktifkan Batch 1 harus melempar error unik.
    await expect(
      db.query(`
        INSERT INTO public.keyword_batches (name, order_index, is_active, is_enabled)
        VALUES ('Batch Duplicate Active', 100, true, true);
      `)
    ).rejects.toThrow();
  });

  it("membuat tabel batch_schedule_settings dengan konfigurasi default 'auto'", async () => {
    const settings = await db.query<{ id: number; mode: string }>(
      "SELECT id, mode FROM public.batch_schedule_settings WHERE id = 1;"
    );

    expect(settings.rows.length).toBe(1);
    expect(settings.rows[0].id).toBe(1);
    expect(settings.rows[0].mode).toBe("auto");
  });

  it("membuat tabel batch_audit_logs dan merekam log inisialisasi awal", async () => {
    const logs = await db.query<{
      id: string;
      trigger_type: string;
      actor_id: string;
      notes: string;
    }>(
      "SELECT id, trigger_type, actor_id, notes FROM public.batch_audit_logs ORDER BY created_at DESC;"
    );

    expect(logs.rows.length).toBeGreaterThanOrEqual(1);
    const initialLog = logs.rows.find((l) => l.trigger_type === "initial_setup");
    expect(initialLog).toBeDefined();
    expect(initialLog?.actor_id).toBe("system");
  });

  it("membuat tabel batch_schedule_slots dengan 4 slot bulanan dan relasi ke keyword_batches", async () => {
    const slots = await db.query<{
      id: string;
      week_number: number;
      batch_id: string | null;
      is_override: boolean;
      batch_name: string | null;
    }>(`
      SELECT s.id, s.week_number, s.batch_id, s.is_override, b.name as batch_name
      FROM public.batch_schedule_slots s
      LEFT JOIN public.keyword_batches b ON b.id = s.batch_id
      ORDER BY s.week_number ASC;
    `);

    expect(slots.rows.length).toBe(4);
    expect(slots.rows.map((r) => r.week_number)).toEqual([1, 2, 3, 4]);

    // Week 1 -> Batch 1
    expect(slots.rows[0].week_number).toBe(1);
    expect(slots.rows[0].batch_name).toBe("Batch 1");
    expect(slots.rows[0].is_override).toBe(false);

    // Week 2 -> Batch 2
    expect(slots.rows[1].week_number).toBe(2);
    expect(slots.rows[1].batch_name).toBe("Batch 2");

    // Week 3 -> Batch 3
    expect(slots.rows[2].week_number).toBe(3);
    expect(slots.rows[2].batch_name).toBe("Batch 3");

    // Week 4 -> Batch 4
    expect(slots.rows[3].week_number).toBe(4);
    expect(slots.rows[3].batch_name).toBe("Batch 4");
  });

  it("menegakkan batasan check week_number antara 1 dan 4 pada batch_schedule_slots", async () => {
    // Memasukkan week_number = 5 harus gagal karena check constraint (week_number between 1 and 4)
    await expect(
      db.query(`
        INSERT INTO public.batch_schedule_slots (week_number, is_override)
        VALUES (5, false);
      `)
    ).rejects.toThrow();

    // Memasukkan week_number = 0 juga harus gagal
    await expect(
      db.query(`
        INSERT INTO public.batch_schedule_slots (week_number, is_override)
        VALUES (0, false);
      `)
    ).rejects.toThrow();
  });

  it("memastikan kolom color pada keyword_batches dan max_runs_per_month pada batch_schedule_settings tersedia", async () => {
    const batchCol = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'keyword_batches' AND column_name = 'color';
    `);
    expect(batchCol.rows.length).toBe(1);

    const settingsCol = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'batch_schedule_settings' AND column_name = 'max_runs_per_month';
    `);
    expect(settingsCol.rows.length).toBe(1);

    const settingsData = await db.query<{ max_runs_per_month: number }>(`
      SELECT max_runs_per_month FROM public.batch_schedule_settings WHERE id = 1;
    `);
    expect(settingsData.rows[0].max_runs_per_month).toBe(4);
  });
});
