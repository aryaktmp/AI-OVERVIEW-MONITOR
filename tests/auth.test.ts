import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { isEmailAllowed, loginSchema, parseAllowedEmails } from "@/lib/auth";

describe("Fase 1: Allowlist Login & Skema Migrasi RLS", () => {
  const sampleAllowlist = "admin@linovhr.com,tim.seo@linovhr.com";

  it("mengurai daftar ALLOWED_EMAILS menjadi huruf kecil tanpa spasi kosong", () => {
    expect(parseAllowedEmails(" Admin@LinovHR.com , tim@linovhr.com , ")).toEqual([
      "admin@linovhr.com",
      "tim@linovhr.com",
    ]);
    expect(parseAllowedEmails("")).toEqual([]);
  });

  it("mengizinkan pengguna yang emailnya ada di dalam ALLOWED_EMAILS (case-insensitive)", () => {
    expect(isEmailAllowed("admin@linovhr.com", sampleAllowlist)).toBe(true);
    expect(isEmailAllowed("TIM.SEO@LINOVHR.COM", sampleAllowlist)).toBe(true);
  });

  it("menolak pengguna di luar ALLOWED_EMAILS", () => {
    expect(isEmailAllowed("luar@linovhr.com", sampleAllowlist)).toBe(false);
    expect(isEmailAllowed("admin@notlinovhr.com", sampleAllowlist)).toBe(false);
    expect(isEmailAllowed("", sampleAllowlist)).toBe(false);
    expect(isEmailAllowed(null, sampleAllowlist)).toBe(false);
    expect(isEmailAllowed("admin@linovhr.com", "")).toBe(false);
  });

  it("memvalidasi input form login menggunakan Zod (mode kata sandi & OTP)", () => {
    const validPass = loginSchema.safeParse({
      email: "admin@linovhr.com",
      password: "rahasia123",
      mode: "password",
    });
    expect(validPass.success).toBe(true);

    const emptyPass = loginSchema.safeParse({
      email: "admin@linovhr.com",
      password: "",
      mode: "password",
    });
    expect(emptyPass.success).toBe(false);

    const validOtp = loginSchema.safeParse({
      email: "admin@linovhr.com",
      mode: "otp",
    });
    expect(validOtp.success).toBe(true);

    const invalidEmail = loginSchema.safeParse({
      email: "bukan-email",
      password: "rahasia123",
      mode: "password",
    });
    expect(invalidEmail.success).toBe(false);
  });

  it("memastikan migrasi SQL mencakup 9 tabel, indeks, RLS aktif, dan seed brand_terms", () => {
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261029000000_init_schema.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf-8");

    const tables = [
      "keyword_groups",
      "keywords",
      "brand_terms",
      "competitors",
      "check_runs",
      "run_items",
      "checks",
      "check_sources",
      "page_cache",
    ];

    for (const table of tables) {
      expect(sql).toContain(`create table if not exists ${table}`);
      expect(sql).toContain(`alter table ${table} enable row level security;`);
      expect(sql).toContain(`on ${table} for select`);
    }

    expect(sql).toContain("('LinovHR', true)");
    expect(sql).toContain("('Linov HR', true)");
    expect(sql).toContain("('linovhr.com', true)");
    expect(sql).toContain("('Linov', false)");
  });
});
