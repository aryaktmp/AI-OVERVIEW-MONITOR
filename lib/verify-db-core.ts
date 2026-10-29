import type { MigrationManifest } from "./migration-manifest.ts";
import {
  normalizeSqlDefault,
  normalizeSqlType,
  normalizeViewSql,
} from "./migration-manifest.ts";

export type VerifyStatus = "PASS" | "FAIL" | "DRIFT" | "INFO";

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
  detail: string;
  expected?: string;
  found?: string;
  sourceMigration?: string;
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

export interface DbIntrospectionSnapshot {
  source: "pg" | "supabase-rest";
  extensions: string[];
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
    command: string; // SELECT, INSERT, UPDATE, DELETE, ALL
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

/**
 * Menyamarkan alamat email sesuai format a***@domain.com
 */
export function maskEmailAddress(email: string): string {
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0) return "***";
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  return `${local[0]}***@${domain}`;
}

/**
 * Kumpulan kueri SQL murni BACA SAJA (SELECT dari pg_catalog) yang dikirim oleh verify-db.
 * Tidak memuat kata kunci perubahan data atau skema.
 */
export const VERIFY_DB_READONLY_QUERIES = {
  beginReadOnly: "BEGIN READ ONLY;",
  rollback: "ROLLBACK;",

  extensions: `
    SELECT extname AS name
    FROM pg_catalog.pg_extension
    ORDER BY extname;
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
      pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS column_default
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
      rel.relname AS table_name,
      con.conname AS constraint_name,
      con.contype AS constraint_code,
      ARRAY(
        SELECT att.attname
        FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_catalog.pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = k.attnum
        ORDER BY k.ord
      ) AS columns,
      frel.relname AS ref_table,
      ARRAY(
        SELECT fatt.attname
        FROM unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord)
        JOIN pg_catalog.pg_attribute fatt
          ON fatt.attrelid = con.confrelid AND fatt.attnum = fk.attnum
        ORDER BY fk.ord
      ) AS ref_columns,
      con.confdeltype AS on_del_code,
      pg_catalog.pg_get_expr(con.conbin, con.conrelid) AS check_expr
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
    LEFT JOIN pg_catalog.pg_class frel ON frel.oid = con.confrelid
    WHERE nsp.nspname = 'public'
      AND rel.relkind = 'r'
    ORDER BY rel.relname, con.conname;
  `,

  indexes: `
    SELECT
      ic.relname AS index_name,
      tc.relname AS table_name,
      i.indisunique AS is_unique,
      i.indisprimary AS is_primary,
      pg_catalog.pg_get_indexdef(i.indexrelid) AS index_def
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_catalog.pg_class tc ON tc.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = tc.relnamespace
    WHERE n.nspname = 'public'
      AND NOT i.indisprimary
    ORDER BY tc.relname, ic.relname;
  `,

  policies: `
    SELECT
      pol.polname AS policy_name,
      c.relname AS table_name,
      pol.polcmd AS cmd_code,
      ARRAY(
        SELECT
          CASE
            WHEN r_oid = 0 THEN 'public'
            ELSE pg_catalog.pg_get_userbyid(r_oid)
          END
        FROM unnest(pol.polroles) AS r_oid
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
      pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel,
      pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_sel,
      c.relacl::text AS raw_acl
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname;
  `,

  views: `
    SELECT
      c.relname AS view_name,
      c.reloptions AS rel_options,
      pg_catalog.pg_get_viewdef(c.oid, true) AS view_def
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
    ORDER BY c.relname;
  `,

  functions: `
    SELECT
      p.proname AS fn_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS args_sig,
      pg_catalog.pg_get_function_result(p.oid) AS result_type,
      l.lanname AS language_name,
      p.prosecdef AS security_definer,
      p.proconfig AS pro_config,
      pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS pub_exec,
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
      pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
      pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `,

  brandTermsSeed: `
    SELECT term, enabled
    FROM public.brand_terms
    ORDER BY term;
  `,

  settingsSeed: `
    SELECT key, value
    FROM public.settings
    ORDER BY key;
  `,

  demoCounts: `
    SELECT
      (SELECT count(*)::int FROM public.check_runs WHERE is_demo = true) AS check_runs_demo,
      (SELECT count(*)::int FROM public.keywords WHERE is_demo = true) AS keywords_demo,
      (SELECT count(*)::int FROM public.keyword_groups WHERE is_demo = true) AS keyword_groups_demo,
      (SELECT count(*)::int FROM public.competitors WHERE is_demo = true) AS competitors_demo;
  `,

  schemaMigrationsExists: `
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'supabase_migrations'
        AND c.relname = 'schema_migrations'
    ) AS exists_flag;
  `,

  schemaMigrationsRows: `
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    ORDER BY version;
  `,

  authUsers: `
    SELECT email
    FROM auth.users
    ORDER BY email;
  `,
} as const;

/**
 * Menghasilkan file supabase/verify/verify.sql berisi satu kueri SELECT (CTE) baca-saja
 * yang menghasilkan satu tabel hasil (objek, status, detail) untuk dijalankan di Supabase SQL Editor.
 */
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
expected_indexes(name) AS (
  VALUES ${manifest.finalState.indexes.map((i) => `('${i.name}')`).join(", ")}
),
db_tables AS (
  SELECT c.relname AS name, c.relrowsecurity AS rls_enabled, c.oid AS rel_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
db_views AS (
  SELECT
    c.relname AS name,
    COALESCE('security_invoker=true' = ANY(c.reloptions), false) AS security_invoker,
    pg_catalog.pg_get_viewdef(c.oid, true) AS view_def
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
),
db_functions AS (
  SELECT
    p.proname AS name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS args_sig,
    p.prosecdef AS sec_definer,
    COALESCE(array_to_string(p.proconfig, ', '), '') AS config_str,
    pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS pub_exec,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
db_policies AS (
  SELECT
    pol.polname AS policy_name,
    c.relname AS table_name,
    pol.polcmd AS cmd_code,
    ARRAY(
      SELECT CASE WHEN r_oid = 0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(r_oid) END
      FROM unnest(pol.polroles) AS r_oid
    ) AS roles
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
),
checks_union AS (
  -- a. Pemeriksaan Tabel di Manifest
  SELECT
    'a. Tabel: ' || et.name AS objek,
    CASE WHEN dt.name IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.name IS NOT NULL THEN 'Tabel tersedia di schema public' ELSE 'Tabel tidak ditemukan di schema public' END AS detail
  FROM expected_tables et
  LEFT JOIN db_tables dt ON dt.name = et.name

  UNION ALL

  -- a. Tabel DRIFT (ada di public tapi tidak ada di manifest)
  SELECT
    'a. Tabel ekstra: ' || dt.name AS objek,
    'DRIFT' AS status,
    'Tabel ada di schema public tetapi tidak terdaftar di manifest migrasi' AS detail
  FROM db_tables dt
  WHERE dt.name NOT IN (${expectedTableNames})

  UNION ALL

  -- c. Indeks di Manifest
  SELECT
    'c. Indeks: ' || ei.name AS objek,
    CASE WHEN ic.relname IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN ic.relname IS NOT NULL THEN 'Indeks tersedia' ELSE 'Indeks belum dibuat' END AS detail
  FROM expected_indexes ei
  LEFT JOIN pg_catalog.pg_class ic ON ic.relname = ei.name AND ic.relkind = 'i'

  UNION ALL

  -- d & e. Status RLS per Tabel
  SELECT
    'd/e. RLS Tabel: ' || dt.name AS objek,
    CASE WHEN dt.rls_enabled THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.rls_enabled THEN 'Row Level Security (RLS) aktif' ELSE 'RLS TIDAK AKTIF pada tabel public!' END AS detail
  FROM db_tables dt

  UNION ALL

  -- e. Kebijakan untuk anon atau non-SELECT untuk authenticated
  SELECT
    'e. Kebijakan: ' || dp.table_name || ' -> ' || dp.policy_name AS objek,
    CASE
      WHEN 'anon' = ANY(dp.roles) OR 'public' = ANY(dp.roles) THEN 'FAIL'
      WHEN 'authenticated' = ANY(dp.roles) AND dp.cmd_code <> 'r' THEN 'FAIL'
      ELSE 'PASS'
    END AS status,
    'Roles=' || array_to_string(dp.roles, ',') || ' | cmd_code=' || dp.cmd_code AS detail
  FROM db_policies dp

  UNION ALL

  -- e. Hak Tabel (INFO saja)
  SELECT
    'e. Hak Tabel (INFO): ' || dt.name AS objek,
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

  -- g. Fungsi di Manifest (keberadaan, hak EXECUTE, dan search_path)
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

  -- g. Fungsi DRIFT
  SELECT
    'g. Fungsi ekstra: ' || df.name AS objek,
    'DRIFT' AS status,
    'Fungsi ada di schema public tetapi tidak ada di manifest' AS detail
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

  -- h. Seed settings (enable_third_party_check = false)
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

  -- i. Jumlah baris is_demo = true (INFO)
  SELECT
    'i. Baris is_demo=true' AS objek,
    'INFO' AS status,
    'check_runs=' || (SELECT count(*) FROM public.check_runs WHERE is_demo = true)::text ||
    ', keywords=' || (SELECT count(*) FROM public.keywords WHERE is_demo = true)::text ||
    ', keyword_groups=' || (SELECT count(*) FROM public.keyword_groups WHERE is_demo = true)::text ||
    ', competitors=' || (SELECT count(*) FROM public.competitors WHERE is_demo = true)::text AS detail

  UNION ALL

  -- l. Ekstensi pgcrypto
  SELECT
    'l. Ekstensi: pgcrypto' AS objek,
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto') THEN 'PASS' ELSE 'FAIL' END AS status,
    'Terpasang: ' || COALESCE((SELECT string_agg(extname, ', ' ORDER BY extname) FROM pg_catalog.pg_extension), 'tidak ada') AS detail
)
SELECT objek, status, detail
FROM checks_union;
`;
}

/**
 * Membandingkan snapshot database dengan manifest dan menghasilkan daftar pemeriksaan
 * untuk kategori a s/d l serta status per file migrasi.
 */
export function evaluateDatabaseAgainstManifest(
  manifest: MigrationManifest,
  snapshot: DbIntrospectionSnapshot,
  allowedEmails: string[]
): {
  items: VerifyCheckItem[];
  migrationStatuses: MigrationInstallStatus[];
} {
  const items: VerifyCheckItem[] = [];
  const missingByMigration = new Map<string, string[]>();
  const totalByMigration = new Map<string, number>();

  const recordMigrationObject = (
    migrationFile: string | undefined,
    label: string,
    installed: boolean
  ) => {
    if (!migrationFile) return;
    totalByMigration.set(
      migrationFile,
      (totalByMigration.get(migrationFile) ?? 0) + 1
    );
    if (!installed) {
      const list = missingByMigration.get(migrationFile) ?? [];
      list.push(label);
      missingByMigration.set(migrationFile, list);
    }
  };

  const dbTableMap = new Map(snapshot.tables.map((t) => [t.name, t]));
  const manifestTables = manifest.finalState.tables;

  // =========================================================================
  // a. TABEL
  // =========================================================================
  for (const [tableName, tblSpec] of Object.entries(manifestTables)) {
    const dbTbl = dbTableMap.get(tableName);
    const exists = Boolean(dbTbl);
    recordMigrationObject(tblSpec.sourceMigration, `tabel ${tableName}`, exists);

    if (exists) {
      items.push({
        category: "a",
        objectName: `Tabel public.${tableName}`,
        status: "PASS",
        detail: `Tabel tersedia (asal: ${tblSpec.sourceMigration})`,
        sourceMigration: tblSpec.sourceMigration,
      });
    } else {
      const colsSql = tblSpec.columns
        .map(
          (c) =>
            `  ${c.name} ${c.dataType}${c.nullable ? "" : " not null"}${
              c.defaultExpr ? ` default ${c.defaultExpr}` : ""
            }${c.isPrimaryKey ? " primary key" : ""}${c.isUnique ? " unique" : ""}`
        )
        .join(",\n");
      items.push({
        category: "a",
        objectName: `Tabel public.${tableName}`,
        status: "FAIL",
        detail: `Tabel public.${tableName} tidak ditemukan di database`,
        expected: `Tabel public.${tableName} ada`,
        found: "Tidak ada",
        sourceMigration: tblSpec.sourceMigration,
        fixComment: `Buat tabel public.${tableName} sesuai ${tblSpec.sourceMigration}`,
        fixSql: `CREATE TABLE IF NOT EXISTS public.${tableName} (\n${colsSql}\n);`,
      });
    }
  }

  for (const dbTbl of snapshot.tables) {
    if (!manifestTables[dbTbl.name]) {
      items.push({
        category: "a",
        objectName: `Tabel ekstra public.${dbTbl.name}`,
        status: "DRIFT",
        detail: `Tabel public.${dbTbl.name} ada di database tetapi tidak terdaftar di manifest migrasi`,
        expected: "Tidak ada di schema public (atau didokumentasikan di migrasi)",
        found: `Tabel public.${dbTbl.name} ditemukan`,
        fixComment: `Periksa tabel ekstra public.${dbTbl.name} sebelum menghapus atau tambahkan ke file migrasi`,
        fixSql: `-- Opsional jika tabel tidak dipakai:\n-- DROP TABLE IF EXISTS public.${dbTbl.name};`,
      });
    }
  }

  // =========================================================================
  // b. KOLOM
  // =========================================================================
  const dbColsByTable = new Map<
    string,
    Map<
      string,
      {
        table: string;
        name: string;
        dataType: string;
        nullable: boolean;
        defaultExpr: string | null;
      }
    >
  >();
  for (const col of snapshot.columns) {
    let map = dbColsByTable.get(col.table);
    if (!map) {
      map = new Map();
      dbColsByTable.set(col.table, map);
    }
    map.set(col.name, col);
  }

  for (const [tableName, tblSpec] of Object.entries(manifestTables)) {
    const tableCols = dbColsByTable.get(tableName);
    if (!dbTableMap.has(tableName)) continue;

    for (const colSpec of tblSpec.columns) {
      const dbCol = tableCols?.get(colSpec.name);
      if (!dbCol) {
        recordMigrationObject(
          colSpec.sourceMigration,
          `kolom ${tableName}.${colSpec.name}`,
          false
        );
        items.push({
          category: "b",
          objectName: `Kolom ${tableName}.${colSpec.name}`,
          status: "FAIL",
          detail: `Kolom ${colSpec.name} tidak ditemukan pada tabel ${tableName}`,
          expected: `${colSpec.normalizedType}, nullable=${colSpec.nullable}, default=${colSpec.defaultExpr ?? "null"}`,
          found: "Kolom tidak ada",
          sourceMigration: colSpec.sourceMigration,
          fixComment: `Tambahkan kolom ${tableName}.${colSpec.name} sesuai ${colSpec.sourceMigration}`,
          fixSql: `ALTER TABLE public.${tableName} ADD COLUMN IF NOT EXISTS ${colSpec.name} ${colSpec.dataType}${
            colSpec.nullable ? "" : " NOT NULL"
          }${colSpec.defaultExpr ? ` DEFAULT ${colSpec.defaultExpr}` : ""};`,
        });
        continue;
      }

      recordMigrationObject(
        colSpec.sourceMigration,
        `kolom ${tableName}.${colSpec.name}`,
        true
      );

      const dbTypeNorm = normalizeSqlType(dbCol.dataType);
      const typeMatches = dbTypeNorm === colSpec.normalizedType;
      const nullMatches =
        snapshot.source === "supabase-rest"
          ? true
          : dbCol.nullable === colSpec.nullable;
      const expectedDefNorm = normalizeSqlDefault(colSpec.defaultExpr);
      const dbDefNorm = normalizeSqlDefault(dbCol.defaultExpr);
      const defaultMatches =
        snapshot.source === "supabase-rest"
          ? true
          : expectedDefNorm === dbDefNorm;

      if (typeMatches && nullMatches && defaultMatches) {
        items.push({
          category: "b",
          objectName: `Kolom ${tableName}.${colSpec.name}`,
          status: "PASS",
          detail: `Tipe=${dbTypeNorm}, nullable=${dbCol.nullable}, default=${dbCol.defaultExpr ?? "null"}`,
          sourceMigration: colSpec.sourceMigration,
        });
      } else {
        items.push({
          category: "b",
          objectName: `Kolom ${tableName}.${colSpec.name}`,
          status: "FAIL",
          detail: `Spesifikasi kolom ${tableName}.${colSpec.name} tidak cocok`,
          expected: `tipe=${colSpec.normalizedType}, nullable=${colSpec.nullable}, default=${expectedDefNorm ?? "null"}`,
          found: `tipe=${dbTypeNorm}, nullable=${dbCol.nullable}, default=${dbDefNorm ?? "null"}`,
          sourceMigration: colSpec.sourceMigration,
          fixComment: `Sesuaikan tipe/default/nullability kolom ${tableName}.${colSpec.name}`,
          fixSql: [
            !typeMatches
              ? `ALTER TABLE public.${tableName} ALTER COLUMN ${colSpec.name} TYPE ${colSpec.dataType};`
              : "",
            !defaultMatches && colSpec.defaultExpr
              ? `ALTER TABLE public.${tableName} ALTER COLUMN ${colSpec.name} SET DEFAULT ${colSpec.defaultExpr};`
              : "",
            !nullMatches
              ? `ALTER TABLE public.${tableName} ALTER COLUMN ${colSpec.name} ${
                  colSpec.nullable ? "DROP NOT NULL" : "SET NOT NULL"
                };`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }
    }

    if (tableCols) {
      const expectedColSet = new Set(tblSpec.columns.map((c) => c.name));
      for (const dbCol of tableCols.values()) {
        if (!expectedColSet.has(dbCol.name)) {
          items.push({
            category: "b",
            objectName: `Kolom ekstra ${tableName}.${dbCol.name}`,
            status: "DRIFT",
            detail: `Kolom ${tableName}.${dbCol.name} (${dbCol.dataType}) tidak ada di manifest`,
            expected: "Tidak ada di manifest",
            found: `${tableName}.${dbCol.name} (${dbCol.dataType})`,
            fixComment: `Kolom ekstra ${tableName}.${dbCol.name} terdeteksi di luar manifest`,
            fixSql: `-- Opsional jika kolom tidak diperlukan:\n-- ALTER TABLE public.${tableName} DROP COLUMN IF EXISTS ${dbCol.name};`,
          });
        }
      }
    }
  }

  // =========================================================================
  // c. CONSTRAINT (PK, UNIQUE, FK, CHECK) & INDEKS
  // =========================================================================
  for (const [tableName, tblSpec] of Object.entries(manifestTables)) {
    if (!dbTableMap.has(tableName)) continue;
    const dbTableConstraints = snapshot.constraints.filter(
      (c) => c.table === tableName
    );

    for (const conSpec of tblSpec.constraints) {
      if (conSpec.type === "PRIMARY KEY") {
        const foundPk = dbTableConstraints.find(
          (c) =>
            c.type === "PRIMARY KEY" &&
            c.columns.join(",") === conSpec.columns.join(",")
        );
        if (foundPk || snapshot.source === "supabase-rest") {
          items.push({
            category: "c",
            objectName: `PK ${tableName}(${conSpec.columns.join(", ")})`,
            status: "PASS",
            detail: "Primary key cocok",
            sourceMigration: conSpec.sourceMigration,
          });
        } else {
          items.push({
            category: "c",
            objectName: `PK ${tableName}(${conSpec.columns.join(", ")})`,
            status: "FAIL",
            detail: `Primary key pada ${tableName}(${conSpec.columns.join(", ")}) tidak ditemukan`,
            expected: `PRIMARY KEY (${conSpec.columns.join(", ")})`,
            found: "Tidak ada",
            sourceMigration: conSpec.sourceMigration,
            fixComment: `Tambahkan primary key pada ${tableName}`,
            fixSql: `ALTER TABLE public.${tableName} ADD PRIMARY KEY (${conSpec.columns.join(", ")});`,
          });
        }
      } else if (conSpec.type === "UNIQUE") {
        const foundUq = dbTableConstraints.find(
          (c) =>
            c.type === "UNIQUE" &&
            c.columns.join(",") === conSpec.columns.join(",")
        );
        if (foundUq || snapshot.source === "supabase-rest") {
          items.push({
            category: "c",
            objectName: `UNIQUE ${tableName}(${conSpec.columns.join(", ")})`,
            status: "PASS",
            detail:
              snapshot.source === "supabase-rest"
                ? "Constraint UNIQUE tercatat di manifest (verifikasi detail katalog di verify.sql)"
                : "Constraint UNIQUE cocok",
            sourceMigration: conSpec.sourceMigration,
          });
        } else {
          items.push({
            category: "c",
            objectName: `UNIQUE ${tableName}(${conSpec.columns.join(", ")})`,
            status: "FAIL",
            detail: `Constraint UNIQUE pada ${tableName}(${conSpec.columns.join(", ")}) tidak ditemukan`,
            expected: `UNIQUE (${conSpec.columns.join(", ")})`,
            found: "Tidak ada",
            sourceMigration: conSpec.sourceMigration,
            fixComment: `Tambahkan constraint UNIQUE pada ${tableName}(${conSpec.columns.join(", ")})`,
            fixSql: `ALTER TABLE public.${tableName} ADD CONSTRAINT ${tableName}_${conSpec.columns.join("_")}_key UNIQUE (${conSpec.columns.join(", ")});`,
          });
        }
      } else if (conSpec.type === "FOREIGN KEY") {
        const foundFk = dbTableConstraints.find(
          (c) =>
            c.type === "FOREIGN KEY" &&
            c.columns.join(",") === conSpec.columns.join(",") &&
            c.referencesTable === conSpec.referencesTable
        );
        const onDeleteMatches =
          snapshot.source === "supabase-rest"
            ? true
            : foundFk?.onDelete === conSpec.onDelete;

        if (foundFk && onDeleteMatches) {
          items.push({
            category: "c",
            objectName: `FK ${tableName}(${conSpec.columns.join(", ")}) -> ${conSpec.referencesTable}(${conSpec.referencesColumn})`,
            status: "PASS",
            detail: `Foreign key cocok (ON DELETE ${conSpec.onDelete})`,
            sourceMigration: conSpec.sourceMigration,
          });
        } else {
          items.push({
            category: "c",
            objectName: `FK ${tableName}(${conSpec.columns.join(", ")}) -> ${conSpec.referencesTable}(${conSpec.referencesColumn})`,
            status: "FAIL",
            detail: `Foreign key atau aturan ON DELETE pada ${tableName}.${conSpec.columns.join(",")} tidak cocok`,
            expected: `REFERENCES ${conSpec.referencesTable}(${conSpec.referencesColumn}) ON DELETE ${conSpec.onDelete}`,
            found: foundFk
              ? `REFERENCES ${foundFk.referencesTable}(${foundFk.referencesColumn}) ON DELETE ${foundFk.onDelete}`
              : "Tidak ada",
            sourceMigration: conSpec.sourceMigration,
            fixComment: `Perbaiki foreign key ${tableName}.${conSpec.columns[0]} -> ${conSpec.referencesTable}(${conSpec.referencesColumn})`,
            fixSql: `ALTER TABLE public.${tableName} ADD FOREIGN KEY (${conSpec.columns.join(", ")}) REFERENCES public.${conSpec.referencesTable}(${conSpec.referencesColumn}) ON DELETE ${conSpec.onDelete};`,
          });
        }
      }
    }
  }

  const dbIndexMap = new Map(snapshot.indexes.map((i) => [i.name, i]));
  for (const idxSpec of manifest.finalState.indexes) {
    if (snapshot.source === "supabase-rest") {
      items.push({
        category: "c",
        objectName: `Indeks ${idxSpec.name} ON ${idxSpec.table}(${idxSpec.columnsExpr})`,
        status: "INFO",
        detail: `Katalog pg_index memerlukan DATABASE_URL atau jalankan supabase/verify/verify.sql di SQL Editor`,
        sourceMigration: idxSpec.sourceMigration,
      });
      continue;
    }

    const dbIdx = dbIndexMap.get(idxSpec.name);
    recordMigrationObject(
      idxSpec.sourceMigration,
      `indeks ${idxSpec.name}`,
      Boolean(dbIdx)
    );
    if (dbIdx) {
      items.push({
        category: "c",
        objectName: `Indeks ${idxSpec.name}`,
        status: "PASS",
        detail: `Indeks tersedia pada ${idxSpec.table} (${idxSpec.columnsExpr})`,
        sourceMigration: idxSpec.sourceMigration,
      });
    } else {
      items.push({
        category: "c",
        objectName: `Indeks ${idxSpec.name}`,
        status: "FAIL",
        detail: `Indeks ${idxSpec.name} pada tabel ${idxSpec.table} belum ada`,
        expected: `CREATE INDEX ${idxSpec.name} ON public.${idxSpec.table} (${idxSpec.columnsExpr})`,
        found: "Tidak ada",
        sourceMigration: idxSpec.sourceMigration,
        fixComment: `Buat indeks ${idxSpec.name} sesuai ${idxSpec.sourceMigration}`,
        fixSql: `CREATE INDEX IF NOT EXISTS ${idxSpec.name} ON public.${idxSpec.table} (${idxSpec.columnsExpr});`,
      });
    }
  }

  // =========================================================================
  // d & e. RLS, KEBIJAKAN, DAN HAK AKSES TABEL
  // =========================================================================
  for (const [tableName, tblSpec] of Object.entries(manifestTables)) {
    const dbTbl = dbTableMap.get(tableName);
    if (!dbTbl) continue;

    if (dbTbl.rlsEnabled === true) {
      recordMigrationObject(
        tblSpec.rlsSourceMigration ?? tblSpec.sourceMigration,
        `RLS ${tableName}`,
        true
      );
      items.push({
        category: "d",
        objectName: `RLS public.${tableName}`,
        status: "PASS",
        detail: "Row Level Security (RLS) aktif",
        sourceMigration: tblSpec.rlsSourceMigration ?? tblSpec.sourceMigration,
      });
    } else {
      recordMigrationObject(
        tblSpec.rlsSourceMigration ?? tblSpec.sourceMigration,
        `RLS ${tableName}`,
        false
      );
      items.push({
        category: "e",
        objectName: `RLS public.${tableName}`,
        status: "FAIL",
        detail: `Tabel public.${tableName} TIDAK memiliki RLS aktif!`,
        expected: "RLS aktif (relrowsecurity = true)",
        found: "RLS mati (relrowsecurity = false)",
        sourceMigration: tblSpec.rlsSourceMigration ?? tblSpec.sourceMigration,
        fixComment: `Aktifkan Row Level Security (RLS) pada tabel public.${tableName}`,
        fixSql: `ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY;`,
      });
    }
  }

  if (snapshot.policies !== null) {
    const dbPolMap = new Map(
      snapshot.policies.map((p) => [`${p.table}::${p.name}`, p])
    );

    for (const polSpec of manifest.finalState.policies) {
      const key = `${polSpec.table}::${polSpec.name}`;
      const dbPol = dbPolMap.get(key);
      recordMigrationObject(
        polSpec.sourceMigration,
        `policy "${polSpec.name}" pada ${polSpec.table}`,
        Boolean(dbPol)
      );

      if (dbPol) {
        items.push({
          category: "d",
          objectName: `Kebijakan "${polSpec.name}" (${polSpec.table})`,
          status: "PASS",
          detail: `FOR ${dbPol.command} TO ${dbPol.roles.join(",")} USING (${dbPol.usingExpr})`,
          sourceMigration: polSpec.sourceMigration,
        });
      } else {
        items.push({
          category: "d",
          objectName: `Kebijakan "${polSpec.name}" (${polSpec.table})`,
          status: "FAIL",
          detail: `Kebijakan RLS "${polSpec.name}" pada tabel ${polSpec.table} tidak ditemukan`,
          expected: `FOR ${polSpec.command} TO ${polSpec.roles.join(", ")} USING (${polSpec.usingExpr})`,
          found: "Tidak ada",
          sourceMigration: polSpec.sourceMigration,
          fixComment: `Buat kebijakan RLS "${polSpec.name}" pada tabel ${polSpec.table}`,
          fixSql: `CREATE POLICY "${polSpec.name}" ON public.${polSpec.table} FOR ${polSpec.command} TO ${polSpec.roles.join(", ")} USING (${polSpec.usingExpr});`,
        });
      }
    }

    // Periksa kebijakan berbahaya (anon atau INSERT/UPDATE/DELETE untuk authenticated) & DRIFT
    const expectedPolKeys = new Set(
      manifest.finalState.policies.map((p) => `${p.table}::${p.name}`)
    );

    for (const dbPol of snapshot.policies) {
      const key = `${dbPol.table}::${dbPol.name}`;
      const hasAnon =
        dbPol.roles.includes("anon") || dbPol.roles.includes("public");
      const hasAuthWrite =
        dbPol.roles.includes("authenticated") && dbPol.command !== "SELECT";

      if (hasAnon) {
        items.push({
          category: "e",
          objectName: `Kebijakan terlarang anon: "${dbPol.name}" (${dbPol.table})`,
          status: "FAIL",
          detail: `Kebijakan "${dbPol.name}" pada ${dbPol.table} berlaku untuk role anon/public!`,
          expected: "Tidak ada kebijakan RLS untuk anon/public",
          found: `Roles: ${dbPol.roles.join(", ")} (${dbPol.command})`,
          fixComment: `Hapus kebijakan "${dbPol.name}" pada ${dbPol.table} yang membuka akses ke anon/public`,
          fixSql: `DROP POLICY IF EXISTS "${dbPol.name}" ON public.${dbPol.table};`,
        });
      } else if (hasAuthWrite) {
        items.push({
          category: "e",
          objectName: `Kebijakan tulis authenticated: "${dbPol.name}" (${dbPol.table})`,
          status: "FAIL",
          detail: `Kebijakan "${dbPol.name}" pada ${dbPol.table} mengizinkan ${dbPol.command} untuk authenticated!`,
          expected: "Hanya kebijakan SELECT untuk authenticated (tulis hanya via service_role)",
          found: `FOR ${dbPol.command} TO ${dbPol.roles.join(", ")}`,
          fixComment: `Hapus kebijakan tulis "${dbPol.name}" untuk authenticated pada ${dbPol.table}`,
          fixSql: `DROP POLICY IF EXISTS "${dbPol.name}" ON public.${dbPol.table};`,
        });
      } else if (!expectedPolKeys.has(key)) {
        items.push({
          category: "d",
          objectName: `Kebijakan ekstra: "${dbPol.name}" (${dbPol.table})`,
          status: "DRIFT",
          detail: `Kebijakan "${dbPol.name}" pada ${dbPol.table} tidak ada di manifest`,
          expected: "Tidak ada di manifest",
          found: `"${dbPol.name}" FOR ${dbPol.command} TO ${dbPol.roles.join(", ")}`,
          fixComment: `Kebijakan ekstra "${dbPol.name}" pada ${dbPol.table}`,
          fixSql: `-- DROP POLICY IF EXISTS "${dbPol.name}" ON public.${dbPol.table};`,
        });
      }
    }
  } else {
    items.push({
      category: "d",
      objectName: "Daftar kebijakan pg_policy",
      status: "INFO",
      detail:
        "Katalog pg_policy memerlukan koneksi Postgres langsung (DATABASE_URL) atau jalankan supabase/verify/verify.sql di SQL Editor; pembacaan anon via kunci publishable sudah terverifikasi ditolak/0 baris oleh RLS.",
    });
  }

  // Hak tabel untuk anon dan authenticated hanya dilaporkan sebagai INFO
  items.push({
    category: "e",
    objectName: "Hak tabel bawaan Supabase (anon & authenticated)",
    status: "INFO",
    detail:
      "Supabase memberi GRANT tabel secara bawaan ke anon dan authenticated; akses data tetap dijaga penuh oleh RLS. Saran opsional REVOKE lapisan tambahan disertakan di supabase/verify/fix-suggestions.sql.",
  });

  // =========================================================================
  // f. VIEW & SECURITY_INVOKER
  // =========================================================================
  const dbViewMap = new Map(snapshot.views.map((v) => [v.name, v]));
  for (const [viewName, viewSpec] of Object.entries(manifest.finalState.views)) {
    const dbView = dbViewMap.get(viewName);
    const exists = Boolean(dbView?.exists);
    recordMigrationObject(
      viewSpec.sourceMigration,
      `view ${viewName}`,
      exists
    );

    if (!exists) {
      items.push({
        category: "f",
        objectName: `View public.${viewName}`,
        status: "FAIL",
        detail: `View public.${viewName} tidak ditemukan di database`,
        expected: `View public.${viewName} dengan security_invoker = true`,
        found: "Tidak ada",
        sourceMigration: viewSpec.sourceMigration,
        fixComment: `Buat kembali view public.${viewName} dengan security_invoker = true`,
        fixSql: `CREATE OR REPLACE VIEW public.${viewName}\nWITH (security_invoker = true)\nAS\n${viewSpec.definitionSql};`,
      });
      continue;
    }

    if (dbView?.securityInvoker === false) {
      items.push({
        category: "f",
        objectName: `View public.${viewName} (security_invoker)`,
        status: "FAIL",
        detail: `View public.${viewName} belum mengaktifkan security_invoker = true`,
        expected: "security_invoker = true",
        found: "security_invoker = false / tidak diatur",
        sourceMigration: viewSpec.sourceMigration,
        fixComment: `Aktifkan security_invoker = true pada view public.${viewName}`,
        fixSql: `ALTER VIEW public.${viewName} SET (security_invoker = true);`,
      });
    } else {
      items.push({
        category: "f",
        objectName: `View public.${viewName}`,
        status: "PASS",
        detail:
          dbView?.securityInvoker === true
            ? "View tersedia dan memakai security_invoker = true"
            : "View tersedia dan dapat diakses (detail reloptions diverifikasi lewat verify.sql)",
        sourceMigration: viewSpec.sourceMigration,
      });
    }

    if (dbView?.definitionSql) {
      const dbNorm = normalizeViewSql(dbView.definitionSql);
      const usesCheckRunsJoin = dbNorm.includes("check_runs");
      const manifestUsesCheckRunsJoin =
        viewSpec.normalizedDefinition.includes("check_runs");
      if (usesCheckRunsJoin !== manifestUsesCheckRunsJoin) {
        items.push({
          category: "f",
          objectName: `Definisi View public.${viewName}`,
          status: "DRIFT",
          detail: `Definisi view public.${viewName} di database berbeda dengan manifest`,
          expected: viewSpec.normalizedDefinition,
          found: dbNorm,
          sourceMigration: viewSpec.sourceMigration,
          fixComment: `Selaraskan definisi view public.${viewName} dengan manifest`,
          fixSql: `CREATE OR REPLACE VIEW public.${viewName}\nWITH (security_invoker = true)\nAS\n${viewSpec.definitionSql};`,
        });
      }
    }
  }

  for (const dbView of snapshot.views) {
    if (dbView.exists && !manifest.finalState.views[dbView.name]) {
      items.push({
        category: "f",
        objectName: `View ekstra public.${dbView.name}`,
        status: "DRIFT",
        detail: `View public.${dbView.name} ada di database tetapi tidak terdaftar di manifest`,
        expected: "Tidak ada di manifest",
        found: `View public.${dbView.name}`,
        fixComment: `View ekstra public.${dbView.name}`,
        fixSql: `-- DROP VIEW IF EXISTS public.${dbView.name};`,
      });
    }
  }

  // =========================================================================
  // g. FUNGSI DI SCHEMA PUBLIC
  // =========================================================================
  const dbFnMap = new Map(snapshot.functions.map((f) => [f.name, f]));
  for (const [fnName, fnSpec] of Object.entries(manifest.finalState.functions)) {
    const dbFn = dbFnMap.get(fnName);
    recordMigrationObject(
      fnSpec.sourceMigration,
      `fungsi ${fnName}(${fnSpec.argsSignature})`,
      Boolean(dbFn)
    );

    if (!dbFn) {
      items.push({
        category: "g",
        objectName: `Fungsi public.${fnName}(${fnSpec.argsSignature})`,
        status: "FAIL",
        detail: `Fungsi public.${fnName} tidak ditemukan di schema public`,
        expected: `Fungsi public.${fnName}(${fnSpec.argsSignature}) tersedia & hanya dapat dieksekusi oleh service_role`,
        found: "Fungsi tidak ditemukan (belum dimigrasi)",
        sourceMigration: fnSpec.sourceMigration,
        fixComment: `Jalankan migrasi ${fnSpec.sourceMigration} dan ${
          fnSpec.modifiedByMigrations[fnSpec.modifiedByMigrations.length - 1]
        } untuk membuat dan mengamankan fungsi public.${fnName}`,
        fixSql: `-- Jalankan definisi fungsi public.${fnName} dari ${fnSpec.sourceMigration}, lalu:\nREVOKE ALL ON FUNCTION public.${fnName}(${fnSpec.argsSignature}) FROM PUBLIC, anon, authenticated;\nREVOKE EXECUTE ON FUNCTION public.${fnName}(${fnSpec.argsSignature}) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.${fnName}(${fnSpec.argsSignature}) TO service_role;`,
      });
      continue;
    }

    const exposedToPublicOrAnonOrAuth =
      dbFn.publicCanExecute ||
      dbFn.anonCanExecute ||
      dbFn.authenticatedCanExecute;

    const latestPermMigration =
      fnSpec.modifiedByMigrations[fnSpec.modifiedByMigrations.length - 1] ??
      fnSpec.sourceMigration;

    recordMigrationObject(
      latestPermMigration,
      `REVOKE EXECUTE pada ${fnName}`,
      !exposedToPublicOrAnonOrAuth && dbFn.serviceRoleCanExecute
    );

    if (exposedToPublicOrAnonOrAuth || !dbFn.serviceRoleCanExecute) {
      items.push({
        category: "g",
        objectName: `Hak EXECUTE public.${fnName}(${fnSpec.argsSignature})`,
        status: "FAIL",
        detail: `Hak EXECUTE pada public.${fnName} belum dibatasi hanya ke service_role`,
        expected:
          "public=false, anon=false, authenticated=false, service_role=true",
        found: `public=${dbFn.publicCanExecute}, anon=${dbFn.anonCanExecute}, authenticated=${dbFn.authenticatedCanExecute}, service_role=${dbFn.serviceRoleCanExecute}`,
        sourceMigration: latestPermMigration,
        fixComment: `Cabut EXECUTE dari PUBLIC, anon, dan authenticated pada public.${fnName}; beri hanya ke service_role`,
        fixSql: `REVOKE ALL ON FUNCTION public.${fnName}(${fnSpec.argsSignature}) FROM PUBLIC, anon, authenticated;\nREVOKE EXECUTE ON FUNCTION public.${fnName}(${fnSpec.argsSignature}) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.${fnName}(${fnSpec.argsSignature}) TO service_role;`,
      });
    } else {
      items.push({
        category: "g",
        objectName: `Hak EXECUTE public.${fnName}(${fnSpec.argsSignature})`,
        status: "PASS",
        detail:
          "EXECUTE dicabut dari PUBLIC, anon, authenticated dan diberikan ke service_role",
        sourceMigration: latestPermMigration,
      });
    }

    // Periksa apakah fungsi SECURITY DEFINER memiliki search_path tetap
    const expectedHasFixedSearchPath = Boolean(fnSpec.searchPath);
    const dbHasFixedSearchPath =
      snapshot.source === "pg"
        ? Boolean(dbFn.searchPath)
        : expectedHasFixedSearchPath;

    if (fnSpec.securityDefiner && !dbHasFixedSearchPath) {
      items.push({
        category: "g",
        objectName: `search_path Fungsi SECURITY DEFINER public.${fnName}`,
        status: "FAIL",
        detail: `Fungsi SECURITY DEFINER public.${fnName}(${fnSpec.argsSignature}) tidak mengatur SET search_path tetap di migrasi (${fnSpec.sourceMigration}) maupun database`,
        expected: "SET search_path = public",
        found: dbFn.searchPath ?? "search_path tidak diatur (null)",
        sourceMigration: fnSpec.sourceMigration,
        fixComment: `Tetapkan search_path = public pada fungsi SECURITY DEFINER public.${fnName}`,
        fixSql: `ALTER FUNCTION public.${fnName}(${fnSpec.argsSignature}) SET search_path = public;`,
      });
    } else {
      items.push({
        category: "g",
        objectName: `search_path Fungsi public.${fnName}`,
        status: "PASS",
        detail: `SECURITY DEFINER memiliki search_path tetap (${dbFn.searchPath ?? fnSpec.searchPath ?? "public"})`,
        sourceMigration: fnSpec.sourceMigration,
      });
    }
  }

  for (const dbFn of snapshot.functions) {
    if (!manifest.finalState.functions[dbFn.name]) {
      items.push({
        category: "g",
        objectName: `Fungsi ekstra public.${dbFn.name}(${dbFn.argsSignature})`,
        status: "DRIFT",
        detail: `Fungsi public.${dbFn.name} ditemukan di schema public tetapi tidak ada di manifest`,
        expected: "Tidak ada di manifest",
        found: `public.${dbFn.name}(${dbFn.argsSignature})`,
        fixComment: `Periksa fungsi ekstra public.${dbFn.name}`,
        fixSql: `-- DROP FUNCTION IF EXISTS public.${dbFn.name}(${dbFn.argsSignature});`,
      });
    }
  }

  // =========================================================================
  // h. DATA SEED (brand_terms & settings)
  // =========================================================================
  const dbBrandMap = new Map(
    snapshot.seeds.brandTerms.map((b) => [b.term, b.enabled])
  );
  for (const seedSpec of manifest.finalState.seeds.brand_terms) {
    const actualEnabled = dbBrandMap.get(seedSpec.term);
    const matches = actualEnabled === seedSpec.enabled;
    recordMigrationObject(
      seedSpec.sourceMigration,
      `seed brand_terms('${seedSpec.term}')`,
      matches
    );

    if (matches) {
      items.push({
        category: "h",
        objectName: `Seed brand_terms: "${seedSpec.term}"`,
        status: "PASS",
        detail: `enabled = ${actualEnabled}`,
        sourceMigration: seedSpec.sourceMigration,
      });
    } else {
      items.push({
        category: "h",
        objectName: `Seed brand_terms: "${seedSpec.term}"`,
        status: "FAIL",
        detail: `Baris seed brand_terms "${seedSpec.term}" tidak sesuai manifest`,
        expected: `term='${seedSpec.term}', enabled=${seedSpec.enabled}`,
        found:
          actualEnabled === undefined
            ? "Baris tidak ditemukan"
            : `term='${seedSpec.term}', enabled=${actualEnabled}`,
        sourceMigration: seedSpec.sourceMigration,
        fixComment: `Sesuaikan baris seed brand_terms untuk '${seedSpec.term}'`,
        fixSql: `INSERT INTO public.brand_terms (term, enabled) VALUES ('${seedSpec.term}', ${seedSpec.enabled}) ON CONFLICT (term) DO UPDATE SET enabled = EXCLUDED.enabled;`,
      });
    }
  }

  for (const [settingKey, settingSpec] of Object.entries(
    manifest.finalState.seeds.settings
  )) {
    const actualVal = snapshot.seeds.settings[settingKey];
    const latestModMigration =
      settingSpec.modifiedByMigrations[
        settingSpec.modifiedByMigrations.length - 1
      ] ?? settingSpec.sourceMigration;

    if (!actualVal) {
      recordMigrationObject(
        settingSpec.sourceMigration,
        `seed settings('${settingKey}')`,
        false
      );
      recordMigrationObject(
        latestModMigration,
        `settings('${settingKey}').enable_third_party_check=false`,
        false
      );
      items.push({
        category: "h",
        objectName: `Seed settings: "${settingKey}"`,
        status: "FAIL",
        detail: `Baris pengaturan key='${settingKey}' tidak ditemukan di tabel settings`,
        expected: JSON.stringify(settingSpec.value),
        found: "Tidak ditemukan",
        sourceMigration: latestModMigration,
        fixComment: `Masukkan baris pengaturan '${settingKey}' dengan enable_third_party_check = false`,
        fixSql: `INSERT INTO public.settings (key, value) VALUES ('${settingKey}', '${JSON.stringify(
          settingSpec.value
        )}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();`,
      });
    } else {
      recordMigrationObject(
        settingSpec.sourceMigration,
        `seed settings('${settingKey}')`,
        true
      );
      const expectedThirdParty = settingSpec.value.enable_third_party_check;
      const actualThirdParty = actualVal.enable_third_party_check;
      const matchesThirdParty = actualThirdParty === expectedThirdParty;

      for (const modMig of settingSpec.modifiedByMigrations) {
        if (modMig !== settingSpec.sourceMigration) {
          recordMigrationObject(
            modMig,
            `settings('${settingKey}').enable_third_party_check=${String(expectedThirdParty)}`,
            matchesThirdParty
          );
        }
      }

      if (matchesThirdParty) {
        items.push({
          category: "h",
          objectName: `Seed settings: "${settingKey}"`,
          status: "PASS",
          detail: `Pengaturan cocok (enable_third_party_check = ${String(actualThirdParty)})`,
          sourceMigration: latestModMigration,
        });
      } else {
        items.push({
          category: "h",
          objectName: `Seed settings: "${settingKey}" (enable_third_party_check)`,
          status: "FAIL",
          detail: `Nilai enable_third_party_check di database (${String(actualThirdParty)}) tidak sesuai manifest (${String(expectedThirdParty)})`,
          expected: `enable_third_party_check = ${String(expectedThirdParty)}`,
          found: `enable_third_party_check = ${String(actualThirdParty)}`,
          sourceMigration: latestModMigration,
          fixComment: `Ubah enable_third_party_check menjadi false pada public.settings`,
          fixSql: `UPDATE public.settings SET value = jsonb_set(value, '{enable_third_party_check}', 'false'::jsonb, true), updated_at = now() WHERE key = '${settingKey}';`,
        });
      }
    }
  }

  // =========================================================================
  // i. DATA CONTOH (is_demo = true) — HANYA ANGKA (INFO)
  // =========================================================================
  items.push({
    category: "i",
    objectName: "Jumlah baris is_demo = true",
    status: "INFO",
    detail: `check_runs=${snapshot.demoCounts.check_runs}, keywords=${snapshot.demoCounts.keywords}, keyword_groups=${snapshot.demoCounts.keyword_groups}, competitors=${snapshot.demoCounts.competitors}`,
  });

  // =========================================================================
  // j. RIWAYAT MIGRASI (supabase_migrations.schema_migrations) — INFO
  // =========================================================================
  if (snapshot.schemaMigrations === null) {
    items.push({
      category: "j",
      objectName: "supabase_migrations.schema_migrations",
      status: "INFO",
      detail:
        "Tabel supabase_migrations.schema_migrations tidak ditemukan atau migrasi dijalankan manual lewat SQL Editor.",
    });
  } else if (snapshot.schemaMigrations.length === 0) {
    items.push({
      category: "j",
      objectName: "supabase_migrations.schema_migrations",
      status: "INFO",
      detail:
        "Tabel supabase_migrations.schema_migrations ada tetapi berisi 0 baris (migrasi diterapkan lewat SQL Editor).",
    });
  } else {
    items.push({
      category: "j",
      objectName: "supabase_migrations.schema_migrations",
      status: "INFO",
      detail: `Tercatat ${snapshot.schemaMigrations.length} versi: ${snapshot.schemaMigrations
        .map((m) => m.version)
        .join(", ")}`,
    });
  }

  // =========================================================================
  // k. AUTH USERS vs ALLOWED_EMAILS
  // =========================================================================
  if (snapshot.authUsers === null) {
    items.push({
      category: "k",
      objectName: "auth.users vs ALLOWED_EMAILS",
      status: "INFO",
      detail:
        "Daftar auth.users tidak dapat dibaca tanpa koneksi DATABASE_URL atau kunci secret.",
    });
  } else {
    const authSet = new Set(snapshot.authUsers.emailsLower);
    const perEmailStatus = allowedEmails.map((rawEmail) => {
      const masked = maskEmailAddress(rawEmail);
      const exists = authSet.has(rawEmail.toLowerCase());
      return `${masked}: ${exists ? "terdaftar" : "BELUM ADA"}`;
    });
    const allAllowedExist =
      allowedEmails.length > 0 &&
      allowedEmails.every((e) => authSet.has(e.toLowerCase()));

    items.push({
      category: "k",
      objectName: "auth.users vs ALLOWED_EMAILS",
      status: allAllowedExist ? "PASS" : "INFO",
      detail: `Total pengguna di auth.users=${snapshot.authUsers.totalUsers} | ALLOWED_EMAILS (${allowedEmails.length}): ${
        perEmailStatus.join(", ") || "kosong"
      }`,
    });
  }

  // =========================================================================
  // l. EKSTENSI DATABASE
  // =========================================================================
  for (const extSpec of manifest.finalState.extensions) {
    const installed = snapshot.extensions.includes(extSpec.name);
    recordMigrationObject(
      extSpec.sourceMigration,
      `ekstensi ${extSpec.name}`,
      installed
    );
    if (installed) {
      items.push({
        category: "l",
        objectName: `Ekstensi ${extSpec.name}`,
        status: "PASS",
        detail: `Ekstensi ${extSpec.name} terpasang (Daftar ekstensi: ${snapshot.extensions.join(", ")})`,
        sourceMigration: extSpec.sourceMigration,
      });
    } else {
      items.push({
        category: "l",
        objectName: `Ekstensi ${extSpec.name}`,
        status: "FAIL",
        detail: `Ekstensi wajib ${extSpec.name} belum terpasang`,
        expected: `Ekstensi ${extSpec.name} aktif`,
        found: `Terpasang: ${snapshot.extensions.join(", ") || "tidak ada"}`,
        sourceMigration: extSpec.sourceMigration,
        fixComment: `Pasang ekstensi ${extSpec.name}`,
        fixSql: `CREATE EXTENSION IF NOT EXISTS "${extSpec.name}";`,
      });
    }
  }

  // =========================================================================
  // RINGKASAN PER FILE MIGRASI
  // =========================================================================
  const migrationStatuses: MigrationInstallStatus[] =
    manifest.migrationFiles.map((fileName) => {
      const total = totalByMigration.get(fileName) ?? 0;
      const missing = missingByMigration.get(fileName) ?? [];
      const installed = Math.max(0, total - missing.length);
      const status: MigrationInstallStatus["status"] =
        missing.length === 0
          ? "TERPASANG PENUH"
          : installed === 0
            ? "BELUM TERPASANG"
            : "SEBAGIAN";

      return {
        fileName,
        status,
        totalObjects: total,
        installedObjects: installed,
        missingObjects: missing,
      };
    });

  return { items, migrationStatuses };
}

/**
 * Menghasilkan isi file supabase/verify/fix-suggestions.sql dari temuan FAIL dan DRIFT,
 * ditambah saran pengerasan opsional REVOKE hak tabel untuk anon dan authenticated.
 */
export function generateFixSuggestionsSql(
  items: VerifyCheckItem[],
  manifest: MigrationManifest
): string {
  const lines: string[] = [
    "-- =============================================================================",
    "-- SARAN PERBAIKAN SQL (supabase/verify/fix-suggestions.sql)",
    "-- Dihasilkan otomatis oleh npm run verify:db",
    "-- PENTING: Tinjau setiap pernyataan di bawah ini sebelum menjalankannya di Supabase SQL Editor.",
    "-- =============================================================================",
    "",
  ];

  const actionable = items.filter(
    (i) => (i.status === "FAIL" || i.status === "DRIFT") && i.fixSql
  );

  if (actionable.length === 0) {
    lines.push(
      "-- Tidak ditemukan ketidaksesuaian (FAIL = 0, DRIFT = 0). Seluruh objek di database sudah sesuai dengan manifest."
    );
  } else {
    lines.push(
      `-- Ditemukan ${actionable.length} temuan (FAIL / DRIFT) yang memerlukan perhatian:`,
      ""
    );

    for (const item of actionable) {
      lines.push(
        `-- [${item.status}] ${item.objectName}${
          item.sourceMigration ? ` (Sumber migrasi: ${item.sourceMigration})` : ""
        }`
      );
      if (item.expected) lines.push(`--   Diharapkan : ${item.expected}`);
      if (item.found) lines.push(`--   Ditemukan  : ${item.found}`);
      if (item.fixComment) lines.push(`--   Tindakan   : ${item.fixComment}`);
      lines.push(item.fixSql!, "");
    }
  }

  lines.push(
    "-- =============================================================================",
    "-- SARAN OPSIONAL LAPISAN PERTAHANAN TAMBAHAN (Defense-in-Depth)",
    "-- Secara bawaan Supabase memberikan GRANT pada tabel di schema public kepada",
    "-- role anon dan authenticated, lalu mengandalkan RLS untuk memblokir akses.",
    "-- Sebagai lapisan pengamanan tambahan, Anda dapat mencabut hak dari anon",
    "-- serta mencabut hak tulis (INSERT, UPDATE, DELETE, TRUNCATE) dari authenticated:",
    "-- =============================================================================",
    ""
  );

  const tableNames = Object.keys(manifest.finalState.tables).join(", ");
  lines.push(
    `-- Cabut seluruh hak tabel dari role anon (karena aplikasi mewajibkan login):`,
    `-- REVOKE ALL ON TABLE ${tableNames} FROM anon;`,
    "",
    `-- Cabut hak tulis tabel dari role authenticated (penulisan hanya via service_role di server):`,
    `-- REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ${tableNames} FROM authenticated;`,
    ""
  );

  return lines.join("\n");
}
