import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

interface CheckResult {
  check: string;
  status: CheckStatus;
  detail: string;
}

const results: CheckResult[] = [];

function addResult(check: string, status: CheckStatus, detail: string) {
  results.push({ check, status, detail });
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};
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
    env[key] = val;
  }
  return env;
}

function isJwtFormat(value: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function walkSourceFiles(dir: string, fileList: string[] = []): string[] {
  const ignoredDirs = new Set([
    "node_modules",
    ".next",
    ".git",
    "coverage",
    "dist",
    "build",
  ]);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, fileList);
    } else if (
      /\.(ts|tsx|js|mjs|cjs|json|md|html|css)$/.test(entry.name) &&
      !entry.name.startsWith(".env") &&
      entry.name !== "package-lock.json"
    ) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

async function main() {
  const rootDir = process.cwd();
  const envExamplePath = path.join(rootDir, ".env.example");
  const envLocalPath = path.join(rootDir, ".env.local");

  const exampleEnv = parseEnvFile(envExamplePath);
  const exampleKeys = Object.keys(exampleEnv);

  if (!fs.existsSync(envLocalPath)) {
    addResult(
      "File .env.local tersedia",
      "FAIL",
      "File .env.local tidak ditemukan. Salin .env.example ke .env.local lalu isi nilainya."
    );
  }

  const localEnv = parseEnvFile(envLocalPath);

  // 1. Format: Semua variabel di .env.example ada dan tidak kosong
  const missingKeys: string[] = [];
  const summaryMeta: string[] = [];
  for (const key of exampleKeys) {
    const val = localEnv[key];
    if (val === undefined || val === "") {
      missingKeys.push(key);
    } else {
      summaryMeta.push(`${key}: terisi (${val.length} karakter)`);
    }
  }

  const legacyKeysPresent = [
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((k) => k in localEnv);

  if (missingKeys.length > 0) {
    const extraHint =
      legacyKeysPresent.length > 0
        ? ` Ganti nama ${legacyKeysPresent.join(", ")} di .env.local menjadi SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY.`
        : "";
    addResult(
      "Format: Variabel .env.example lengkap",
      "FAIL",
      `Variabel belum diisi di .env.local: ${missingKeys.join(", ")}.${extraHint}`
    );
  } else {
    addResult(
      "Format: Variabel .env.example lengkap",
      "PASS",
      `Semua ${exampleKeys.length} variabel terisi (${summaryMeta.join("; ")})`
    );
  }

  // 2. Format: SUPABASE_URL
  const supabaseUrl = localEnv["SUPABASE_URL"] ?? "";
  if (
    supabaseUrl.startsWith("https://") &&
    supabaseUrl.endsWith(".supabase.co") &&
    supabaseUrl.length > "https://.supabase.co".length
  ) {
    addResult(
      "Format: SUPABASE_URL",
      "PASS",
      `terisi (${supabaseUrl.length} karakter), diawali https:// dan diakhiri .supabase.co`
    );
  } else {
    addResult(
      "Format: SUPABASE_URL",
      "FAIL",
      "SUPABASE_URL harus diawali https:// dan diakhiri .supabase.co (contoh: https://<project-ref>.supabase.co)"
    );
  }

  // 3. Format: SUPABASE_PUBLISHABLE_KEY
  const pubKey = localEnv["SUPABASE_PUBLISHABLE_KEY"] ?? "";
  if (pubKey.startsWith("sb_publishable_")) {
    addResult(
      "Format: SUPABASE_PUBLISHABLE_KEY",
      "PASS",
      `terisi (${pubKey.length} karakter), format kunci baru (sb_publishable_...)`
    );
  } else if (isJwtFormat(pubKey)) {
    addResult(
      "Format: SUPABASE_PUBLISHABLE_KEY",
      "PASS",
      `terisi (${pubKey.length} karakter), format JWT legacy`
    );
  } else {
    addResult(
      "Format: SUPABASE_PUBLISHABLE_KEY",
      "FAIL",
      "SUPABASE_PUBLISHABLE_KEY harus diawali sb_publishable_ (atau format JWT). Perbarui dari Supabase Dashboard > Project Settings > API Keys."
    );
  }

  // 4. Format: SUPABASE_SECRET_KEY
  const secKey = localEnv["SUPABASE_SECRET_KEY"] ?? "";
  if (secKey.startsWith("sb_secret_")) {
    addResult(
      "Format: SUPABASE_SECRET_KEY",
      "PASS",
      `terisi (${secKey.length} karakter), format kunci baru (sb_secret_...)`
    );
  } else if (isJwtFormat(secKey)) {
    addResult(
      "Format: SUPABASE_SECRET_KEY",
      "PASS",
      `terisi (${secKey.length} karakter), format JWT legacy`
    );
  } else {
    addResult(
      "Format: SUPABASE_SECRET_KEY",
      "FAIL",
      "SUPABASE_SECRET_KEY harus diawali sb_secret_ (atau format JWT). Perbarui dari Supabase Dashboard > Project Settings > API Keys."
    );
  }

  // 5. Format: Kunci publishable dan secret tidak boleh sama
  if (pubKey && secKey && pubKey !== secKey) {
    addResult(
      "Format: Kunci publishable != secret",
      "PASS",
      "SUPABASE_PUBLISHABLE_KEY dan SUPABASE_SECRET_KEY berbeda"
    );
  } else {
    addResult(
      "Format: Kunci publishable != secret",
      "FAIL",
      "SUPABASE_PUBLISHABLE_KEY dan SUPABASE_SECRET_KEY tidak boleh sama atau kosong. Gunakan masing-masing kunci yang sesuai dari Supabase Dashboard."
    );
  }

  // 6. Format: CRON_SECRET minimal 32 karakter
  const cronSecret = localEnv["CRON_SECRET"] ?? "";
  if (cronSecret.length >= 32) {
    addResult(
      "Format: CRON_SECRET",
      "PASS",
      `terisi (${cronSecret.length} karakter, >= 32 karakter)`
    );
  } else {
    addResult(
      "Format: CRON_SECRET",
      "FAIL",
      `CRON_SECRET saat ini ${cronSecret.length} karakter (minimal 32 karakter). Buat string acak minimal 32 karakter (misal: openssl rand -hex 32).`
    );
  }

  // 7. Format: BRAND_DOMAIN berupa hostname saja, tanpa http dan tanpa garis miring
  const brandDomain = localEnv["BRAND_DOMAIN"] ?? "";
  const isValidHostname =
    brandDomain.length > 0 &&
    !brandDomain.includes("http") &&
    !brandDomain.includes("/") &&
    !brandDomain.includes(":") &&
    /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(brandDomain);
  if (isValidHostname) {
    addResult(
      "Format: BRAND_DOMAIN",
      "PASS",
      `terisi (${brandDomain.length} karakter), berupa hostname valid tanpa protokol/garis miring`
    );
  } else {
    addResult(
      "Format: BRAND_DOMAIN",
      "FAIL",
      "BRAND_DOMAIN harus berupa hostname saja tanpa http://, https://, atau garis miring (contoh: linovhr.com)."
    );
  }

  // 8. Format: SERPAPI_MAX_PER_HOUR berupa bilangan bulat positif
  const maxPerHourRaw = localEnv["SERPAPI_MAX_PER_HOUR"] ?? "";
  const maxPerHour = Number(maxPerHourRaw);
  if (/^\d+$/.test(maxPerHourRaw) && Number.isInteger(maxPerHour) && maxPerHour > 0) {
    addResult(
      "Format: SERPAPI_MAX_PER_HOUR",
      "PASS",
      `terisi (${maxPerHourRaw.length} karakter), bilangan bulat positif`
    );
  } else {
    addResult(
      "Format: SERPAPI_MAX_PER_HOUR",
      "FAIL",
      "SERPAPI_MAX_PER_HOUR harus berupa bilangan bulat positif (contoh: 50 atau 200)."
    );
  }

  // 9. Format: ALLOWED_EMAILS berisi email valid, dipisahkan koma, tanpa spasi
  const allowedEmailsRaw = localEnv["ALLOWED_EMAILS"] ?? "";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const hasSpaces = /\s/.test(allowedEmailsRaw);
  const emailList = allowedEmailsRaw
    ? allowedEmailsRaw.split(",").filter((e) => e.length > 0)
    : [];
  const allEmailsValid =
    emailList.length > 0 &&
    !hasSpaces &&
    !allowedEmailsRaw.includes(",,") &&
    !allowedEmailsRaw.startsWith(",") &&
    !allowedEmailsRaw.endsWith(",") &&
    emailList.every((e) => emailRegex.test(e));

  if (allEmailsValid) {
    addResult(
      "Format: ALLOWED_EMAILS",
      "PASS",
      `terisi (${allowedEmailsRaw.length} karakter, ${emailList.length} email valid tanpa spasi)`
    );
  } else {
    addResult(
      "Format: ALLOWED_EMAILS",
      "FAIL",
      "ALLOWED_EMAILS harus berisi minimal 1 email valid, dipisahkan koma tanpa spasi (contoh: user1@domain.com,user2@domain.com)."
    );
  }

  // 9b. Format/Lingkungan: Peringatan jika SERPAPI_DRY_RUN=true di produksi atau Vercel
  const dryRunVal = (
    localEnv["SERPAPI_DRY_RUN"] ??
    process.env.SERPAPI_DRY_RUN ??
    "false"
  ).toLowerCase();
  const isDryRunActive = dryRunVal === "true" || dryRunVal === "1";
  const isProductionOrVercel =
    process.env.NODE_ENV === "production" ||
    localEnv["NODE_ENV"] === "production" ||
    Boolean(process.env.VERCEL) ||
    Boolean(localEnv["VERCEL"]);

  if (isDryRunActive && isProductionOrVercel) {
    addResult(
      "Lingkungan: SERPAPI_DRY_RUN",
      "WARN",
      "SERPAPI_DRY_RUN=true aktif saat NODE_ENV=production atau di Vercel. Setel SERPAPI_DRY_RUN=false di produksi agar memakai data SerpApi nyata."
    );
  } else {
    addResult(
      "Lingkungan: SERPAPI_DRY_RUN",
      "PASS",
      `SERPAPI_DRY_RUN=${isDryRunActive ? "true (mode lokal/simulasi)" : "false (mode nyata)"}`
    );
  }

  // ============================================================================
  // KONEKSI NYATA
  // ============================================================================

  // 10. Koneksi nyata: Supabase dengan kunci publishable
  if (supabaseUrl && pubKey) {
    try {
      const pubClient = createClient(supabaseUrl, pubKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error, status } = await pubClient
        .from("keywords")
        .select("*")
        .limit(5);

      if (status === 401 || (error && /invalid api key|jwt/i.test(error.message))) {
        addResult(
          "Koneksi: Supabase Publishable Key & RLS",
          "FAIL",
          `Koneksi ditolak (${error?.message ?? "HTTP 401"}). Periksa nilai SUPABASE_PUBLISHABLE_KEY di .env.local.`
        );
      } else if (Array.isArray(data) && data.length > 0) {
        addResult(
          "Koneksi: Supabase Publishable Key & RLS",
          "FAIL",
          `Tabel keywords mengembalikan ${data.length} baris tanpa login! Aktifkan Row Level Security (RLS) pada tabel keywords.`
        );
      } else if (
        error &&
        (/could not find the table|relation .* does not exist|schema cache/i.test(
          error.message
        ) ||
          error.code === "PGRST205" ||
          error.code === "42P01")
      ) {
        addResult(
          "Koneksi: Supabase Publishable Key & RLS",
          "PASS",
          "Koneksi berhasil; baca tabel keywords tanpa login ditolak/kosong (tabel belum ada atau tidak diekspos ke anon)."
        );
      } else if (error) {
        addResult(
          "Koneksi: Supabase Publishable Key & RLS",
          "PASS",
          `Koneksi berhasil; baca tanpa login ditolak (${error.code ?? "RLS"}: ${error.message}).`
        );
      } else {
        addResult(
          "Koneksi: Supabase Publishable Key & RLS",
          "PASS",
          "Koneksi berhasil; baca tabel keywords tanpa login mengembalikan 0 baris (aman)."
        );
      }
    } catch (err) {
      addResult(
        "Koneksi: Supabase Publishable Key & RLS",
        "FAIL",
        `Gagal menghubungi Supabase: ${err instanceof Error ? err.message : String(err)}. Periksa SUPABASE_URL dan koneksi internet.`
      );
    }
  } else {
    addResult(
      "Koneksi: Supabase Publishable Key & RLS",
      "FAIL",
      "SUPABASE_URL atau SUPABASE_PUBLISHABLE_KEY kosong. Isi keduanya di .env.local."
    );
  }

  // 11. Koneksi nyata: Supabase dengan kunci secret (hitung baris di 9 tabel)
  const requiredTables = [
    "keywords",
    "keyword_groups",
    "brand_terms",
    "competitors",
    "check_runs",
    "run_items",
    "checks",
    "check_sources",
    "page_cache",
  ];

  if (supabaseUrl && secKey) {
    try {
      const secClient = createClient(supabaseUrl, secKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const missingTables: string[] = [];
      const tableCounts: string[] = [];
      let authFailMsg = "";

      for (const table of requiredTables) {
        const { count, error, status } = await secClient
          .from(table)
          .select("*", { count: "exact" })
          .limit(0);

        if (status === 401 || (error && /invalid api key|jwt|forbidden/i.test(error.message))) {
          authFailMsg = error?.message ?? `HTTP ${status}`;
          break;
        } else if (error || status === 404) {
          missingTables.push(table);
        } else {
          tableCounts.push(`${table}=${count ?? 0}`);
        }
      }

      if (authFailMsg) {
        addResult(
          "Koneksi: Supabase Secret Key & Tabel",
          "FAIL",
          `Kunci secret ditolak (${authFailMsg}). Periksa SUPABASE_SECRET_KEY di .env.local.`
        );
      } else if (missingTables.length > 0) {
        addResult(
          "Koneksi: Supabase Secret Key & Tabel",
          "FAIL",
          `Migrasi belum diterapkan. Tabel belum ada (${missingTables.length}/9): ${missingTables.join(", ")}. Terapkan migrasi SQL di Supabase SQL Editor (Fase 1).`
        );
      } else {
        addResult(
          "Koneksi: Supabase Secret Key & Tabel",
          "PASS",
          `Semua 9 tabel tersedia (${tableCounts.join(", ")})`
        );
      }

      // 12. Koneksi nyata: Supabase Auth (daftar pengguna vs ALLOWED_EMAILS)
      const { data: authData, error: authError } =
        await secClient.auth.admin.listUsers();

      if (authError) {
        addResult(
          "Koneksi: Supabase Auth vs ALLOWED_EMAILS",
          "FAIL",
          `Gagal mengambil daftar pengguna Auth (${authError.message}). Pastikan SUPABASE_SECRET_KEY memiliki hak admin/service_role.`
        );
      } else {
        const users = authData?.users ?? [];
        const authEmails = new Set(
          users
            .map((u) => (u.email ?? "").toLowerCase())
            .filter((e) => e.length > 0)
        );
        const allowedLower = emailList.map((e) => e.toLowerCase());
        const allowedSet = new Set(allowedLower);

        const missingInAuth = emailList.filter(
          (e) => !authEmails.has(e.toLowerCase())
        );
        const extraInAuth = Array.from(authEmails).filter(
          (e) => !allowedSet.has(e)
        );

        if (missingInAuth.length === 0 && extraInAuth.length === 0) {
          addResult(
            "Koneksi: Supabase Auth vs ALLOWED_EMAILS",
            "PASS",
            `Semua ${emailList.length} email di ALLOWED_EMAILS sudah terdaftar di Supabase Auth dan tidak ada pengguna di luar daftar.`
          );
        } else {
          const warnings: string[] = [];
          if (missingInAuth.length > 0) {
            warnings.push(
              `${missingInAuth.length} email di ALLOWED_EMAILS belum punya pengguna di Supabase Auth (Buat pengguna di Supabase Dashboard > Authentication > Users)`
            );
          }
          if (extraInAuth.length > 0) {
            warnings.push(
              `${extraInAuth.length} pengguna di Supabase Auth tidak ada di ALLOWED_EMAILS (Tambahkan ke ALLOWED_EMAILS atau hapus pengguna di Supabase Auth)`
            );
          }
          addResult(
            "Koneksi: Supabase Auth vs ALLOWED_EMAILS",
            "WARN",
            warnings.join(" | ")
          );
        }
      }
    } catch (err) {
      addResult(
        "Koneksi: Supabase Secret Key & Tabel",
        "FAIL",
        `Gagal menghubungi Supabase: ${err instanceof Error ? err.message : String(err)}`
      );
      addResult(
        "Koneksi: Supabase Auth vs ALLOWED_EMAILS",
        "FAIL",
        "Dilewati karena koneksi Supabase Secret Key gagal."
      );
    }
  } else {
    addResult(
      "Koneksi: Supabase Secret Key & Tabel",
      "FAIL",
      "SUPABASE_URL atau SUPABASE_SECRET_KEY kosong."
    );
    addResult(
      "Koneksi: Supabase Auth vs ALLOWED_EMAILS",
      "FAIL",
      "SUPABASE_URL atau SUPABASE_SECRET_KEY kosong."
    );
  }

  // 13. Koneksi nyata: SerpApi Account API
  const serpApiKey = localEnv["SERPAPI_KEY"] ?? "";
  if (serpApiKey) {
    try {
      const url = `https://serpapi.com/account.json?api_key=${encodeURIComponent(serpApiKey)}`;
      const res = await fetch(url);
      const body = (await res.json()) as Record<string, unknown>;

      if (!res.ok || body.error) {
        addResult(
          "Koneksi: SerpApi Account API",
          "FAIL",
          `SerpApi menolak kunci (${String(body.error ?? `HTTP ${res.status}`)}). Periksa nilai SERPAPI_KEY di .env.local.`
        );
      } else {
        const planName = String(body.plan_name ?? body.plan_id ?? "Tidak diketahui");
        const searchesLeft =
          body.total_searches_left ??
          body.plan_searches_left ??
          "Tidak tersedia";
        const rateLimitPerHour =
          typeof body.account_rate_limit_per_hour === "number"
            ? body.account_rate_limit_per_hour
            : null;

        const infoText = `Paket: ${planName}, Sisa pencarian: ${String(searchesLeft)}, Batas/jam: ${rateLimitPerHour ?? "Tidak tersedia"}`;

        if (
          rateLimitPerHour !== null &&
          Number.isFinite(maxPerHour) &&
          maxPerHour > rateLimitPerHour
        ) {
          addResult(
            "Koneksi: SerpApi Account API",
            "WARN",
            `${infoText}. SERPAPI_MAX_PER_HOUR (${maxPerHour}) melebihi batas paket (${rateLimitPerHour}). Turunkan nilai SERPAPI_MAX_PER_HOUR di .env.local.`
          );
        } else {
          addResult("Koneksi: SerpApi Account API", "PASS", infoText);
        }
      }
    } catch (err) {
      addResult(
        "Koneksi: SerpApi Account API",
        "FAIL",
        `Gagal menghubungi SerpApi Account API: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    addResult(
      "Koneksi: SerpApi Account API",
      "FAIL",
      "SERPAPI_KEY kosong di .env.local."
    );
  }

  // 14. Koneksi nyata: Endpoint cron (/api/cron/process)
  const cronRouteFile = path.join(
    rootDir,
    "app",
    "api",
    "cron",
    "process",
    "route.ts"
  );
  if (!fs.existsSync(cronRouteFile)) {
    addResult(
      "Koneksi: Endpoint /api/cron/process",
      "SKIP",
      "Route app/api/cron/process/route.ts belum tersedia (akan dibuat pada Fase 3)."
    );
  } else {
    try {
      const noAuthRes = await fetch("http://localhost:3000/api/cron/process", {
        method: "POST",
      });
      if (noAuthRes.status === 404) {
        addResult(
          "Koneksi: Endpoint /api/cron/process",
          "SKIP",
          "Endpoint mengembalikan 404 pada http://localhost:3000."
        );
      } else {
        const authRes = await fetch("http://localhost:3000/api/cron/process", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cronSecret}`,
          },
        });

        if (noAuthRes.status === 401 && authRes.status === 200) {
          addResult(
            "Koneksi: Endpoint /api/cron/process",
            "PASS",
            "Tanpa header mengembalikan 401, dengan Bearer CRON_SECRET mengembalikan 200."
          );
        } else {
          addResult(
            "Koneksi: Endpoint /api/cron/process",
            "FAIL",
            `Respons tidak sesuai (tanpa header: ${noAuthRes.status} [harus 401], dengan Bearer: ${authRes.status} [harus 200]). Periksa validasi header Authorization di route.ts.`
          );
        }
      }
    } catch {
      addResult(
        "Koneksi: Endpoint /api/cron/process",
        "SKIP",
        "Dev server tidak berjalan di http://localhost:3000. Jalankan npm run dev untuk menguji endpoint cron."
      );
    }
  }

  // ============================================================================
  // KEAMANAN
  // ============================================================================

  // 15. Keamanan: .env.local ada di .gitignore
  const gitignorePath = path.join(rootDir, ".gitignore");
  const gitignoreContent = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf-8")
    : "";
  const hasEnvLocalIgnore = gitignoreContent
    .split(/\r?\n/)
    .some((line) => {
      const t = line.trim();
      return t === ".env.local" || t === ".env*.local" || t === ".env*";
    });
  if (hasEnvLocalIgnore) {
    addResult(
      "Keamanan: .env.local di .gitignore",
      "PASS",
      ".gitignore sudah mencakup pola .env.local (.env*.local)"
    );
  } else {
    addResult(
      "Keamanan: .env.local di .gitignore",
      "FAIL",
      "Tambahkan .env.local atau .env*.local ke dalam file .gitignore."
    );
  }

  // 16. Keamanan: Tidak ada file .env yang masuk ke Git (git ls-files & riwayat commit)
  try {
    const trackedFiles = execSync("git ls-files", {
      cwd: rootDir,
      encoding: "utf-8",
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const historyFiles = execSync(
      'git log --all --name-only --pretty=format:""',
      {
        cwd: rootDir,
        encoding: "utf-8",
      }
    )
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const isForbiddenEnvFile = (fileName: string) => {
      const base = path.posix.basename(fileName.replace(/\\/g, "/"));
      return (
        (base === ".env" || base.startsWith(".env.")) &&
        base !== ".env.example"
      );
    };

    const trackedEnv = trackedFiles.filter(isForbiddenEnvFile);
    const committedEnv = Array.from(new Set(historyFiles.filter(isForbiddenEnvFile)));

    if (trackedEnv.length === 0 && committedEnv.length === 0) {
      addResult(
        "Keamanan: File .env bebas dari Git",
        "PASS",
        "Tidak ada file .env / .env.local di git ls-files maupun riwayat commit."
      );
    } else {
      addResult(
        "Keamanan: File .env bebas dari Git",
        "FAIL",
        `Ditemukan file env di Git (tracked: ${trackedEnv.join(", ") || "tidak ada"}, riwayat: ${committedEnv.join(", ") || "tidak ada"}). Hapus dengan git rm --cached dan bersihkan riwayat commit.`
      );
    }
  } catch (err) {
    addResult(
      "Keamanan: File .env bebas dari Git",
      "FAIL",
      `Gagal memeriksa Git: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 17. Keamanan: Tidak ada variabel rahasia dengan awalan NEXT_PUBLIC_
  const allSourceFiles = walkSourceFiles(rootDir);
  const nextPublicUsages: string[] = [];

  for (const k of [...Object.keys(localEnv), ...Object.keys(exampleEnv)]) {
    if (k.startsWith("NEXT_PUBLIC_")) {
      nextPublicUsages.push(`env:${k}`);
    }
  }

  for (const file of allSourceFiles) {
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    if (rel === "scripts/check-env.ts") continue;
    const content = fs.readFileSync(file, "utf-8");
    const matches = content.match(/NEXT_PUBLIC_[A-Z0-9_]+/g);
    if (matches) {
      for (const m of matches) {
        nextPublicUsages.push(`${rel} (${m})`);
      }
    }
  }

  if (nextPublicUsages.length === 0) {
    addResult(
      "Keamanan: Tanpa awalan NEXT_PUBLIC_",
      "PASS",
      "Tidak ada variabel rahasia yang menggunakan awalan NEXT_PUBLIC_."
    );
  } else {
    addResult(
      "Keamanan: Tanpa awalan NEXT_PUBLIC_",
      "FAIL",
      `Ditemukan penggunaan NEXT_PUBLIC_: ${nextPublicUsages.join(", ")}. Hapus awalan NEXT_PUBLIC_ agar rahasia hanya diakses di server.`
    );
  }

  // 18. Keamanan: SUPABASE_SECRET_KEY dan SERPAPI_KEY tidak diimpor di file "use client"
  const clientViolations: string[] = [];
  for (const file of allSourceFiles) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    if (rel === "scripts/check-env.ts") continue;
    const content = fs.readFileSync(file, "utf-8");
    const isUseClient = /^\s*["']use client["']/m.test(content);
    if (isUseClient) {
      if (
        content.includes("SUPABASE_SECRET_KEY") ||
        content.includes("SERPAPI_KEY")
      ) {
        clientViolations.push(rel);
      }
    }
  }

  if (clientViolations.length === 0) {
    addResult(
      'Keamanan: Rahasia tidak di file "use client"',
      "PASS",
      'Tidak ada komponen "use client" yang mengakses SUPABASE_SECRET_KEY atau SERPAPI_KEY.'
    );
  } else {
    addResult(
      'Keamanan: Rahasia tidak di file "use client"',
      "FAIL",
      `File "use client" memuat referensi rahasia server: ${clientViolations.join(", ")}. Pindahkan pemanggilan ke Server Component atau Route Handler.`
    );
  }

  // 19. Keamanan: Cari string sb_secret_ dan pola API key tertulis langsung di kode
  const hardcodedViolations: string[] = [];
  const rawSecretValues = [
    localEnv["SERPAPI_KEY"],
    localEnv["SUPABASE_SECRET_KEY"],
    localEnv["SUPABASE_PUBLISHABLE_KEY"],
    localEnv["CRON_SECRET"],
  ].filter((v): v is string => Boolean(v && v.length >= 16));

  for (const file of allSourceFiles) {
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    if (rel === "scripts/check-env.ts") continue;
    const content = fs.readFileSync(file, "utf-8");

    for (const secretVal of rawSecretValues) {
      if (content.includes(secretVal)) {
        hardcodedViolations.push(`${rel} (memuat nilai rahasia dari .env.local)`);
      }
    }

    const sbSecretMatches = content.match(/sb_secret_[A-Za-z0-9_-]+/g) ?? [];
    for (const m of sbSecretMatches) {
      if (m !== "sb_secret_test_key" && m.length > "sb_secret_".length + 8) {
        hardcodedViolations.push(`${rel} (pola kunci sb_secret_ tertulis langsung)`);
      }
    }

    const jwtMatches =
      content.match(
        /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g
      ) ?? [];
    if (jwtMatches.length > 0) {
      hardcodedViolations.push(`${rel} (pola JWT tertulis langsung)`);
    }
  }

  if (hardcodedViolations.length === 0) {
    addResult(
      "Keamanan: Tidak ada API key tertulis langsung",
      "PASS",
      "Tidak ditemukan string sb_secret_ atau pola API key aktif di kode sumber."
    );
  } else {
    addResult(
      "Keamanan: Tidak ada API key tertulis langsung",
      "FAIL",
      `Ditemukan rahasia tertulis langsung di: ${Array.from(new Set(hardcodedViolations)).join(", ")}. Pindahkan ke .env.local.`
    );
  }

  // ============================================================================
  // CETAK TABEL KELUARAN
  // ============================================================================
  const col1Title = "Pemeriksaan";
  const col2Title = "Status";
  const col3Title = "Keterangan";

  const col1Width = Math.max(
    col1Title.length,
    ...results.map((r) => r.check.length)
  );
  const col2Width = Math.max(
    col2Title.length,
    ...results.map((r) => r.status.length)
  );

  const divider = `+-${"-".repeat(col1Width)}-+-${"-".repeat(col2Width)}-+-${"-".repeat(65)}-+`;
  console.log(divider);
  console.log(
    `| ${col1Title.padEnd(col1Width)} | ${col2Title.padEnd(col2Width)} | ${col3Title.padEnd(65)} |`
  );
  console.log(divider);

  for (const r of results) {
    console.log(
      `| ${r.check.padEnd(col1Width)} | ${r.status.padEnd(col2Width)} | ${r.detail} |`
    );
  }
  console.log(divider);

  const passCount = results.filter((r) => r.status === "PASS").length;
  const warnCount = results.filter((r) => r.status === "WARN").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;

  console.log(
    `\nRingkasan: PASS=${passCount} | WARN=${warnCount} | FAIL=${failCount} | SKIP=${skipCount}`
  );

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    "Gagal menjalankan pemeriksa env:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
