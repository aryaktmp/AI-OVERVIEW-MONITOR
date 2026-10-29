import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { envSchema } from "@/lib/env";
import { cn } from "@/lib/utils";
import { DEFAULT_SEARCH_SETTINGS } from "@/lib/dashboard-data";

/**
 * Memeriksa kumpulan isi file migrasi SQL dan mengembalikan daftar nama fungsi
 * di schema public yang dibuat dengan CREATE [OR REPLACE] FUNCTION tetapi tidak memiliki
 * pernyataan REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated.
 */
function findPublicFunctionsWithoutRevokeExecute(
  sqlDocuments: Array<{ fileName: string; content: string }>
): string[] {
  const createdPublicFunctions = new Set<string>();
  const revokedFunctions = new Set<string>();

  const createFnRegex =
    /create\s+(?:or\s+replace\s+)?function\s+(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)\s*\(/gi;
  const revokeExecRegex =
    /revoke\s+execute\s+on\s+function\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/gi;

  for (const doc of sqlDocuments) {
    const cleanSql = doc.content.replace(/--.*$/gm, "");

    let createMatch: RegExpExecArray | null;
    createFnRegex.lastIndex = 0;
    while ((createMatch = createFnRegex.exec(cleanSql)) !== null) {
      const schemaName = (createMatch[1] ?? "public").toLowerCase();
      const fnName = createMatch[2]!.toLowerCase();
      if (schemaName === "public") {
        createdPublicFunctions.add(fnName);
      }
    }

    let revokeMatch: RegExpExecArray | null;
    revokeExecRegex.lastIndex = 0;
    while ((revokeMatch = revokeExecRegex.exec(cleanSql)) !== null) {
      const fnName = revokeMatch[1]!.toLowerCase();
      revokedFunctions.add(fnName);
    }
  }

  return Array.from(createdPublicFunctions).filter(
    (fn) => !revokedFunctions.has(fn)
  );
}

describe("Fase 0: Fondasi & Konfigurasi", () => {
  it("menggabungkan class Tailwind dengan benar melalui cn()", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("memvalidasi variabel lingkungan dengan SUPABASE_PUBLISHABLE_KEY dan SUPABASE_SECRET_KEY", () => {
    const parsed = envSchema.parse({
      SERPAPI_KEY: "test_serp_key",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
      SUPABASE_SECRET_KEY: "sb_secret_test_key",
      CRON_SECRET: "test_cron_secret",
    });

    expect(parsed.SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_test_key");
    expect(parsed.SUPABASE_SECRET_KEY).toBe("sb_secret_test_key");
    expect(parsed.BRAND_DOMAIN).toBe("linovhr.com");
    expect(parsed.SERPAPI_MAX_PER_HOUR).toBe(50);
    expect(parsed.SERPAPI_DRY_RUN).toBe(true);
    expect(parsed.ALLOWED_EMAILS).toBe("");
  });

  it("memvalidasi SERPAPI_DRY_RUN pada envSchema mendelegasikan ke isDryRun tanpa default ganda", () => {
    const parsedReal = envSchema.parse({
      SERPAPI_KEY: "test_serp_key",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
      SUPABASE_SECRET_KEY: "sb_secret_test_key",
      CRON_SECRET: "test_cron_secret",
      SERPAPI_DRY_RUN: "false",
    });
    expect(parsedReal.SERPAPI_DRY_RUN).toBe(false);

    const parsedDry = envSchema.parse({
      SERPAPI_KEY: "test_serp_key",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
      SUPABASE_SECRET_KEY: "sb_secret_test_key",
      CRON_SECRET: "test_cron_secret",
      SERPAPI_DRY_RUN: "1",
    });
    expect(parsedDry.SERPAPI_DRY_RUN).toBe(true);
  });

  it("menolak variabel lingkungan jika URL Supabase tidak valid", () => {
    const result = envSchema.safeParse({
      SERPAPI_KEY: "test_serp_key",
      SUPABASE_URL: "bukan-url",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
      SUPABASE_SECRET_KEY: "sb_secret_test_key",
      CRON_SECRET: "test_cron_secret",
    });

    expect(result.success).toBe(false);
  });

  it("memastikan nilai awal enable_third_party_check adalah false di kode dan migrasi terbaru", () => {
    expect(DEFAULT_SEARCH_SETTINGS.enable_third_party_check).toBe(false);

    const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

    const phase5Sql = fs.readFileSync(
      path.join(migrationsDir, "20261029050000_phase5_third_party_default.sql"),
      "utf-8"
    );
    expect(phase5Sql).toContain('"enable_third_party_check": false');
    expect(phase5Sql).toContain("'false'::jsonb");

    const predeploySql = fs.readFileSync(
      path.join(migrationsDir, "20261029060000_predeploy_hardening.sql"),
      "utf-8"
    );
    expect(predeploySql).toContain('"enable_third_party_check": false');
    expect(predeploySql).toContain("'false'::jsonb");
  });

  it("membaca semua file migrasi dan gagal jika ada CREATE FUNCTION di schema public tanpa REVOKE EXECUTE untuk fungsi itu", () => {
    const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    expect(sqlFiles.length).toBeGreaterThanOrEqual(7);

    const docs = sqlFiles.map((fileName) => ({
      fileName,
      content: fs.readFileSync(path.join(migrationsDir, fileName), "utf-8"),
    }));

    const missingRevokes = findPublicFunctionsWithoutRevokeExecute(docs);
    expect(
      missingRevokes,
      `Fungsi di schema public tanpa REVOKE EXECUTE: ${missingRevokes.join(", ")}`
    ).toEqual([]);

    // Pastikan detektor benar-benar gagal jika ada CREATE FUNCTION di schema public tanpa REVOKE EXECUTE
    const simulatedUnsafeDocs = [
      ...docs,
      {
        fileName: "99999999999999_unsafe.sql",
        content: `
          create or replace function public.unsafe_helper_fn()
          returns int language sql as $$ select 1; $$;
        `,
      },
    ];
    expect(
      findPublicFunctionsWithoutRevokeExecute(simulatedUnsafeDocs)
    ).toEqual(["unsafe_helper_fn"]);
  });
});
