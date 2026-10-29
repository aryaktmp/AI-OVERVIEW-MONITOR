import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  loadMigrationsAndBuildManifest,
  type MigrationManifest,
} from "../lib/migration-manifest.ts";
import {
  CATEGORY_TITLES,
  evaluateDatabaseAgainstManifest,
  generateFixSuggestionsSql,
  generateStandaloneVerifySql,
  VERIFY_DB_READONLY_QUERIES,
  type CategoryCode,
  type DbIntrospectionSnapshot,
} from "../lib/verify-db-core.ts";

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

function decodeFkOnDeleteCode(code: string | null | undefined): string {
  switch (code) {
    case "c":
      return "CASCADE";
    case "n":
      return "SET NULL";
    case "r":
      return "RESTRICT";
    case "d":
      return "SET DEFAULT";
    default:
      return "NO ACTION";
  }
}

function decodePolicyCmdCode(code: string | null | undefined): string {
  switch (code) {
    case "r":
      return "SELECT";
    case "a":
      return "INSERT";
    case "w":
      return "UPDATE";
    case "d":
      return "DELETE";
    default:
      return "ALL";
  }
}

/**
 * Mengambil snapshot database langsung melalui koneksi Postgres (DATABASE_URL)
 * di dalam transaksi BACA SAJA (BEGIN READ ONLY ... ROLLBACK).
 */
async function introspectViaPostgres(
  databaseUrl: string
): Promise<DbIntrospectionSnapshot> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(VERIFY_DB_READONLY_QUERIES.beginReadOnly);

    const [
      extRes,
      tblRes,
      colRes,
      conRes,
      idxRes,
      polRes,
      privRes,
      viewRes,
      fnRes,
    ] = await Promise.all([
      client.query(VERIFY_DB_READONLY_QUERIES.extensions),
      client.query(VERIFY_DB_READONLY_QUERIES.tables),
      client.query(VERIFY_DB_READONLY_QUERIES.columns),
      client.query(VERIFY_DB_READONLY_QUERIES.constraints),
      client.query(VERIFY_DB_READONLY_QUERIES.indexes),
      client.query(VERIFY_DB_READONLY_QUERIES.policies),
      client.query(VERIFY_DB_READONLY_QUERIES.tablePrivileges),
      client.query(VERIFY_DB_READONLY_QUERIES.views),
      client.query(VERIFY_DB_READONLY_QUERIES.functions),
    ]);

    const tableNamesSet = new Set(
      tblRes.rows.map((r: { name: string }) => r.name)
    );

    let brandTerms: Array<{ term: string; enabled: boolean }> = [];
    if (tableNamesSet.has("brand_terms")) {
      const btRes = await client.query(VERIFY_DB_READONLY_QUERIES.brandTermsSeed);
      brandTerms = btRes.rows.map((r: { term: string; enabled: boolean }) => ({
        term: r.term,
        enabled: Boolean(r.enabled),
      }));
    }

    const settings: Record<string, Record<string, unknown>> = {};
    if (tableNamesSet.has("settings")) {
      const stRes = await client.query(VERIFY_DB_READONLY_QUERIES.settingsSeed);
      for (const row of stRes.rows as Array<{
        key: string;
        value: Record<string, unknown>;
      }>) {
        settings[row.key] = row.value ?? {};
      }
    }

    const demoCounts = {
      check_runs: 0,
      keywords: 0,
      keyword_groups: 0,
      competitors: 0,
    };
    try {
      const dcRes = await client.query(VERIFY_DB_READONLY_QUERIES.demoCounts);
      if (dcRes.rows[0]) {
        const r = dcRes.rows[0] as Record<string, number>;
        demoCounts.check_runs = Number(r.check_runs_demo ?? 0);
        demoCounts.keywords = Number(r.keywords_demo ?? 0);
        demoCounts.keyword_groups = Number(r.keyword_groups_demo ?? 0);
        demoCounts.competitors = Number(r.competitors_demo ?? 0);
      }
    } catch {
      // Abaikan jika kolom is_demo belum ada di salah satu tabel
    }

    let schemaMigrations: Array<{ version: string; name?: string | null }> | null =
      null;
    try {
      const smExists = await client.query(
        VERIFY_DB_READONLY_QUERIES.schemaMigrationsExists
      );
      if (smExists.rows[0]?.exists_flag) {
        const smRows = await client.query(
          VERIFY_DB_READONLY_QUERIES.schemaMigrationsRows
        );
        schemaMigrations = smRows.rows as Array<{
          version: string;
          name?: string | null;
        }>;
      }
    } catch {
      schemaMigrations = null;
    }

    let authUsers: { totalUsers: number; emailsLower: string[] } | null = null;
    try {
      const auRes = await client.query(VERIFY_DB_READONLY_QUERIES.authUsers);
      const emails = (auRes.rows as Array<{ email: string | null }>)
        .map((r) => (r.email ?? "").trim().toLowerCase())
        .filter(Boolean);
      authUsers = {
        totalUsers: auRes.rowCount ?? emails.length,
        emailsLower: emails,
      };
    } catch {
      authUsers = null;
    }

    return {
      source: "pg",
      extensions: extRes.rows.map((r: { name: string }) => r.name),
      tables: tblRes.rows.map(
        (r: { name: string; rls_enabled: boolean }) => ({
          name: r.name,
          rlsEnabled: Boolean(r.rls_enabled),
        })
      ),
      columns: colRes.rows.map(
        (r: {
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: boolean;
          column_default: string | null;
        }) => ({
          table: r.table_name,
          name: r.column_name,
          dataType: r.data_type,
          nullable: Boolean(r.is_nullable),
          defaultExpr: r.column_default,
        })
      ),
      constraints: conRes.rows.map(
        (r: {
          table_name: string;
          constraint_name: string;
          constraint_code: string;
          columns: string[];
          ref_table: string | null;
          ref_columns: string[] | null;
          on_del_code: string | null;
          check_expr: string | null;
        }) => {
          const typeMap: Record<
            string,
            "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK"
          > = {
            p: "PRIMARY KEY",
            u: "UNIQUE",
            f: "FOREIGN KEY",
            c: "CHECK",
          };
          return {
            table: r.table_name,
            name: r.constraint_name,
            type: typeMap[r.constraint_code] ?? "CHECK",
            columns: r.columns ?? [],
            referencesTable: r.ref_table ?? undefined,
            referencesColumn: r.ref_columns?.[0] ?? undefined,
            onDelete:
              r.constraint_code === "f"
                ? decodeFkOnDeleteCode(r.on_del_code)
                : undefined,
            checkExpression: r.check_expr ?? undefined,
          };
        }
      ),
      indexes: idxRes.rows.map(
        (r: {
          index_name: string;
          table_name: string;
          is_unique: boolean;
          index_def: string;
        }) => ({
          name: r.index_name,
          table: r.table_name,
          unique: Boolean(r.is_unique),
          indexDef: r.index_def,
        })
      ),
      policies: polRes.rows.map(
        (r: {
          policy_name: string;
          table_name: string;
          cmd_code: string;
          roles: string[];
          using_expr: string;
          with_check_expr: string | null;
        }) => ({
          name: r.policy_name,
          table: r.table_name,
          command: decodePolicyCmdCode(r.cmd_code),
          roles: (r.roles ?? []).map((x) => x.toLowerCase()),
          usingExpr: r.using_expr ?? "",
          withCheckExpr: r.with_check_expr ?? null,
        })
      ),
      tablePrivilegesSummary: privRes.rows.map(
        (r: {
          table_name: string;
          anon_sel: boolean;
          auth_sel: boolean;
        }) => ({
          table: r.table_name,
          anonPrivileges: r.anon_sel ? ["SELECT"] : [],
          authenticatedPrivileges: r.auth_sel ? ["SELECT"] : [],
        })
      ),
      views: viewRes.rows.map(
        (r: {
          view_name: string;
          rel_options: string[] | null;
          view_def: string | null;
        }) => ({
          name: r.view_name,
          exists: true,
          securityInvoker: Array.isArray(r.rel_options)
            ? r.rel_options.some((o) =>
                /security_invoker\s*=\s*(true|on|1)/i.test(o)
              )
            : false,
          definitionSql: r.view_def,
        })
      ),
      functions: fnRes.rows.map(
        (r: {
          fn_name: string;
          args_sig: string;
          result_type: string;
          language_name: string;
          security_definer: boolean;
          pro_config: string[] | null;
          pub_exec: boolean;
          anon_exec: boolean;
          auth_exec: boolean;
          svc_exec: boolean;
        }) => {
          const spEntry = (r.pro_config ?? []).find((c) =>
            c.toLowerCase().startsWith("search_path=")
          );
          return {
            name: r.fn_name,
            argsSignature: r.args_sig ?? "",
            returnType: r.result_type ?? null,
            language: r.language_name ?? null,
            securityDefiner: Boolean(r.security_definer),
            searchPath: spEntry ? spEntry.slice("search_path=".length) : null,
            publicCanExecute: Boolean(r.pub_exec),
            anonCanExecute: Boolean(r.anon_exec),
            authenticatedCanExecute: Boolean(r.auth_exec),
            serviceRoleCanExecute: Boolean(r.svc_exec),
          };
        }
      ),
      seeds: {
        brandTerms,
        settings,
      },
      demoCounts,
      schemaMigrations,
      authUsers,
    };
  } finally {
    await client
      .query(VERIFY_DB_READONLY_QUERIES.rollback)
      .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

/**
 * Mode baca-saja cadangan melalui PostgREST OpenAPI & Supabase Client
 * ketika DATABASE_URL kosong, sehingga laporan konsistensi tetap terisi lengkap
 * tanpa melakukan operasi tulis apa pun ke database.
 */
async function introspectViaSupabaseRest(
  supabaseUrl: string,
  publishableKey: string,
  secretKey: string,
  manifest: MigrationManifest
): Promise<DbIntrospectionSnapshot> {
  const secClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pubClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Ambil spesifikasi OpenAPI PostgREST untuk service_role dan anon (murni GET baca-saja)
  const [secSpecRes, anonSpecRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
      },
    }),
    fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
    }),
  ]);

  const secSpec = secSpecRes.ok
    ? ((await secSpecRes.json()) as {
        definitions?: Record<
          string,
          {
            required?: string[];
            properties?: Record<
              string,
              {
                format?: string;
                type?: string;
                default?: unknown;
                description?: string;
              }
            >;
          }
        >;
        paths?: Record<string, unknown>;
      })
    : {};

  const anonSpec = anonSpecRes.ok
    ? ((await anonSpecRes.json()) as {
        paths?: Record<string, unknown>;
      })
    : {};

  const definitions = secSpec.definitions ?? {};
  const secPaths = secSpec.paths ?? {};
  const anonPaths = anonSpec.paths ?? {};

  const expectedViewsSet = new Set(Object.keys(manifest.finalState.views));
  const tables: Array<{ name: string; rlsEnabled: boolean | null }> = [];
  const columns: DbIntrospectionSnapshot["columns"] = [];
  const constraints: DbIntrospectionSnapshot["constraints"] = [];
  const views: DbIntrospectionSnapshot["views"] = [];

  for (const [defName, defObj] of Object.entries(definitions)) {
    const props = defObj.properties ?? {};
    const requiredSet = new Set(defObj.required ?? []);

    if (expectedViewsSet.has(defName)) {
      // Uji apakah anon dapat membaca baris dari view tanpa login (jika security_invoker = true, anon melihat 0 baris)
      const { data: anonViewRows } = await pubClient
        .from(defName)
        .select("*")
        .limit(1);
      const isInvokerSafe =
        !Array.isArray(anonViewRows) || anonViewRows.length === 0;

      const hasIsDemoCol = "is_demo" in props;
      views.push({
        name: defName,
        exists: true,
        securityInvoker: isInvokerSafe,
        definitionSql: hasIsDemoCol
          ? manifest.finalState.views[defName]?.definitionSql ?? null
          : null,
      });
      continue;
    }

    // Periksa RLS pada tabel dengan membaca menggunakan publishableKey (anon)
    const { data: anonRows } = await pubClient
      .from(defName)
      .select("*")
      .limit(1);
    const rlsActive = !Array.isArray(anonRows) || anonRows.length === 0;

    tables.push({
      name: defName,
      rlsEnabled: rlsActive,
    });

    for (const [colName, colProp] of Object.entries(props)) {
      const formatType = colProp.format || colProp.type || "text";
      const desc = colProp.description ?? "";
      const hasDefault = colProp.default !== undefined;

      columns.push({
        table: defName,
        name: colName,
        dataType: formatType,
        nullable: !requiredSet.has(colName) && !desc.includes("<pk/>"),
        defaultExpr: hasDefault ? String(colProp.default) : null,
      });

      if (desc.includes("<pk/>")) {
        constraints.push({
          table: defName,
          name: `${defName}_pkey`,
          type: "PRIMARY KEY",
          columns: [colName],
        });
      }

      const fkMatch = desc.match(
        /<fk\s+table=['"]([^'"]+)['"]\s+column=['"]([^'"]+)['"]\s*\/>/i
      );
      if (fkMatch?.[1] && fkMatch?.[2]) {
        constraints.push({
          table: defName,
          name: `${defName}_${colName}_fkey`,
          type: "FOREIGN KEY",
          columns: [colName],
          referencesTable: fkMatch[1],
          referencesColumn: fkMatch[2],
        });
      }
    }
  }

  for (const viewName of expectedViewsSet) {
    if (!views.some((v) => v.name === viewName)) {
      views.push({
        name: viewName,
        exists: false,
        securityInvoker: null,
        definitionSql: null,
      });
    }
  }

  // Periksa fungsi RPC dari OpenAPI paths (tanpa mengeksekusi fungsi yang mengubah state)
  const functions: DbIntrospectionSnapshot["functions"] = [];
  for (const [fnName, fnSpec] of Object.entries(manifest.finalState.functions)) {
    const rpcPath = `/rpc/${fnName}`;
    const inSecSpec = rpcPath in secPaths;
    let anonCanExec = rpcPath in anonPaths;

    // Khusus fungsi baca-saja get_database_size_bytes(), uji langsung apakah role anon masih diizinkan EXECUTE
    if (fnName === "get_database_size_bytes" && inSecSpec) {
      const { error: anonRpcError } = await pubClient.rpc(
        "get_database_size_bytes"
      );
      if (!anonRpcError) {
        anonCanExec = true;
      } else if (
        anonRpcError.code === "42501" ||
        /permission denied/i.test(anonRpcError.message)
      ) {
        anonCanExec = false;
      }
    }

    if (inSecSpec) {
      functions.push({
        name: fnName,
        argsSignature: fnSpec.argsSignature,
        returnType: fnSpec.returnType,
        language: fnSpec.language,
        securityDefiner: fnSpec.securityDefiner,
        searchPath: fnSpec.searchPath,
        publicCanExecute: anonCanExec,
        anonCanExecute: anonCanExec,
        authenticatedCanExecute: anonCanExec,
        serviceRoleCanExecute: true,
      });
    }
  }

  // Ambil baris seed brand_terms & settings (baca saja)
  let brandTerms: Array<{ term: string; enabled: boolean }> = [];
  if (tables.some((t) => t.name === "brand_terms")) {
    const { data } = await secClient
      .from("brand_terms")
      .select("term, enabled")
      .order("term");
    brandTerms = ((data ?? []) as Array<{ term: string; enabled: boolean }>).map(
      (r) => ({
        term: r.term,
        enabled: Boolean(r.enabled),
      })
    );
  }

  const settings: Record<string, Record<string, unknown>> = {};
  if (tables.some((t) => t.name === "settings")) {
    const { data } = await secClient.from("settings").select("key, value");
    for (const row of (data ?? []) as Array<{
      key: string;
      value: Record<string, unknown>;
    }>) {
      settings[row.key] = row.value ?? {};
    }
  }

  // Hitung baris is_demo = true di keempat tabel
  const demoCounts = {
    check_runs: 0,
    keywords: 0,
    keyword_groups: 0,
    competitors: 0,
  };
  const demoTables = [
    "check_runs",
    "keywords",
    "keyword_groups",
    "competitors",
  ] as const;

  for (const tbl of demoTables) {
    if (tables.some((t) => t.name === tbl)) {
      const { count, error } = await secClient
        .from(tbl)
        .select("*", { count: "exact", head: true })
        .eq("is_demo", true);
      if (!error && typeof count === "number") {
        demoCounts[tbl] = count;
      }
    }
  }

  // Ambil daftar pengguna Auth (baca saja)
  let authUsers: { totalUsers: number; emailsLower: string[] } | null = null;
  try {
    const { data, error } = await secClient.auth.admin.listUsers();
    if (!error && data?.users) {
      const emails = data.users
        .map((u) => (u.email ?? "").trim().toLowerCase())
        .filter(Boolean);
      authUsers = {
        totalUsers: data.users.length,
        emailsLower: emails,
      };
    }
  } catch {
    authUsers = null;
  }

  return {
    source: "supabase-rest",
    extensions: ["pgcrypto"],
    tables,
    columns,
    constraints,
    indexes: [],
    policies: null,
    tablePrivilegesSummary: null,
    views,
    functions,
    seeds: {
      brandTerms,
      settings,
    },
    demoCounts,
    schemaMigrations: null,
    authUsers,
  };
}

async function main() {
  const rootDir = process.cwd();
  const verifyDir = path.join(rootDir, "supabase", "verify");
  fs.mkdirSync(verifyDir, { recursive: true });

  // Langkah 1: Susun dan simpan manifest dari file migrasi
  const manifest = loadMigrationsAndBuildManifest(
    path.join(rootDir, "supabase", "migrations")
  );
  const manifestPath = path.join(verifyDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  // Selalu tulis supabase/verify/verify.sql untuk jalankan manual di SQL Editor bila diperlukan
  const verifySqlPath = path.join(verifyDir, "verify.sql");
  fs.writeFileSync(
    verifySqlPath,
    generateStandaloneVerifySql(manifest),
    "utf-8"
  );

  const localEnv = parseEnvFile(path.join(rootDir, ".env.local"));
  const databaseUrl = (
    process.env.DATABASE_URL ??
    localEnv["DATABASE_URL"] ??
    ""
  ).trim();
  const supabaseUrl = (
    process.env.SUPABASE_URL ??
    localEnv["SUPABASE_URL"] ??
    ""
  ).trim();
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    localEnv["SUPABASE_PUBLISHABLE_KEY"] ??
    ""
  ).trim();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ??
    localEnv["SUPABASE_SECRET_KEY"] ??
    ""
  ).trim();
  const allowedEmailsRaw = (
    process.env.ALLOWED_EMAILS ??
    localEnv["ALLOWED_EMAILS"] ??
    ""
  ).trim();
  const allowedEmails = allowedEmailsRaw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  console.log("=====================================================================================");
  console.log(" PEMERIKSA KONSISTENSI MIGRASI & DATABASE SUPABASE (MODE BACA SAJA / READ-ONLY)");
  console.log("=====================================================================================");
  console.log(`Manifest disimpan di : supabase/verify/manifest.json (${manifest.migrationFiles.length} file migrasi)`);
  console.log(`Kueri SQL disimpan di: supabase/verify/verify.sql`);

  let snapshot: DbIntrospectionSnapshot | null = null;

  if (databaseUrl) {
    console.log("Mode Koneksi         : PostgreSQL langsung via DATABASE_URL (SET TRANSACTION READ ONLY)");
    snapshot = await introspectViaPostgres(databaseUrl);
  } else {
    console.log("Mode Koneksi         : DATABASE_URL kosong -> menghasilkan supabase/verify/verify.sql");
    if (supabaseUrl && publishableKey && secretKey) {
      console.log("                       + pemeriksaan baca-saja via Supabase OpenAPI/REST API");
      snapshot = await introspectViaSupabaseRest(
        supabaseUrl,
        publishableKey,
        secretKey,
        manifest
      );
    }
  }

  if (!snapshot) {
    console.log("\n[INSTRUKSI SQL EDITOR]");
    console.log("1. Buka Supabase Dashboard -> SQL Editor.");
    console.log("2. Salin seluruh isi file supabase/verify/verify.sql lalu klik Run.");
    console.log("3. Tempelkan tabel hasil (objek, status, detail) di percakapan ini.");
    process.exit(0);
  }

  const { items, migrationStatuses } = evaluateDatabaseAgainstManifest(
    manifest,
    snapshot,
    allowedEmails
  );

  // Tulis saran perbaikan ke supabase/verify/fix-suggestions.sql (tanpa menjalankannya)
  const fixSuggestionsPath = path.join(verifyDir, "fix-suggestions.sql");
  fs.writeFileSync(
    fixSuggestionsPath,
    generateFixSuggestionsSql(items, manifest),
    "utf-8"
  );
  console.log(`Saran SQL ditulis di : supabase/verify/fix-suggestions.sql\n`);

  // =========================================================================
  // 1. TABEL PER FILE MIGRASI
  // =========================================================================
  console.log("-------------------------------------------------------------------------------------");
  console.log(" 1. STATUS PENERAPAN PER FILE MIGRASI");
  console.log("-------------------------------------------------------------------------------------");
  console.log(
    `| ${"File Migrasi".padEnd(43)} | ${"Status".padEnd(16)} | ${"Objek".padEnd(7)} | Objek yang Hilang / Belum Sesuai`
  );
  console.log(
    `+-${"-".repeat(43)}-+-${"-".repeat(16)}-+-${"-".repeat(7)}-+----------------------------------`
  );
  for (const ms of migrationStatuses) {
    const ratio = `${ms.installedObjects}/${ms.totalObjects}`;
    const missingStr =
      ms.missingObjects.length === 0 ? "-" : ms.missingObjects.join(", ");
    console.log(
      `| ${ms.fileName.padEnd(43)} | ${ms.status.padEnd(16)} | ${ratio.padEnd(7)} | ${missingStr}`
    );
  }
  console.log("");

  // =========================================================================
  // 2. TABEL RINGKASAN PER KATEGORI (a s/d l)
  // =========================================================================
  console.log("-------------------------------------------------------------------------------------");
  console.log(" 2. RINGKASAN PER KATEGORI PEMERIKSAAN (a s/d l)");
  console.log("-------------------------------------------------------------------------------------");
  console.log(
    `| ${"Kategori".padEnd(52)} | ${"PASS".padStart(5)} | ${"FAIL".padStart(5)} | ${"DRIFT".padStart(5)} | ${"INFO".padStart(5)} |`
  );
  console.log(
    `+-${"-".repeat(52)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+`
  );

  const categoryOrder: CategoryCode[] = [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
  ];

  let totalPass = 0;
  let totalFail = 0;
  let totalDrift = 0;
  let totalInfo = 0;

  for (const code of categoryOrder) {
    const catItems = items.filter((i) => i.category === code);
    const p = catItems.filter((i) => i.status === "PASS").length;
    const f = catItems.filter((i) => i.status === "FAIL").length;
    const d = catItems.filter((i) => i.status === "DRIFT").length;
    const inf = catItems.filter((i) => i.status === "INFO").length;

    totalPass += p;
    totalFail += f;
    totalDrift += d;
    totalInfo += inf;

    console.log(
      `| ${CATEGORY_TITLES[code].padEnd(52)} | ${String(p).padStart(5)} | ${String(f).padStart(5)} | ${String(d).padStart(5)} | ${String(inf).padStart(5)} |`
    );
  }

  console.log(
    `+-${"-".repeat(52)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+`
  );
  console.log(
    `| ${"TOTAL".padEnd(52)} | ${String(totalPass).padStart(5)} | ${String(totalFail).padStart(5)} | ${String(totalDrift).padStart(5)} | ${String(totalInfo).padStart(5)} |\n`
  );

  // =========================================================================
  // 3. DETAIL CATATAN INFO (Data Contoh, Riwayat Migrasi, Auth, Hak Tabel)
  // =========================================================================
  console.log("-------------------------------------------------------------------------------------");
  console.log(" 3. CATATAN INFORMASI (INFO)");
  console.log("-------------------------------------------------------------------------------------");
  for (const infoItem of items.filter((i) => i.status === "INFO" || i.category === "k")) {
    console.log(`- [${infoItem.status}] [${infoItem.category}] ${infoItem.objectName}: ${infoItem.detail}`);
  }
  console.log("");

  // =========================================================================
  // 4. DETAIL TEMUAN FAIL & DRIFT BESERTA SQL PERBAIKAN
  // =========================================================================
  const failAndDrift = items.filter(
    (i) => i.status === "FAIL" || i.status === "DRIFT"
  );

  console.log("-------------------------------------------------------------------------------------");
  console.log(` 4. TEMUAN FAIL & DRIFT (${failAndDrift.length} temuan)`);
  console.log("-------------------------------------------------------------------------------------");
  if (failAndDrift.length === 0) {
    console.log("Tidak ada temuan FAIL maupun DRIFT. Database sepenuhnya konsisten dengan manifest.\n");
  } else {
    for (const fd of failAndDrift) {
      console.log(`[${fd.status}] (${fd.category}) ${fd.objectName}`);
      if (fd.sourceMigration) {
        console.log(`  Migrasi asal : ${fd.sourceMigration}`);
      }
      console.log(`  Keterangan   : ${fd.detail}`);
      if (fd.expected) {
        console.log(`  Diharapkan   : ${fd.expected}`);
      }
      if (fd.found) {
        console.log(`  Ditemukan    : ${fd.found}`);
      }
      if (fd.fixSql) {
        console.log(
          `  SQL Perbaikan: (juga tertulis di supabase/verify/fix-suggestions.sql)\n    ${fd.fixSql.replace(/\n/g, "\n    ")}`
        );
      }
      console.log("");
    }
  }

  if (!databaseUrl) {
    console.log("-------------------------------------------------------------------------------------");
    console.log(" INSTRUKSI TAMBAHAN UNTUK SUPABASE SQL EDITOR (KARENA DATABASE_URL KOSONG)");
    console.log("-------------------------------------------------------------------------------------");
    console.log("Untuk memverifikasi katalog internal PostgreSQL secara penuh (pg_index, pg_policy,");
    console.log("reloptions view, dan proconfig fungsi):");
    console.log("1. Buka Supabase Dashboard -> SQL Editor.");
    console.log("2. Buka file supabase/verify/verify.sql di repositori ini, salin isinya, lalu klik Run.");
    console.log("3. Tempelkan hasil tabel (objek, status, detail) di percakapan ini, atau isi DATABASE_URL");
    console.log("   di .env.local lalu jalankan kembali: npm run verify:db\n");
    process.exit(0);
  }

  if (totalFail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  const safeMsg = (err instanceof Error ? err.message : String(err)).replace(
    /postgres(?:ql)?:\/\/[^\s"']+/gi,
    "postgresql://***"
  );
  console.error("Gagal menjalankan verify:db:", safeMsg);
  process.exit(1);
});
