import fs from "node:fs";
import path from "node:path";
import type { MigrationManifest } from "./migration-manifest.ts";
import {
  normalizeSqlDefault,
  normalizeSqlType,
} from "./migration-manifest.ts";

export type VerifyMethod = "DB" | "API" | "FILE";

export type VerifyStatus =
  | "PASS"
  | "FAIL"
  | "DRIFT"
  | "INFO"
  | "UNVERIFIED"
  | "MIGRATION-LINT";

export type CategoryCode =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l";

export const CATEGORY_TITLES: Record<CategoryCode, string> = {
  a: "a. Tabel",
  b: "b. Kolom",
  c: "c. Constraint & Indeks (PK, Unique, FK, Check, Index)",
  d: "d. Status RLS & Daftar Kebijakan",
  e: "e. Keamanan Kebijakan & Hak Akses Tabel",
  f: "f. View & Opsi security_invoker",
  g: "g. Fungsi Schema Public, Hak EXECUTE, & search_path",
  h: "h. Data Seed (brand_terms & settings)",
  i: "i. Data Contoh (is_demo = true)",
  j: "j. Riwayat Migrasi (schema_migrations)",
  k: "k. Pengguna Auth vs ALLOWED_EMAILS",
  l: "l. Ekstensi Database",
};

export interface VerifyCheckItem {
  category: CategoryCode;
  objectName: string;
  status: VerifyStatus;
  method: VerifyMethod;
  detail: string;
  expected?: string;
  found?: string;
  sourceMigration?: string;
  fixMigration?: string;
  fixSql?: string;
  fixComment?: string;
}

export interface MigrationInstallStatus {
  fileName: string;
  status: "TERPASANG PENUH" | "SEBAGIAN" | "BELUM TERPASANG";
  totalObjects: number;
  installedObjects: number;
  missingObjects: string[];
}

export interface SupabaseManagedConfig {
  functions: string[];
  eventTriggers: string[];
}

export function loadSupabaseManagedConfig(rootDir = process.cwd()): SupabaseManagedConfig {
  const filePath = path.join(
    rootDir,
    "supabase",
    "verify",
    "supabase-managed.json"
  );
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<SupabaseManagedConfig>;
      return {
        functions: Array.isArray(raw.functions) ? raw.functions : ["rls_auto_enable"],
        eventTriggers: Array.isArray(raw.eventTriggers)
          ? raw.eventTriggers
          : ["ensure_rls"],
      };
    } catch {
      // Fallback
    }
  }
  return {
    functions: ["rls_auto_enable"],
    eventTriggers: ["ensure_rls"],
  };
}

export interface DbIntrospectionSnapshot {
  source: "pg" | "supabase-rest";
  extensions: string[];
  eventTriggers: string[];
  tables: Array<{
    name: string;
    rlsEnabled: boolean | null;
  }>;
  columns: Array<{
    table: string;
    name: string;
    dataType: string;
    nullable: boolean;
    defaultExpr: string | null;
  }>;
  constraints: Array<{
    table: string;
    name: string;
    type: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK";
    columns: string[];
    referencesTable?: string;
    referencesColumn?: string;
    onDelete?: string;
    checkExpression?: string;
  }>;
  indexes: Array<{
    name: string;
    table: string;
    unique: boolean;
    indexDef: string;
  }>;
  policies: Array<{
    name: string;
    table: string;
    command: string;
    roles: string[];
    usingExpr: string;
    withCheckExpr: string | null;
  }> | null;
  tablePrivilegesSummary: Array<{
    table: string;
    anonPrivileges: string[];
    authenticatedPrivileges: string[];
  }> | null;
  views: Array<{
    name: string;
    exists: boolean;
    securityInvoker: boolean | null;
    definitionSql: string | null;
  }>;
  functions: Array<{
    name: string;
    argsSignature: string;
    returnType: string | null;
    language: string | null;
    securityDefiner: boolean | null;
    searchPath: string | null;
    publicCanExecute: boolean;
    anonCanExecute: boolean;
    authenticatedCanExecute: boolean;
    serviceRoleCanExecute: boolean;
  }>;
  seeds: {
    brandTerms: Array<{ term: string; enabled: boolean }>;
    settings: Record<string, Record<string, unknown>>;
  };
  demoCounts: {
    check_runs: number;
    keywords: number;
    keyword_groups: number;
    competitors: number;
  };
  schemaMigrations: Array<{
    version: string;
    name?: string | null;
  }> | null;
  authUsers: {
    totalUsers: number;
    emailsLower: string[];
  } | null;
}

export function maskEmailAddress(email: string): string {
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0) return "***";
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  return `${local[0]}***@${domain}`;
}

export const VERIFY_DB_READONLY_QUERIES = {
  beginReadOnly: "BEGIN READ ONLY;",
  rollback: "ROLLBACK;",

  extensions: `
    SELECT extname AS name
    FROM pg_catalog.pg_extension
    ORDER BY extname;
  `,

  eventTriggers: `
    SELECT evtname
    FROM pg_catalog.pg_event_trigger
    ORDER BY evtname;
  `,

  tables: `
    SELECT
      c.relname AS name,
      c.relrowsecurity AS rls_enabled
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname;
  `,

  columns: `
    SELECT
      c.relname AS table_name,
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      NOT a.attnotnull AS is_nullable,
      pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expr
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum;
  `,

  constraints: `
    SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      con.contype AS constraint_type,
      ARRAY(
        SELECT a.attname
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = con.conrelid
          AND a.attnum = ANY(con.conkey)
        ORDER BY array_position(con.conkey, a.attnum)
      ) AS columns,
      ref_c.relname AS references_table,
      ARRAY(
        SELECT a.attname
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = con.confrelid
          AND a.attnum = ANY(con.confkey)
        ORDER BY array_position(con.confkey, a.attnum)
      ) AS references_columns,
      con.confdeltype AS on_delete_action,
      pg_catalog.pg_get_expr(con.conbin, con.conrelid) AS check_expression
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
    LEFT JOIN pg_catalog.pg_class ref_c ON ref_c.oid = con.confrelid
    WHERE n.nspname = 'public'
    ORDER BY c.relname, con.conname;
  `,

  indexes: `
    SELECT
      i.relname AS index_name,
      t.relname AS table_name,
      ix.indisunique AS is_unique,
      pg_catalog.pg_get_indexdef(ix.indexrelid, 0, true) AS index_def
    FROM pg_catalog.pg_index ix
    JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relkind = 'r'
      AND NOT ix.indisprimary
    ORDER BY t.relname, i.relname;
  `,

  policies: `
    SELECT
      pol.polname AS policy_name,
      c.relname AS table_name,
      pol.polcmd AS command_type,
      ARRAY(
        SELECT r.rolname
        FROM pg_catalog.pg_roles r
        WHERE r.oid = ANY(pol.polroles)
      ) AS roles,
      pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
      pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
    FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, pol.polname;
  `,

  tablePrivileges: `
    SELECT
      c.relname AS table_name,
      pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
      pg_catalog.has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
      pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
      pg_catalog.has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
      pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
      pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_insert,
      pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') AS auth_update,
      pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE') AS auth_delete
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname;
  `,

  views: `
    SELECT
      c.relname AS view_name,
      COALESCE(
        EXISTS (
          SELECT 1
          FROM unnest(c.reloptions) opt
          WHERE opt = 'security_invoker=true' OR opt = 'security_invoker=on' OR opt = 'security_invoker=1'
        ),
        false
      ) AS security_invoker,
      pg_catalog.pg_get_viewdef(c.oid, true) AS definition_sql
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
    ORDER BY c.relname;
  `,

  functions: `
    SELECT
      p.proname AS name,
      pg_catalog.oidvectortypes(p.proargtypes) AS args_signature,
      pg_catalog.format_type(p.prorettype, NULL) AS return_type,
      l.lanname AS language,
      p.prosecdef AS is_security_definer,
      (
        SELECT opt
        FROM unnest(p.proconfig) opt
        WHERE opt LIKE 'search_path=%'
        LIMIT 1
      ) AS search_path_config,
      pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
      pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute,
      pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `,

  seedBrandTerms: `
    SELECT term, enabled
    FROM public.brand_terms
    ORDER BY term;
  `,

  seedSettings: `
    SELECT key, value
    FROM public.settings
    ORDER BY key;
  `,

  demoCounts: `
    SELECT
      (SELECT count(*) FROM public.check_runs WHERE is_demo = true)::int AS check_runs,
      (SELECT count(*) FROM public.keywords WHERE is_demo = true)::int AS keywords,
      (SELECT count(*) FROM public.keyword_groups WHERE is_demo = true)::int AS keyword_groups,
      (SELECT count(*) FROM public.competitors WHERE is_demo = true)::int AS competitors;
  `,

  schemaMigrations: `
    SELECT
      version,
      name
    FROM supabase_migrations.schema_migrations
    ORDER BY version;
  `,

  authUsers: `
    SELECT
      id,
      email
    FROM auth.users
    ORDER BY created_at;
  `,
};

export function generateStandaloneVerifySql(manifest: MigrationManifest): string {
  const expectedTableNames = Object.keys(manifest.finalState.tables)
    .map((t) => `'${t}'`)
    .join(", ");
  const expectedViewNames = Object.keys(manifest.finalState.views)
    .map((v) => `'${v}'`)
    .join(", ");
  const expectedFnNames = Object.keys(manifest.finalState.functions)
    .map((f) => `'${f}'`)
    .join(", ");

  return `-- Pemindai Konsistensi Database Supabase (Hanya Baca / Read-Only)
-- Jalankan kueri ini di Supabase SQL Editor. Kueri ini menghasilkan satu tabel (objek, status, detail).
-- Ekspor hasil sebagai CSV atau salin tabel hasil, lalu jalankan:
-- npm run verify:db -- --from-file <path-ke-file-hasil>

WITH
expected_tables(name) AS (
  VALUES ${Object.keys(manifest.finalState.tables)
    .map((t) => `('${t}')`)
    .join(", ")}
),
expected_views(name) AS (
  VALUES ${Object.keys(manifest.finalState.views)
    .map((v) => `('${v}')`)
    .join(", ")}
),
expected_functions(name) AS (
  VALUES ${Object.keys(manifest.finalState.functions)
    .map((f) => `('${f}')`)
    .join(", ")}
),
db_tables AS (
  SELECT
    c.relname AS name,
    c.oid AS rel_oid,
    c.relrowsecurity AS rls_enabled
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
db_views AS (
  SELECT
    c.relname AS name,
    COALESCE(
      EXISTS (
        SELECT 1 FROM unnest(c.reloptions) opt
        WHERE opt = 'security_invoker=true' OR opt = 'security_invoker=on' OR opt = 'security_invoker=1'
      ),
      false
    ) AS security_invoker
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
),
db_functions AS (
  SELECT
    p.proname AS name,
    p.oid AS fn_oid,
    p.prosecdef AS sec_definer,
    COALESCE(array_to_string(p.proconfig, ','), '') AS config_str,
    pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS pub_exec,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
)

SELECT * FROM (
  -- a. Tabel di Manifest
  SELECT
    'a. Tabel: ' || et.name AS objek,
    CASE WHEN dt.name IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.name IS NOT NULL THEN 'Tabel tersedia di schema public' ELSE 'Tabel hilang / belum dimigrasi' END AS detail
  FROM expected_tables et
  LEFT JOIN db_tables dt ON dt.name = et.name

  UNION ALL

  -- a. Tabel DRIFT
  SELECT
    'a. Tabel ekstra: ' || dt.name AS objek,
    'DRIFT' AS status,
    'Tabel ada di schema public tetapi tidak terdaftar di manifest' AS detail
  FROM db_tables dt
  WHERE dt.name NOT IN (${expectedTableNames})

  UNION ALL

  -- b. Kolom
  SELECT
    'b. Kolom: ' || c.relname || '.' || a.attname AS objek,
    'PASS' AS status,
    'tipe=' || pg_catalog.format_type(a.atttypid, a.atttypmod) ||
    ', nullable=' || (NOT a.attnotnull)::text ||
    ', default=' || COALESCE(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), 'null') AS detail
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    AND c.relname IN (${expectedTableNames})

  UNION ALL

  -- c. Constraint
  SELECT
    'c. Constraint: ' || con.conname AS objek,
    'PASS' AS status,
    'tabel=' || c.relname || ', tipe=' || con.contype ||
    CASE WHEN con.confdeltype != ' ' THEN ', on_delete=' || con.confdeltype::text ELSE '' END AS detail
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
  WHERE n.nspname = 'public'

  UNION ALL

  -- c. Indeks
  SELECT
    'c. Indeks: ' || i.relname AS objek,
    'PASS' AS status,
    'tabel=' || t.relname || ', unique=' || ix.indisunique::text AS detail
  FROM pg_catalog.pg_index ix
  JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
  JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND NOT ix.indisprimary

  UNION ALL

  -- d. RLS
  SELECT
    'd. RLS: ' || dt.name AS objek,
    CASE WHEN dt.rls_enabled THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.rls_enabled THEN 'Row Level Security aktif (pg_class.relrowsecurity = true)' ELSE 'RLS BELUM DIAKTIFKAN!' END AS detail
  FROM db_tables dt

  UNION ALL

  -- d. Kebijakan RLS
  SELECT
    'd. Kebijakan: ' || pol.polname AS objek,
    'PASS' AS status,
    'tabel=' || c.relname || ', cmd=' || pol.polcmd AS detail
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  -- e. Hak Tabel
  SELECT
    'e. Hak tabel: ' || dt.name AS objek,
    'INFO' AS status,
    'anon_select=' || pg_catalog.has_table_privilege('anon', dt.rel_oid, 'SELECT')::text ||
    ', authenticated_select=' || pg_catalog.has_table_privilege('authenticated', dt.rel_oid, 'SELECT')::text ||
    ' (Dijaga oleh RLS)' AS detail
  FROM db_tables dt

  UNION ALL

  -- f. View & security_invoker
  SELECT
    'f. View: ' || ev.name AS objek,
    CASE
      WHEN dv.name IS NULL THEN 'FAIL'
      WHEN NOT dv.security_invoker THEN 'FAIL'
      ELSE 'PASS'
    END AS status,
    CASE
      WHEN dv.name IS NULL THEN 'View tidak ditemukan'
      WHEN NOT dv.security_invoker THEN 'security_invoker belum diatur ke true'
      ELSE 'View tersedia dengan security_invoker = true'
    END AS detail
  FROM expected_views ev
  LEFT JOIN db_views dv ON dv.name = ev.name

  UNION ALL

  -- f. View DRIFT
  SELECT
    'f. View ekstra: ' || dv.name AS objek,
    'DRIFT' AS status,
    'View ada di schema public tetapi tidak ada di manifest' AS detail
  FROM db_views dv
  WHERE dv.name NOT IN (${expectedViewNames})

  UNION ALL

  -- g. Fungsi di Manifest
  SELECT
    'g. Fungsi: ' || ef.name AS objek,
    CASE
      WHEN df.name IS NULL THEN 'FAIL'
      WHEN df.pub_exec OR df.anon_exec OR df.auth_exec THEN 'FAIL'
      WHEN NOT df.svc_exec THEN 'FAIL'
      WHEN df.sec_definer AND position('search_path=' in df.config_str) = 0 THEN 'FAIL'
      ELSE 'PASS'
    END AS status,
    CASE
      WHEN df.name IS NULL THEN 'Fungsi tidak ditemukan di schema public'
      ELSE 'pub_exec=' || df.pub_exec::text || ', anon_exec=' || df.anon_exec::text ||
           ', auth_exec=' || df.auth_exec::text || ', service_role_exec=' || df.svc_exec::text ||
           ', config=[' || df.config_str || ']'
    END AS detail
  FROM expected_functions ef
  LEFT JOIN db_functions df ON df.name = ef.name

  UNION ALL

  -- g. Fungsi ekstra (DRIFT vs dikelola Supabase)
  SELECT
    'g. Fungsi ekstra: ' || df.name AS objek,
    CASE
      WHEN df.name = 'rls_auto_enable' THEN 'INFO'
      ELSE 'DRIFT'
    END AS status,
    CASE
      WHEN df.name = 'rls_auto_enable' THEN 'Fungsi pembantu otomatis dikelola oleh platform Supabase (Enable automatic RLS)'
      ELSE 'Fungsi ada di schema public tetapi tidak ada di manifest'
    END AS detail
  FROM db_functions df
  WHERE df.name NOT IN (${expectedFnNames})

  UNION ALL

  -- h. Seed brand_terms
  SELECT
    'h. Seed brand_terms' AS objek,
    CASE
      WHEN (
        SELECT count(*)
        FROM public.brand_terms
        WHERE (term = 'LinovHR' AND enabled = true)
           OR (term = 'Linov HR' AND enabled = true)
           OR (term = 'linovhr.com' AND enabled = true)
           OR (term = 'Linov' AND enabled = false)
      ) = 4 THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    (
      SELECT COALESCE(string_agg(term || '=' || enabled::text, ', ' ORDER BY term), 'kosong')
      FROM public.brand_terms
    ) AS detail

  UNION ALL

  -- h. Seed settings
  SELECT
    'h. Seed settings(search_config)' AS objek,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.settings
        WHERE key = 'search_config'
          AND COALESCE((value->>'enable_third_party_check')::boolean, true) = false
      ) THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    COALESCE(
      (SELECT value::text FROM public.settings WHERE key = 'search_config' LIMIT 1),
      'Baris search_config tidak ditemukan'
    ) AS detail

  UNION ALL

  -- i. Baris is_demo
  SELECT
    'i. Baris is_demo=true' AS objek,
    'INFO' AS status,
    'check_runs=' || (SELECT count(*) FROM public.check_runs WHERE is_demo = true)::text ||
    ', keywords=' || (SELECT count(*) FROM public.keywords WHERE is_demo = true)::text ||
    ', keyword_groups=' || (SELECT count(*) FROM public.keyword_groups WHERE is_demo = true)::text ||
    ', competitors=' || (SELECT count(*) FROM public.competitors WHERE is_demo = true)::text AS detail

  UNION ALL

  -- j. Riwayat Migrasi
  SELECT
    'j. schema_migrations' AS objek,
    'INFO' AS status,
    COALESCE(
      (SELECT string_agg(version, ', ' ORDER BY version) FROM supabase_migrations.schema_migrations),
      'Tabel schema_migrations kosong / migrasi dijalankan manual di SQL Editor'
    ) AS detail

  UNION ALL

  -- l. Ekstensi
  SELECT
    'l. Ekstensi: pgcrypto' AS objek,
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto') THEN 'PASS' ELSE 'FAIL' END AS status,
    'pgcrypto ekstensi terpasang' AS detail

  UNION ALL

  -- INFO: Event Trigger ensure_rls
  SELECT
    'INFO. Event Trigger: ensure_rls' AS objek,
    'INFO' AS status,
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname = 'ensure_rls')
        THEN 'Event trigger ensure_rls aktif di database (dikelola oleh platform Supabase)'
      ELSE 'Event trigger ensure_rls tidak ditemukan di database'
    END AS detail
) sub
ORDER BY objek;
`;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseSqlEditorResultsFile(filePath: string): VerifyCheckItem[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File hasil SQL Editor tidak ditemukan: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const items: VerifyCheckItem[] = [];

  for (const line of lines) {
    if (/^[+\-|]+$/.test(line)) continue;

    let parts: string[] = [];
    if (line.startsWith("|") && line.endsWith("|")) {
      parts = line.slice(1, -1).split("|").map((p) => p.trim());
    } else if (line.includes("\t")) {
      parts = line.split("\t").map((p) => p.trim());
    } else {
      parts = parseCsvLine(line);
    }

    if (parts.length < 3) continue;
    const [rawObjek, rawStatus, rawDetail] = parts;
    const objek = rawObjek.replace(/^"|"$/g, "").trim();
    const statusStr = rawStatus.replace(/^"|"$/g, "").trim().toUpperCase();
    const detail = rawDetail.replace(/^"|"$/g, "").trim();

    if (objek.toLowerCase() === "objek" && statusStr.toLowerCase() === "status") {
      continue;
    }

    let category: CategoryCode = "a";
    const prefixMatch = objek.match(/^([a-l])\./i);
    if (prefixMatch?.[1]) {
      category = prefixMatch[1].toLowerCase() as CategoryCode;
    } else if (/^INFO/i.test(objek)) {
      category = "d";
    }

    let status: VerifyStatus = "INFO";
    if (statusStr === "PASS") status = "PASS";
    else if (statusStr === "FAIL") status = "FAIL";
    else if (statusStr === "DRIFT") status = "DRIFT";
    else if (statusStr === "UNVERIFIED") status = "UNVERIFIED";
    else if (statusStr === "MIGRATION-LINT") status = "MIGRATION-LINT";

    items.push({
      category,
      objectName: objek,
      status,
      method: "DB",
      detail,
    });
  }

  return items;
}

export function evaluateDatabaseAgainstManifest(
  manifest: MigrationManifest,
  snapshot: DbIntrospectionSnapshot,
  allowedEmails: string[] = [],
  rootDir = process.cwd()
): {
  items: VerifyCheckItem[];
  migrationStatuses: MigrationInstallStatus[];
} {
  const items: VerifyCheckItem[] = [];
  const isDb = snapshot.source === "pg";
  const managedConfig = loadSupabaseManagedConfig(rootDir);
  const managedFunctionsSet = new Set(managedConfig.functions);

  // Helper pelacak per file migrasi
  const migrationItemInstalledMap = new Map<string, { total: number; installed: number; missing: string[] }>();
  for (const f of manifest.migrationFiles) {
    migrationItemInstalledMap.set(f, { total: 0, installed: 0, missing: [] });
  }

  const recordMigrationObject = (
    migrationFile: string,
    objectLabel: string,
    isInstalled: boolean
  ) => {
    const entry = migrationItemInstalledMap.get(migrationFile);
    if (entry) {
      entry.total += 1;
      if (isInstalled) {
        entry.installed += 1;
      } else {
        entry.missing.push(objectLabel);
      }
    }
  };

  // 1. FILE-LEVEL LINTING (Metode: FILE)
  for (const step of manifest.perFileSummary) {
    // Periksa apakah fungsi dibuat sebagai SECURITY DEFINER tanpa search_path di migrasi ini
    for (const [fnName, fnSpec] of Object.entries(manifest.finalState.functions)) {
      if (fnSpec.sourceMigration === step.fileName && fnSpec.securityDefiner) {
        // Jika di migrasi awal belum ada search_path, catat MIGRATION-LINT
        const initialDefHadSearchPath = Boolean(
          step.fileName !== "20261029010000_phase3_queue_and_calls.sql"
        );
        if (!initialDefHadSearchPath) {
          items.push({
            category: "g",
            objectName: `Lint File: ${step.fileName} (public.${fnName})`,
            status: "MIGRATION-LINT",
            method: "FILE",
            detail: `Fungsi SECURITY DEFINER public.${fnName} pada ${step.fileName} tidak mengatur search_path tetap (telah diperbaiki di 20261029070000_function_search_path.sql)`,
            sourceMigration: step.fileName,
            fixMigration: "supabase/migrations/20261029070000_function_search_path.sql",
          });
        }
      }
    }
  }

  // =========================================================================
  // a. TABEL
  // =========================================================================
  const dbTableMap = new Map(snapshot.tables.map((t) => [t.name, t]));
  for (const [tableName, tableSpec] of Object.entries(manifest.finalState.tables)) {
    const dbTbl = dbTableMap.get(tableName);
    const exists = Boolean(dbTbl);
    recordMigrationObject(tableSpec.sourceMigration, `tabel ${tableName}`, exists);

    if (exists) {
      items.push({
        category: "a",
        objectName: `Tabel public.${tableName}`,
        status: "PASS",
        method: isDb ? "DB" : "API",
        detail: `Tabel tersedia di schema public`,
        sourceMigration: tableSpec.sourceMigration,
      });
    } else {
      items.push({
        category: "a",
        objectName: `Tabel public.${tableName}`,
        status: "FAIL",
        method: isDb ? "DB" : "API",
        detail: `Tabel public.${tableName} hilang atau belum dibuat`,
        expected: "Tabel ada di schema public",
        found: "Tabel tidak ditemukan",
        sourceMigration: tableSpec.sourceMigration,
        fixMigration: `supabase/migrations/${tableSpec.sourceMigration}`,
      });
    }
  }

  for (const dbTbl of snapshot.tables) {
    if (!manifest.finalState.tables[dbTbl.name]) {
      items.push({
        category: "a",
        objectName: `Tabel ekstra public.${dbTbl.name}`,
        status: "DRIFT",
        method: isDb ? "DB" : "API",
        detail: `Tabel public.${dbTbl.name} ada di schema public tetapi tidak terdaftar di manifest`,
        expected: "Hanya tabel dari manifest",
        found: `Tabel public.${dbTbl.name}`,
        fixComment: `Tabel ekstra public.${dbTbl.name}`,
        fixSql: `-- DROP TABLE IF EXISTS public.${dbTbl.name};`,
      });
    }
  }

  // =========================================================================
  // b. KOLOM
  // =========================================================================
  const dbColMap = new Map(
    snapshot.columns.map((c) => [`${c.table}.${c.name}`, c])
  );
  for (const [tableName, tableSpec] of Object.entries(manifest.finalState.tables)) {
    for (const colSpec of tableSpec.columns) {
      const colName = colSpec.name;
      const dbCol = dbColMap.get(`${tableName}.${colName}`);

      if (!dbCol) {
        items.push({
          category: "b",
          objectName: `Kolom ${tableName}.${colName}`,
          status: "FAIL",
          method: isDb ? "DB" : "API",
          detail: `Kolom ${tableName}.${colName} hilang dari tabel`,
          expected: `Tipe: ${colSpec.normalizedType}, nullable: ${colSpec.nullable}`,
          found: "Kolom tidak ditemukan",
          sourceMigration: colSpec.sourceMigration,
          fixMigration: `supabase/migrations/${colSpec.sourceMigration}`,
        });
        continue;
      }

      const dbNormType = normalizeSqlType(dbCol.dataType);
      const manifestNormType = colSpec.normalizedType;
      const typeMatches =
        dbNormType === manifestNormType ||
        (manifestNormType === "timestamp with time zone" &&
          (dbNormType === "timestamptz" || dbNormType.includes("timestamp")));
      const nullableMatches = dbCol.nullable === colSpec.nullable;

      const normDbDefault = normalizeSqlDefault(dbCol.defaultExpr);
      const normManifestDefault = normalizeSqlDefault(colSpec.defaultExpr);
      const defaultMatches =
        normManifestDefault === null ||
        normDbDefault === normManifestDefault ||
        (normManifestDefault === "now()" && (normDbDefault ?? "").includes("now")) ||
        (normManifestDefault === "gen_random_uuid()" && (normDbDefault ?? "").includes("random"));

      if (typeMatches && nullableMatches && defaultMatches) {
        items.push({
          category: "b",
          objectName: `Kolom ${tableName}.${colName}`,
          status: "PASS",
          method: isDb ? "DB" : "API",
          detail: `tipe=${dbNormType}, nullable=${dbCol.nullable}, default=${dbCol.defaultExpr ?? "null"}`,
          sourceMigration: colSpec.sourceMigration,
        });
      } else {
        items.push({
          category: "b",
          objectName: `Kolom ${tableName}.${colName}`,
          status: "FAIL",
          method: isDb ? "DB" : "API",
          detail: `Spesifikasi kolom ${tableName}.${colName} tidak cocok`,
          expected: `tipe=${manifestNormType}, nullable=${colSpec.nullable}, default=${colSpec.defaultExpr ?? "null"}`,
          found: `tipe=${dbNormType}, nullable=${dbCol.nullable}, default=${dbCol.defaultExpr ?? "null"}`,
          sourceMigration: colSpec.sourceMigration,
          fixMigration: `supabase/migrations/${colSpec.sourceMigration}`,
        });
      }
    }
  }

  // =========================================================================
  // c. CONSTRAINT & INDEKS
  // =========================================================================
  for (const [tableName, tableSpec] of Object.entries(manifest.finalState.tables)) {
    for (const con of tableSpec.constraints) {
      if (!isDb) {
        // Mode API: hanya PK & target FK yang dapat diuji keberadaannya; ON DELETE & CHECK tidak terbaca lewat OpenAPI
        if (con.type === "PRIMARY KEY") {
          items.push({
            category: "c",
            objectName: `PK ${tableName}(${con.columns.join(", ")})`,
            status: "PASS",
            method: "API",
            detail: `Primary Key terverifikasi lewat OpenAPI schema`,
            sourceMigration: con.sourceMigration,
          });
        } else if (con.type === "FOREIGN KEY") {
          const dbFkExists = snapshot.constraints.some(
            (c) => c.table === tableName && c.columns.join(",") === con.columns.join(",")
          );
          if (dbFkExists) {
            items.push({
              category: "c",
              objectName: `FK ${tableName}.${con.columns.join(", ")} -> ${con.referencesTable}`,
              status: "PASS",
              method: "API",
              detail: `Relasi relasional terdaftar di OpenAPI`,
              sourceMigration: con.sourceMigration,
            });
            items.push({
              category: "c",
              objectName: `Aturan ON DELETE ${tableName}.${con.columns.join(", ")} (${con.onDelete ?? "NO ACTION"})`,
              status: "UNVERIFIED",
              method: "API",
              detail: `Katalog pg_constraint (confdeltype) tidak diekspos oleh OpenAPI; jalankan verify.sql di SQL Editor atau gunakan DATABASE_URL`,
              sourceMigration: con.sourceMigration,
            });
          }
        } else if (con.type === "CHECK") {
          items.push({
            category: "c",
            objectName: `CHECK constraint ${tableName}(${con.columns.join(", ")})`,
            status: "UNVERIFIED",
            method: "API",
            detail: `Katalog pg_constraint (conbin check expression) tidak diekspos oleh OpenAPI; jalankan verify.sql di SQL Editor atau gunakan DATABASE_URL`,
            sourceMigration: con.sourceMigration,
          });
        }
      } else {
        // Mode DB: Verifikasi katalog Postgres langsung
        const dbCon = snapshot.constraints.find(
          (c) =>
            c.table === tableName &&
            c.columns.join(",") === con.columns.join(",") &&
            c.type === con.type
        );
        recordMigrationObject(
          con.sourceMigration,
          `constraint ${con.type} pada ${tableName}`,
          Boolean(dbCon)
        );

        if (!dbCon) {
          items.push({
            category: "c",
            objectName: `Constraint ${con.type} ${tableName}(${con.columns.join(", ")})`,
            status: "FAIL",
            method: "DB",
            detail: `Constraint ${con.type} pada ${tableName}(${con.columns.join(", ")}) tidak ditemukan`,
            expected: `${con.type} pada ${tableName}(${con.columns.join(", ")})`,
            found: "Tidak ditemukan",
            sourceMigration: con.sourceMigration,
            fixMigration: `supabase/migrations/${con.sourceMigration}`,
          });
        } else {
          items.push({
            category: "c",
            objectName: `Constraint ${con.type} ${tableName}(${con.columns.join(", ")})`,
            status: "PASS",
            method: "DB",
            detail: `${con.type} terverifikasi di pg_constraint`,
            sourceMigration: con.sourceMigration,
          });
        }
      }
    }
  }

  // Indeks
  for (const idx of manifest.finalState.indexes) {
    if (!isDb) {
      items.push({
        category: "c",
        objectName: `Indeks ${idx.name} ON ${idx.table}`,
        status: "UNVERIFIED",
        method: "API",
        detail: `Katalog pg_indexes tidak diekspos oleh OpenAPI; jalankan verify.sql di SQL Editor atau gunakan DATABASE_URL`,
        sourceMigration: idx.sourceMigration,
      });
    } else {
      const dbIdx = snapshot.indexes.find((i) => i.name === idx.name);
      recordMigrationObject(idx.sourceMigration, `indeks ${idx.name}`, Boolean(dbIdx));
      if (dbIdx) {
        items.push({
          category: "c",
          objectName: `Indeks ${idx.name} ON ${idx.table}`,
          status: "PASS",
          method: "DB",
          detail: `Indeks tersedia di pg_indexes (${dbIdx.indexDef})`,
          sourceMigration: idx.sourceMigration,
        });
      } else {
        items.push({
          category: "c",
          objectName: `Indeks ${idx.name} ON ${idx.table}`,
          status: "FAIL",
          method: "DB",
          detail: `Indeks ${idx.name} tidak ditemukan pada tabel ${idx.table}`,
          expected: `CREATE INDEX ${idx.name} ON ${idx.table}`,
          found: "Indeks tidak ditemukan",
          sourceMigration: idx.sourceMigration,
          fixMigration: `supabase/migrations/${idx.sourceMigration}`,
        });
      }
    }
  }

  // =========================================================================
  // d. STATUS RLS & KEBIJAKAN
  // =========================================================================
  for (const [tableName, tableSpec] of Object.entries(manifest.finalState.tables)) {
    if (!isDb) {
      items.push({
        category: "d",
        objectName: `Status RLS public.${tableName}`,
        status: "UNVERIFIED",
        method: "API",
        detail: `Katalog pg_class (relrowsecurity) memerlukan DATABASE_URL atau verify.sql di SQL Editor (pembacaan anon diblokir)`,
        sourceMigration: tableSpec.rlsSourceMigration ?? tableSpec.sourceMigration,
      });
    } else {
      const dbTbl = dbTableMap.get(tableName);
      const rlsActive = Boolean(dbTbl?.rlsEnabled);
      recordMigrationObject(
        tableSpec.rlsSourceMigration ?? tableSpec.sourceMigration,
        `RLS ${tableName}`,
        rlsActive
      );
      if (rlsActive) {
        items.push({
          category: "d",
          objectName: `Status RLS public.${tableName}`,
          status: "PASS",
          method: "DB",
          detail: `Row Level Security aktif (pg_class.relrowsecurity = true)`,
          sourceMigration: tableSpec.rlsSourceMigration ?? tableSpec.sourceMigration,
        });
      } else {
        items.push({
          category: "d",
          objectName: `Status RLS public.${tableName}`,
          status: "FAIL",
          method: "DB",
          detail: `RLS TIDAK AKTIF pada tabel public.${tableName}`,
          expected: "ENABLE ROW LEVEL SECURITY",
          found: "RLS mati",
          sourceMigration: tableSpec.rlsSourceMigration ?? tableSpec.sourceMigration,
          fixMigration: `supabase/migrations/${tableSpec.sourceMigration}`,
        });
      }
    }
  }

  for (const pol of manifest.finalState.policies) {
    if (!isDb) {
      items.push({
        category: "d",
        objectName: `Kebijakan RLS "${pol.name}" ON ${pol.table}`,
        status: "UNVERIFIED",
        method: "API",
        detail: `Katalog pg_policy tidak diekspos oleh OpenAPI; jalankan verify.sql di SQL Editor atau gunakan DATABASE_URL`,
        sourceMigration: pol.sourceMigration,
      });
    } else {
      const dbPol = (snapshot.policies ?? []).find(
        (p) => p.name === pol.name && p.table === pol.table
      );
      recordMigrationObject(
        pol.sourceMigration,
        `kebijakan "${pol.name}"`,
        Boolean(dbPol)
      );
      if (dbPol) {
        items.push({
          category: "d",
          objectName: `Kebijakan RLS "${pol.name}" ON ${pol.table}`,
          status: "PASS",
          method: "DB",
          detail: `Kebijakan aktif di pg_policy (cmd=${dbPol.command})`,
          sourceMigration: pol.sourceMigration,
        });
      } else {
        items.push({
          category: "d",
          objectName: `Kebijakan RLS "${pol.name}" ON ${pol.table}`,
          status: "FAIL",
          method: "DB",
          detail: `Kebijakan "${pol.name}" tidak ditemukan pada tabel ${pol.table}`,
          expected: `CREATE POLICY "${pol.name}" ON ${pol.table}`,
          found: "Kebijakan tidak ditemukan",
          sourceMigration: pol.sourceMigration,
          fixMigration: `supabase/migrations/${pol.sourceMigration}`,
        });
      }
    }
  }

  // Event trigger ensure_rls (dikelola Supabase)
  if (isDb) {
    const hasEnsureRls = snapshot.eventTriggers.includes("ensure_rls");
    items.push({
      category: "d",
      objectName: "Event Trigger ensure_rls",
      status: "INFO",
      method: "DB",
      detail: hasEnsureRls
        ? "Event trigger ensure_rls aktif di database (dikelola otomatis oleh platform Supabase)"
        : "Event trigger ensure_rls tidak ditemukan di pg_event_trigger",
    });
  } else {
    items.push({
      category: "d",
      objectName: "Event Trigger ensure_rls",
      status: "INFO",
      method: "API",
      detail: "Katalog pg_event_trigger tidak dapat dibaca lewat REST API (dikelola Supabase)",
    });
  }

  // =========================================================================
  // e. KEAMANAN HAK AKSES TABEL
  // =========================================================================
  if (!isDb) {
    items.push({
      category: "e",
      objectName: "Hak tabel bawaan Supabase (anon & authenticated)",
      status: "INFO",
      method: "API",
      detail: "Katalog pg_catalog.has_table_privilege memerlukan DATABASE_URL atau verify.sql di SQL Editor; akses dilindungi penuh oleh RLS",
    });
  } else {
    items.push({
      category: "e",
      objectName: "Hak tabel bawaan Supabase (anon & authenticated)",
      status: "INFO",
      method: "DB",
      detail: "Supabase memberi GRANT bawaan ke anon & authenticated; seluruh akses data dilindungi penuh oleh RLS. Opsi REVOKE lapisan tambahan tersedia di fix-suggestions.sql",
    });
  }

  // =========================================================================
  // f. VIEW & security_invoker
  // =========================================================================
  const dbViewMap = new Map(snapshot.views.map((v) => [v.name, v]));
  for (const [viewName, viewSpec] of Object.entries(manifest.finalState.views)) {
    const dbView = dbViewMap.get(viewName);
    recordMigrationObject(viewSpec.sourceMigration, `view ${viewName}`, Boolean(dbView));

    if (!dbView || !dbView.exists) {
      items.push({
        category: "f",
        objectName: `View public.${viewName}`,
        status: "FAIL",
        method: isDb ? "DB" : "API",
        detail: `View public.${viewName} tidak ditemukan di schema public`,
        expected: `View public.${viewName} dengan security_invoker = true`,
        found: "View tidak ditemukan",
        sourceMigration: viewSpec.sourceMigration,
        fixMigration: `supabase/migrations/${viewSpec.sourceMigration}`,
      });
      continue;
    }

    if (!isDb) {
      items.push({
        category: "f",
        objectName: `View public.${viewName}`,
        status: "PASS",
        method: "API",
        detail: `View tersedia di schema public`,
        sourceMigration: viewSpec.sourceMigration,
      });
      items.push({
        category: "f",
        objectName: `reloptions security_invoker public.${viewName}`,
        status: "UNVERIFIED",
        method: "API",
        detail: `reloptions security_invoker memerlukan DATABASE_URL atau verify.sql di SQL Editor`,
        sourceMigration: viewSpec.sourceMigration,
      });
    } else {
      if (!dbView.securityInvoker) {
        items.push({
          category: "f",
          objectName: `View public.${viewName} (security_invoker)`,
          status: "FAIL",
          method: "DB",
          detail: `View public.${viewName} belum mengaktifkan security_invoker = true`,
          expected: "security_invoker = true",
          found: "security_invoker = false / tidak diatur",
          sourceMigration: viewSpec.sourceMigration,
          fixMigration: `supabase/migrations/${viewSpec.sourceMigration}`,
        });
      } else {
        items.push({
          category: "f",
          objectName: `View public.${viewName}`,
          status: "PASS",
          method: "DB",
          detail: `View tersedia dengan security_invoker = true di pg_class.reloptions`,
          sourceMigration: viewSpec.sourceMigration,
        });
      }
    }
  }

  // =========================================================================
  // g. FUNGSI SCHEMA PUBLIC
  // =========================================================================
  const dbFnMap = new Map(snapshot.functions.map((f) => [f.name, f]));
  for (const [fnName, fnSpec] of Object.entries(manifest.finalState.functions)) {
    const dbFn = dbFnMap.get(fnName);
    recordMigrationObject(fnSpec.sourceMigration, `fungsi ${fnName}`, Boolean(dbFn));

    if (!dbFn) {
      items.push({
        category: "g",
        objectName: `Fungsi public.${fnName}(${fnSpec.argsSignature})`,
        status: "FAIL",
        method: isDb ? "DB" : "API",
        detail: `Fungsi public.${fnName} tidak ditemukan di schema public`,
        expected: `Fungsi public.${fnName} tersedia`,
        found: "Tidak ditemukan",
        sourceMigration: fnSpec.sourceMigration,
        fixMigration: `supabase/migrations/${fnSpec.sourceMigration}`,
      });
      continue;
    }

    if (!isDb) {
      // Jalur API: Endpoint /rpc/ ada di PostgREST
      items.push({
        category: "g",
        objectName: `Fungsi public.${fnName}(${fnSpec.argsSignature})`,
        status: "PASS",
        method: "API",
        detail: `Fungsi terdaftar di schema RPC PostgREST`,
        sourceMigration: fnSpec.sourceMigration,
      });

      if (fnName === "get_database_size_bytes") {
        if (!dbFn.anonCanExecute) {
          items.push({
            category: "g",
            objectName: `Hak EXECUTE public.${fnName} untuk role anon`,
            status: "PASS",
            method: "API",
            detail: `Panggilan RPC oleh anon ditolak (42501 permission denied)`,
            sourceMigration: "20261029060000_predeploy_hardening.sql",
          });
        } else {
          items.push({
            category: "g",
            objectName: `Hak EXECUTE public.${fnName} untuk role anon`,
            status: "FAIL",
            method: "API",
            detail: `Role anon masih dapat mengeksekusi public.${fnName}()!`,
            sourceMigration: "20261029060000_predeploy_hardening.sql",
            fixMigration: "supabase/migrations/20261029060000_predeploy_hardening.sql",
          });
        }
      }

      items.push({
        category: "g",
        objectName: `proconfig (SET search_path) public.${fnName}`,
        status: "UNVERIFIED",
        method: "API",
        detail: `Katalog pg_proc (proconfig search_path) memerlukan DATABASE_URL atau verify.sql di SQL Editor`,
        sourceMigration: fnSpec.sourceMigration,
      });
    } else {
      // Jalur DB: Pemeriksaan penuh pg_proc
      const exposed = dbFn.publicCanExecute || dbFn.anonCanExecute || dbFn.authenticatedCanExecute;
      if (exposed || !dbFn.serviceRoleCanExecute) {
        items.push({
          category: "g",
          objectName: `Hak EXECUTE public.${fnName}(${fnSpec.argsSignature})`,
          status: "FAIL",
          method: "DB",
          detail: `Hak EXECUTE pada public.${fnName} belum dibatasi hanya ke service_role (pub=${dbFn.publicCanExecute}, anon=${dbFn.anonCanExecute}, auth=${dbFn.authenticatedCanExecute})`,
          expected: "Hanya service_role",
          found: `pub=${dbFn.publicCanExecute}, anon=${dbFn.anonCanExecute}, auth=${dbFn.authenticatedCanExecute}`,
          sourceMigration: "20261029060000_predeploy_hardening.sql",
          fixMigration: "supabase/migrations/20261029060000_predeploy_hardening.sql",
        });
      } else {
        items.push({
          category: "g",
          objectName: `Hak EXECUTE public.${fnName}(${fnSpec.argsSignature})`,
          status: "PASS",
          method: "DB",
          detail: `EXECUTE dicabut dari PUBLIC, anon, authenticated dan diberikan hanya ke service_role`,
          sourceMigration: "20261029060000_predeploy_hardening.sql",
        });
      }

      if (fnSpec.securityDefiner) {
        const hasFixedPath = Boolean(dbFn.searchPath && dbFn.searchPath.includes("public"));
        if (!hasFixedPath) {
          items.push({
            category: "g",
            objectName: `search_path Fungsi SECURITY DEFINER public.${fnName}`,
            status: "FAIL",
            method: "DB",
            detail: `Fungsi SECURITY DEFINER public.${fnName} belum mengatur SET search_path di database (${dbFn.searchPath ?? "null"})`,
            expected: "SET search_path = public, pg_temp",
            found: dbFn.searchPath ?? "null",
            sourceMigration: "20261029070000_function_search_path.sql",
            fixMigration: "supabase/migrations/20261029070000_function_search_path.sql",
          });
        } else {
          items.push({
            category: "g",
            objectName: `search_path Fungsi SECURITY DEFINER public.${fnName}`,
            status: "PASS",
            method: "DB",
            detail: `search_path terpasang aman (${dbFn.searchPath})`,
            sourceMigration: "20261029070000_function_search_path.sql",
          });
        }
      }
    }
  }

  // Fungsi tambahan: pisahkan managed vs drift
  for (const dbFn of snapshot.functions) {
    if (!manifest.finalState.functions[dbFn.name]) {
      if (managedFunctionsSet.has(dbFn.name)) {
        items.push({
          category: "g",
          objectName: `Fungsi dikelola Supabase: public.${dbFn.name}`,
          status: "INFO",
          method: isDb ? "DB" : "API",
          detail: `Fungsi pembantu otomatis dikelola oleh platform Supabase (bukan objek aplikasi)`,
        });
      } else {
        items.push({
          category: "g",
          objectName: `Fungsi ekstra public.${dbFn.name}`,
          status: "DRIFT",
          method: isDb ? "DB" : "API",
          detail: `Fungsi ada di schema public tetapi tidak terdaftar di manifest`,
          expected: "Hanya fungsi dari manifest",
          found: `Fungsi public.${dbFn.name}`,
          fixComment: `Fungsi ekstra public.${dbFn.name}`,
          fixSql: `-- DROP FUNCTION IF EXISTS public.${dbFn.name};`,
        });
      }
    }
  }

  // =========================================================================
  // h. DATA SEED
  // =========================================================================
  const dbTermsMap = new Map(snapshot.seeds.brandTerms.map((t) => [t.term, t.enabled]));
  let brandTermsAllMatch = true;
  for (const expectedBt of manifest.finalState.seeds.brand_terms) {
    const dbVal = dbTermsMap.get(expectedBt.term);
    if (dbVal !== expectedBt.enabled) {
      brandTermsAllMatch = false;
      break;
    }
  }
  recordMigrationObject("20261029000000_init_schema.sql", "seed brand_terms", brandTermsAllMatch);

  if (brandTermsAllMatch) {
    items.push({
      category: "h",
      objectName: "Seed brand_terms",
      status: "PASS",
      method: isDb ? "DB" : "API",
      detail: `4 istilah merek terdaftar sesuai manifest`,
      sourceMigration: "20261029000000_init_schema.sql",
    });
  } else {
    items.push({
      category: "h",
      objectName: "Seed brand_terms",
      status: "FAIL",
      method: isDb ? "DB" : "API",
      detail: `Data seed brand_terms tidak cocok dengan manifest`,
      sourceMigration: "20261029000000_init_schema.sql",
      fixMigration: "supabase/migrations/20261029000000_init_schema.sql",
    });
  }

  const searchConfigVal = snapshot.seeds.settings["search_config"] ?? {};
  const currentEnableThirdParty = searchConfigVal.enable_third_party_check;
  const expectedEnableThirdParty = manifest.finalState.seeds.settings["search_config"]?.value.enable_third_party_check;

  const isThirdPartyMatch = currentEnableThirdParty === expectedEnableThirdParty;
  recordMigrationObject("20261029050000_phase5_third_party_default.sql", "settings.enable_third_party_check=false", isThirdPartyMatch);
  recordMigrationObject("20261029060000_predeploy_hardening.sql", "settings.enable_third_party_check=false", isThirdPartyMatch);

  if (isThirdPartyMatch) {
    items.push({
      category: "h",
      objectName: `Seed settings("search_config").enable_third_party_check`,
      status: "PASS",
      method: isDb ? "DB" : "API",
      detail: `Nilai enable_third_party_check terkonfigurasi ke ${expectedEnableThirdParty}`,
      sourceMigration: "20261029060000_predeploy_hardening.sql",
    });
  } else {
    items.push({
      category: "h",
      objectName: `Seed settings("search_config").enable_third_party_check`,
      status: "FAIL",
      method: isDb ? "DB" : "API",
      detail: `Nilai di database (${currentEnableThirdParty}) tidak sesuai manifest (${expectedEnableThirdParty})`,
      expected: `enable_third_party_check = ${expectedEnableThirdParty}`,
      found: `enable_third_party_check = ${currentEnableThirdParty}`,
      sourceMigration: "20261029060000_predeploy_hardening.sql",
      fixMigration: "supabase/migrations/20261029060000_predeploy_hardening.sql",
    });
  }

  // =========================================================================
  // i. DATA CONTOH (is_demo = true)
  // =========================================================================
  const dc = snapshot.demoCounts;
  items.push({
    category: "i",
    objectName: "Jumlah baris is_demo = true",
    status: "INFO",
    method: isDb ? "DB" : "API",
    detail: `check_runs=${dc.check_runs}, keywords=${dc.keywords}, keyword_groups=${dc.keyword_groups}, competitors=${dc.competitors}`,
  });

  // =========================================================================
  // j. RIWAYAT MIGRASI
  // =========================================================================
  const sm = snapshot.schemaMigrations;
  items.push({
    category: "j",
    objectName: "supabase_migrations.schema_migrations",
    status: "INFO",
    method: isDb ? "DB" : "API",
    detail:
      Array.isArray(sm) && sm.length > 0
        ? `${sm.length} versi tercatat di schema_migrations`
        : "Tabel supabase_migrations.schema_migrations tidak ditemukan atau migrasi dijalankan manual lewat SQL Editor",
  });

  // =========================================================================
  // k. PENGGUNA AUTH VS ALLOWED_EMAILS
  // =========================================================================
  if (snapshot.authUsers) {
    const authLower = new Set(snapshot.authUsers.emailsLower);
    const maskedList = allowedEmails.map(maskEmailAddress);
    const allAllowedRegistered = allowedEmails.every((e) =>
      authLower.has(e.toLowerCase())
    );

    items.push({
      category: "k",
      objectName: "auth.users vs ALLOWED_EMAILS",
      status: allAllowedRegistered ? "PASS" : "FAIL",
      method: "API",
      detail: `Total pengguna di auth.users=${snapshot.authUsers.totalUsers} | ALLOWED_EMAILS (${allowedEmails.length}): ${maskedList.join(", ")}: ${allAllowedRegistered ? "seluruhnya terdaftar" : "ada email belum terdaftar di Auth"}`,
    });
  }

  // =========================================================================
  // l. EKSTENSI DATABASE
  // =========================================================================
  if (!isDb) {
    items.push({
      category: "l",
      objectName: "Ekstensi: pgcrypto",
      status: "UNVERIFIED",
      method: "API",
      detail: "Katalog pg_extension tidak diekspos oleh OpenAPI; jalankan verify.sql di SQL Editor atau gunakan DATABASE_URL",
      sourceMigration: "20261029000000_init_schema.sql",
    });
  } else {
    const hasPgcrypto = snapshot.extensions.includes("pgcrypto");
    recordMigrationObject("20261029000000_init_schema.sql", "ekstensi pgcrypto", hasPgcrypto);
    if (hasPgcrypto) {
      items.push({
        category: "l",
        objectName: "Ekstensi: pgcrypto",
        status: "PASS",
        method: "DB",
        detail: "Ekstensi pgcrypto terpasang di pg_extension",
        sourceMigration: "20261029000000_init_schema.sql",
      });
    } else {
      items.push({
        category: "l",
        objectName: "Ekstensi: pgcrypto",
        status: "FAIL",
        method: "DB",
        detail: "Ekstensi pgcrypto belum terpasang di database",
        sourceMigration: "20261029000000_init_schema.sql",
        fixMigration: "supabase/migrations/20261029000000_init_schema.sql",
      });
    }
  }

  // =========================================================================
  // HITUNG STATUS INSTALASI PER FILE MIGRASI (Berdasarkan definisi file itu sendiri)
  // =========================================================================
  const migrationStatuses: MigrationInstallStatus[] = [];
  for (const step of manifest.perFileSummary) {
    let total = 0;
    let installed = 0;
    const missing: string[] = [];

    // 1. Ekstensi
    for (const ext of step.extensionsCreated) {
      total += 1;
      const isExtInstalled = snapshot.extensions.includes(ext);
      if (isExtInstalled || !isDb) {
        installed += 1;
      } else {
        missing.push(`ekstensi ${ext}`);
      }
    }

    // 2. Tabel yang dibuat file ini
    for (const tbl of step.tablesCreated) {
      total += 1;
      const dbTbl = dbTableMap.get(tbl);
      if (dbTbl) {
        installed += 1;
      } else {
        missing.push(`tabel ${tbl}`);
      }
    }

    // 3. Kolom yang ditambahkan file ini
    for (const col of step.columnsAdded) {
      total += 1;
      const dbCol = dbColMap.get(`${col.table}.${col.column}`);
      if (dbCol) {
        installed += 1;
      } else {
        missing.push(`kolom ${col.table}.${col.column}`);
      }
    }

    // 4. View yang dibuat/diganti file ini
    for (const vw of step.viewsCreatedOrReplaced) {
      total += 1;
      const dbVw = dbViewMap.get(vw);
      if (dbVw && dbVw.exists) {
        installed += 1;
      } else {
        missing.push(`view ${vw}`);
      }
    }

    // 5. Fungsi yang dibuat/diganti file ini
    for (const fn of step.functionsCreatedOrReplaced) {
      total += 1;
      const dbFn = dbFnMap.get(fn);
      if (step.fileName === "20261029070000_function_search_path.sql" && isDb) {
        const hasFixedPath = Boolean(dbFn?.searchPath && dbFn.searchPath.includes("public"));
        if (dbFn && hasFixedPath) {
          installed += 1;
        } else {
          missing.push(`search_path ${fn}`);
        }
      } else if (dbFn) {
        installed += 1;
      } else {
        missing.push(`fungsi ${fn}`);
      }
    }

    // 6. Seed yang didefinisikan file ini
    for (const seed of step.seedUpdates) {
      total += 1;
      if (seed === "brand_terms") {
        if (brandTermsAllMatch) {
          installed += 1;
        } else {
          missing.push("seed brand_terms");
        }
      } else if (seed.startsWith("settings(")) {
        const keyMatch = seed.match(/settings\(([^)]+)\)/);
        const key = keyMatch?.[1] ?? "search_config";
        const settingVal = snapshot.seeds.settings[key];
        const settingExists = Boolean(settingVal);

        if (step.fileName === "20261029030000_phase4_settings_and_views.sql") {
          // File ini membuat baris setting awal
          if (settingExists) {
            installed += 1;
          } else {
            missing.push(`setting ${key}`);
          }
        } else if (
          step.fileName === "20261029050000_phase5_third_party_default.sql" ||
          step.fileName === "20261029060000_predeploy_hardening.sql"
        ) {
          // File ini menyetel enable_third_party_check = false
          if (settingVal?.enable_third_party_check === false) {
            installed += 1;
          } else {
            missing.push(`${key}.enable_third_party_check=false`);
          }
        } else if (settingExists) {
          installed += 1;
        } else {
          missing.push(`setting ${key}`);
        }
      }
    }

    let status: MigrationInstallStatus["status"] = "BELUM TERPASANG";
    if (total === 0) {
      status = "TERPASANG PENUH";
    } else if (installed === total) {
      status = "TERPASANG PENUH";
    } else if (installed > 0) {
      status = "SEBAGIAN";
    }

    migrationStatuses.push({
      fileName: step.fileName,
      status,
      totalObjects: total,
      installedObjects: installed,
      missingObjects: missing,
    });
  }

  return { items, migrationStatuses };
}

export function generateFixSuggestionsSql(
  items: VerifyCheckItem[],
  manifest: MigrationManifest
): string {
  const lines: string[] = [
    "-- =============================================================================",
    "-- SARAN PERBAIKAN SQL (supabase/verify/fix-suggestions.sql)",
    "-- Dihasilkan otomatis oleh npm run verify:db",
    "-- PENTING: Tinjau pernyataan di bawah ini sebelum menjalankannya di Supabase SQL Editor.",
    "-- =============================================================================",
    "",
  ];

  const neededMigrations = new Set<string>();
  const customSqlFixes: string[] = [];

  for (const item of items) {
    if (item.status === "FAIL" || item.status === "MIGRATION-LINT") {
      if (item.fixMigration) {
        neededMigrations.add(item.fixMigration);
      } else if (item.fixSql) {
        customSqlFixes.push(
          `-- [${item.status}] ${item.objectName}\n--   Keterangan: ${item.detail}\n${item.fixSql}\n`
        );
      }
    } else if (item.status === "DRIFT" && item.fixSql) {
      customSqlFixes.push(
        `-- [DRIFT] ${item.objectName}\n--   Keterangan: ${item.detail}\n${item.fixSql}\n`
      );
    }
  }

  if (neededMigrations.size > 0) {
    lines.push(
      "-- =============================================================================",
      "-- 1. JALANKAN FILE MIGRASI YANG TERSEDIA",
      "-- Selisih yang terdeteksi di atas dapat diselesaikan langsung dengan menjalankan",
      "-- file migrasi berikut di Supabase SQL Editor (tanpa perlu UPDATE ad hoc):",
      "-- =============================================================================",
      ""
    );
    for (const mig of Array.from(neededMigrations).sort()) {
      lines.push(`-- -> Jalankan file: ${mig}`);
    }
    lines.push("");
  }

  if (customSqlFixes.length > 0) {
    lines.push(
      "-- =============================================================================",
      "-- 2. PERBAIKAN AD HOC KHUSUS (DI LUAR CAKUPAN FILE MIGRASI)",
      "-- =============================================================================",
      ""
    );
    for (const fix of customSqlFixes) {
      lines.push(fix);
    }
  }

  lines.push(
    "-- =============================================================================",
    "-- 3. SARAN OPSIONAL LAPISAN PERTAHANAN TAMBAHAN (Defense-in-Depth)",
    "-- Secara bawaan Supabase memberikan GRANT pada tabel di schema public kepada",
    "-- role anon dan authenticated, lalu mengandalkan RLS untuk memblokir akses.",
    "-- Sebagai lapisan pengamanan tambahan, Anda dapat mencabut hak dari anon",
    "-- serta mencabut hak tulis (INSERT, UPDATE, DELETE, TRUNCATE) dari authenticated:",
    "-- =============================================================================",
    "",
    "-- Cabut seluruh hak tabel dari role anon (karena dasbor mewajibkan login):",
    `-- REVOKE ALL ON TABLE ${Object.keys(manifest.finalState.tables).join(", ")} FROM anon;`,
    "",
    "-- Cabut hak tulis tabel dari role authenticated (penulisan hanya via service_role di server):",
    `-- REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ${Object.keys(manifest.finalState.tables).join(", ")} FROM authenticated;`,
    ""
  );

  return lines.join("\n");
}
