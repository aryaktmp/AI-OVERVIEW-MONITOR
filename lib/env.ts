import { z } from "zod";

export const envSchema = z.object({
  SERPAPI_KEY: z.string().min(1, "SERPAPI_KEY wajib diisi"),
  SUPABASE_URL: z.string().url("SUPABASE_URL harus berupa URL valid"),
  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "SUPABASE_PUBLISHABLE_KEY wajib diisi"),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1, "SUPABASE_SECRET_KEY wajib diisi"),
  CRON_SECRET: z.string().min(1, "CRON_SECRET wajib diisi"),
  BRAND_DOMAIN: z.string().min(1).default("linovhr.com"),
  SERPAPI_MAX_PER_HOUR: z.coerce.number().int().positive().default(50),
  SERPAPI_DRY_RUN: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  ALLOWED_EMAILS: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  return envSchema.parse(process.env);
}
