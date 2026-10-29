import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { clearAllDemoData } from "../lib/demo-data.ts";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    console.error("SUPABASE_URL dan SUPABASE_SECRET_KEY wajib diisi di .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Menghapus Data Contoh di Keempat Tabel (is_demo = true) ===");

  const res = await clearAllDemoData(supabase);

  console.log(
    `Selesai menghapus data contoh di check_runs (${res.deletedRunsCount} run), keywords, keyword_groups, dan competitors.`
  );
}

main().catch((err) => {
  console.error("Gagal menjalankan seed:clear:", err);
  process.exit(1);
});
