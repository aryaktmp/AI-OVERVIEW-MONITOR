import { describe, it, expect } from "vitest";
import { envSchema } from "@/lib/env";
import { cn } from "@/lib/utils";

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
    expect(parsed.ALLOWED_EMAILS).toBe("");
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
});
