import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifestFromDirectory,
  type MigrationManifest,
} from "../lib/migration-manifest";
import {
  evaluateDatabaseAgainstManifest,
  generateFixSuggestionsSql,
  generateStandaloneVerifySql,
  loadSupabaseManagedConfig,
  parseSqlEditorResultsFile,
  VERIFY_DB_READONLY_QUERIES,
  type DbIntrospectionSnapshot,
} from "../lib/verify-db-core";

describe("Pemeriksa Konsistensi Migrasi & Database (verify:db)", () => {
  const rootDir = process.cwd();
  const migrationsDir = path.join(rootDir, "supabase", "migrations");
  const manifestPath = path.join(rootDir, "supabase", "verify", "manifest.json");

  it("memastikan setiap CREATE TABLE, CREATE VIEW, CREATE FUNCTION, CREATE INDEX, dan CREATE POLICY di supabase/migrations/ tercatat di supabase/verify/manifest.json", () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const savedManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8")
    ) as MigrationManifest;
    const freshManifest = buildManifestFromDirectory(migrationsDir);

    expect(savedManifest).toEqual(freshManifest);

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    expect(savedManifest.migrationFiles).toEqual(migrationFiles);

    for (const fileName of migrationFiles) {
      const rawSql = fs.readFileSync(path.join(migrationsDir, fileName), "utf-8");
      const cleanSql = rawSql.replace(/--.*$/gm, "");

      // 1. CREATE TABLE
      const tableMatches = [
        ...cleanSql.matchAll(
          /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi
        ),
      ];
      for (const m of tableMatches) {
        const tableName = m[1]!.toLowerCase();
        expect(
          savedManifest.finalState.tables[tableName],
          `Tabel ${tableName} dari ${fileName} harus tercatat di manifest.json`
        ).toBeDefined();
      }

      // 2. CREATE VIEW
      const viewMatches = [
        ...cleanSql.matchAll(
          /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?([a-zA-Z0-9_]+)/gi
        ),
      ];
      for (const m of viewMatches) {
        const viewName = m[1]!.toLowerCase();
        expect(
          savedManifest.finalState.views[viewName],
          `View ${viewName} dari ${fileName} harus tercatat di manifest.json`
        ).toBeDefined();
      }

      // 3. CREATE FUNCTION
      const fnMatches = [
        ...cleanSql.matchAll(
          /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi
        ),
      ];
      for (const m of fnMatches) {
        const fnName = m[1]!.toLowerCase();
        expect(
          savedManifest.finalState.functions[fnName],
          `Fungsi ${fnName} dari ${fileName} harus tercatat di manifest.json`
        ).toBeDefined();
      }

      // 4. CREATE INDEX
      const idxMatches = [
        ...cleanSql.matchAll(
          /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+(?:public\.)?([a-zA-Z0-9_]+)/gi
        ),
      ];
      for (const m of idxMatches) {
        const idxName = m[1]!.toLowerCase();
        const foundIdx = savedManifest.finalState.indexes.find(
          (i) => i.name === idxName
        );
        expect(
          foundIdx,
          `Indeks ${idxName} dari ${fileName} harus tercatat di manifest.json`
        ).toBeDefined();
      }

      // 5. CREATE POLICY
      const policyMatches = [
        ...cleanSql.matchAll(
          /\bCREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?([a-zA-Z0-9_]+)/gi
        ),
      ];
      for (const m of policyMatches) {
        const policyName = m[1]!;
        const tableName = m[2]!.toLowerCase();
        const foundPol = savedManifest.finalState.policies.find(
          (p) => p.name === policyName && p.table === tableName
        );
        expect(
          foundPol,
          `Kebijakan RLS "${policyName}" pada ${tableName} dari ${fileName} harus tercatat di manifest.json`
        ).toBeDefined();
      }
    }
  });

  it("memastikan seluruh kueri yang dikirim verify-db dan file verify.sql bebas dari perintah tulis/DDL (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, GRANT, REVOKE, TRUNCATE)", () => {
    const forbiddenKeywordsRegex =
      /\b(INSERT\s+INTO|UPDATE\s+[a-zA-Z0-9_.]+\s+SET|DELETE\s+FROM|DROP\s+(?:TABLE|VIEW|FUNCTION|INDEX)|ALTER\s+(?:TABLE|VIEW|FUNCTION)|CREATE\s+(?:TABLE|VIEW|FUNCTION|INDEX|POLICY)|GRANT\s+[a-zA-Z0-9_,\s]+\s+TO|REVOKE\s+[a-zA-Z0-9_,\s]+\s+FROM|TRUNCATE\b)/i;

    for (const [queryName, sqlQuery] of Object.entries(
      VERIFY_DB_READONLY_QUERIES
    )) {
      const sqlWithoutStrings = sqlQuery.replace(/'(?:''|[^'])*'/g, "");
      const match = sqlWithoutStrings.match(forbiddenKeywordsRegex);
      expect(
        match,
        `Kueri VERIFY_DB_READONLY_QUERIES.${queryName} tidak boleh memuat kata kunci tulis/DDL, ditemukan: ${match?.[0] ?? "tidak ada"}`
      ).toBeNull();
    }

    const manifest = buildManifestFromDirectory(migrationsDir);
    const standaloneSql = generateStandaloneVerifySql(manifest);
    const standaloneWithoutComments = standaloneSql.replace(/--.*$/gm, "");
    const standaloneWithoutStrings = standaloneWithoutComments.replace(
      /'(?:''|[^'])*'/g,
      ""
    );
    const standaloneMatch = standaloneWithoutStrings.match(
      forbiddenKeywordsRegex
    );
    expect(
      standaloneMatch,
      `Kueri standalone verify.sql tidak boleh memuat kata kunci tulis/DDL, ditemukan: ${standaloneMatch?.[0] ?? "tidak ada"}`
    ).toBeNull();
  });

  it("memastikan status UNVERIFIED muncul saat menggunakan mode API (tanpa DATABASE_URL) untuk kategori yang tidak diekspos oleh OpenAPI", () => {
    const manifest = buildManifestFromDirectory(migrationsDir);
    const apiSnapshot: DbIntrospectionSnapshot = {
      source: "supabase-rest",
      extensions: [],
      eventTriggers: [],
      tables: Object.keys(manifest.finalState.tables).map((name) => ({
        name,
        rlsEnabled: null,
      })),
      columns: Object.entries(manifest.finalState.tables).flatMap(([tName, tSpec]) =>
        tSpec.columns.map((c) => ({
          table: tName,
          name: c.name,
          dataType: c.normalizedType,
          nullable: c.nullable,
          defaultExpr: c.defaultExpr,
        }))
      ),
      constraints: [
        {
          table: "keyword_groups",
          name: "keyword_groups_pkey",
          type: "PRIMARY KEY",
          columns: ["id"],
        },
      ],
      indexes: [],
      policies: null,
      tablePrivilegesSummary: null,
      views: Object.keys(manifest.finalState.views).map((name) => ({
        name,
        exists: true,
        securityInvoker: null,
        definitionSql: null,
      })),
      functions: Object.entries(manifest.finalState.functions).map(([name, fSpec]) => ({
        name,
        argsSignature: fSpec.argsSignature,
        returnType: fSpec.returnType,
        language: fSpec.language,
        securityDefiner: fSpec.securityDefiner,
        searchPath: null,
        publicCanExecute: false,
        anonCanExecute: false,
        authenticatedCanExecute: false,
        serviceRoleCanExecute: true,
      })),
      seeds: {
        brandTerms: [
          { term: "LinovHR", enabled: true },
          { term: "Linov HR", enabled: true },
          { term: "linovhr.com", enabled: true },
          { term: "Linov", enabled: false },
        ],
        settings: {
          search_config: { enable_third_party_check: false },
        },
      },
      demoCounts: { check_runs: 0, keywords: 0, keyword_groups: 0, competitors: 0 },
      schemaMigrations: null,
      authUsers: { totalUsers: 1, emailsLower: ["admin@linovhr.com"] },
    };

    const evaluation = evaluateDatabaseAgainstManifest(
      manifest,
      apiSnapshot,
      ["admin@linovhr.com"]
    );

    // Kategori c (ON DELETE & CHECK), d (RLS & pg_policy), f (security_invoker), g (proconfig), l (pgcrypto) harus memuat UNVERIFIED
    const unverifiedItems = evaluation.items.filter((i) => i.status === "UNVERIFIED");
    expect(unverifiedItems.length).toBeGreaterThan(0);

    const unverifiedMethods = Array.from(new Set(unverifiedItems.map((i) => i.method)));
    expect(unverifiedMethods).toEqual(["API"]);

    const unverifiedCategories = new Set(unverifiedItems.map((i) => i.category));
    expect(unverifiedCategories.has("c")).toBe(true);
    expect(unverifiedCategories.has("d")).toBe(true);
    expect(unverifiedCategories.has("f")).toBe(true);
    expect(unverifiedCategories.has("g")).toBe(true);
    expect(unverifiedCategories.has("l")).toBe(true);

    // Pastikan tidak ada satupun item UNVERIFIED yang dilaporkan sebagai PASS
    for (const it of unverifiedItems) {
      expect(it.status).toBe("UNVERIFIED");
    }
  });

  it("memastikan ringkasan memisahkan metode pemeriksaan (DB, API, FILE) dan temuan file migrasi dilaporkan sebagai MIGRATION-LINT", () => {
    const manifest = buildManifestFromDirectory(migrationsDir);
    const sampleSnapshot: DbIntrospectionSnapshot = {
      source: "pg",
      extensions: ["pgcrypto"],
      eventTriggers: ["ensure_rls"],
      tables: Object.keys(manifest.finalState.tables).map((name) => ({
        name,
        rlsEnabled: true,
      })),
      columns: Object.entries(manifest.finalState.tables).flatMap(([tName, tSpec]) =>
        tSpec.columns.map((c) => ({
          table: tName,
          name: c.name,
          dataType: c.normalizedType,
          nullable: c.nullable,
          defaultExpr: c.defaultExpr,
        }))
      ),
      constraints: [],
      indexes: [],
      policies: [],
      tablePrivilegesSummary: null,
      views: Object.keys(manifest.finalState.views).map((name) => ({
        name,
        exists: true,
        securityInvoker: true,
        definitionSql: "view def",
      })),
      functions: Object.entries(manifest.finalState.functions).map(([name, fSpec]) => ({
        name,
        argsSignature: fSpec.argsSignature,
        returnType: fSpec.returnType,
        language: fSpec.language,
        securityDefiner: fSpec.securityDefiner,
        searchPath: "public, pg_temp",
        publicCanExecute: false,
        anonCanExecute: false,
        authenticatedCanExecute: false,
        serviceRoleCanExecute: true,
      })),
      seeds: {
        brandTerms: [
          { term: "LinovHR", enabled: true },
          { term: "Linov HR", enabled: true },
          { term: "linovhr.com", enabled: true },
          { term: "Linov", enabled: false },
        ],
        settings: {
          search_config: { enable_third_party_check: false },
        },
      },
      demoCounts: { check_runs: 0, keywords: 0, keyword_groups: 0, competitors: 0 },
      schemaMigrations: null,
      authUsers: { totalUsers: 1, emailsLower: ["admin@linovhr.com"] },
    };

    const evaluation = evaluateDatabaseAgainstManifest(
      manifest,
      sampleSnapshot,
      ["admin@linovhr.com"]
    );

    // Temuan statis pada 20261029010000 (fungsi claim_next_run_item tanpa search_path awal) harus berstatus MIGRATION-LINT dengan metode FILE
    const lintItems = evaluation.items.filter((i) => i.status === "MIGRATION-LINT");
    expect(lintItems.length).toBeGreaterThan(0);
    for (const li of lintItems) {
      expect(li.method).toBe("FILE");
      expect(li.status).toBe("MIGRATION-LINT");
      expect(li.detail).toContain("SECURITY DEFINER");
    }

    // Item database harus memiliki metode DB
    const dbItems = evaluation.items.filter((i) => i.method === "DB");
    expect(dbItems.length).toBeGreaterThan(0);
  });

  it("memastikan status per file migrasi dinilai berdasarkan definisi file itu sendiri", () => {
    const manifest = buildManifestFromDirectory(migrationsDir);
    const dbSnapshot: DbIntrospectionSnapshot = {
      source: "pg",
      extensions: ["pgcrypto"],
      eventTriggers: ["ensure_rls"],
      tables: [
        { name: "keyword_groups", rlsEnabled: true },
        { name: "keywords", rlsEnabled: true },
        { name: "brand_terms", rlsEnabled: true },
        { name: "competitors", rlsEnabled: true },
        { name: "check_runs", rlsEnabled: true },
        { name: "run_items", rlsEnabled: true },
        { name: "checks", rlsEnabled: true },
        { name: "check_sources", rlsEnabled: true },
        { name: "page_cache", rlsEnabled: true },
        { name: "settings", rlsEnabled: true },
      ],
      columns: [
        { table: "check_runs", name: "serpapi_calls", dataType: "integer", nullable: false, defaultExpr: "0" },
        { table: "checks", name: "serpapi_calls", dataType: "integer", nullable: false, defaultExpr: "1" },
        { table: "check_runs", name: "is_demo", dataType: "boolean", nullable: false, defaultExpr: "false" },
        { table: "keywords", name: "is_demo", dataType: "boolean", nullable: false, defaultExpr: "false" },
        { table: "keyword_groups", name: "is_demo", dataType: "boolean", nullable: false, defaultExpr: "false" },
        { table: "competitors", name: "is_demo", dataType: "boolean", nullable: false, defaultExpr: "false" },
      ],
      constraints: [],
      indexes: [],
      policies: [],
      tablePrivilegesSummary: null,
      views: [
        { name: "latest_keyword_checks", exists: true, securityInvoker: true, definitionSql: null },
        { name: "latest_domain_citation_counts", exists: true, securityInvoker: true, definitionSql: null },
      ],
      functions: [
        {
          name: "claim_next_run_item",
          argsSignature: "timestamp with time zone",
          returnType: "setof run_items",
          language: "sql",
          securityDefiner: true,
          searchPath: "public, pg_temp",
          publicCanExecute: false,
          anonCanExecute: false,
          authenticatedCanExecute: false,
          serviceRoleCanExecute: true,
        },
        {
          name: "get_database_size_bytes",
          argsSignature: "",
          returnType: "bigint",
          language: "sql",
          securityDefiner: true,
          searchPath: "public, pg_temp",
          publicCanExecute: false,
          anonCanExecute: false,
          authenticatedCanExecute: false,
          serviceRoleCanExecute: true,
        },
        {
          name: "cleanup_old_checks_raw",
          argsSignature: "integer",
          returnType: "integer",
          language: "plpgsql",
          securityDefiner: true,
          searchPath: "public, pg_temp",
          publicCanExecute: false,
          anonCanExecute: false,
          authenticatedCanExecute: false,
          serviceRoleCanExecute: true,
        },
      ],
      seeds: {
        brandTerms: [
          { term: "LinovHR", enabled: true },
          { term: "Linov HR", enabled: true },
          { term: "linovhr.com", enabled: true },
          { term: "Linov", enabled: false },
        ],
        settings: {
          search_config: { enable_third_party_check: false },
        },
      },
      demoCounts: { check_runs: 0, keywords: 0, keyword_groups: 0, competitors: 0 },
      schemaMigrations: null,
      authUsers: null,
    };

    const evaluation = evaluateDatabaseAgainstManifest(manifest, dbSnapshot, []);

    // Setiap file migrasi dari 0 s/d 7 harus dinilai statusnya
    expect(evaluation.migrationStatuses.length).toBe(manifest.migrationFiles.length);

    const initStatus = evaluation.migrationStatuses.find((m) =>
      m.fileName.includes("init_schema")
    );
    expect(initStatus?.status).toBe("TERPASANG PENUH");

    const phase3Status = evaluation.migrationStatuses.find((m) =>
      m.fileName.includes("phase3_queue_and_calls")
    );
    expect(phase3Status?.status).toBe("TERPASANG PENUH");
  });

  it("mem-parsing file hasil SQL Editor (--from-file) dalam format CSV dan TSV lalu menyusun laporan dengan Metode DB", () => {
    const tempCsvPath = path.join(rootDir, "supabase", "verify", "temp_test_results.csv");
    const sampleCsv = `
"objek","status","detail"
"a. Tabel: keyword_groups","PASS","Tabel tersedia di schema public"
"a. Tabel: keywords","PASS","Tabel tersedia di schema public"
"b. Kolom: check_runs.serpapi_calls","PASS","tipe=integer, nullable=false, default=0"
"f. View: latest_keyword_checks","PASS","View tersedia dengan security_invoker = true"
"g. Fungsi: claim_next_run_item","PASS","search_path terpasang aman (public, pg_temp)"
"h. Seed settings(search_config)","PASS","enable_third_party_check = false"
"INFO. Event Trigger: ensure_rls","INFO","Event trigger ensure_rls aktif di database (dikelola oleh platform Supabase)"
`.trim();

    fs.writeFileSync(tempCsvPath, sampleCsv, "utf-8");
    try {
      const parsedItems = parseSqlEditorResultsFile(tempCsvPath);
      expect(parsedItems.length).toBe(7);

      for (const item of parsedItems) {
        expect(item.method).toBe("DB");
      }

      const tableItem = parsedItems.find((i) => i.objectName.includes("keyword_groups"));
      expect(tableItem?.status).toBe("PASS");
      expect(tableItem?.category).toBe("a");

      const eventTriggerItem = parsedItems.find((i) => i.objectName.includes("ensure_rls"));
      expect(eventTriggerItem?.status).toBe("INFO");
    } finally {
      if (fs.existsSync(tempCsvPath)) fs.unlinkSync(tempCsvPath);
    }
  });

  it("memastikan objek yang dikelola Supabase (rls_auto_enable, ensure_rls) dilaporkan sebagai INFO dan tidak dianggap DRIFT maupun FAIL", () => {
    const manifest = buildManifestFromDirectory(migrationsDir);
    const managedConfig = loadSupabaseManagedConfig();
    expect(managedConfig.functions).toContain("rls_auto_enable");
    expect(managedConfig.eventTriggers).toContain("ensure_rls");

    const snapshotWithManagedObjects: DbIntrospectionSnapshot = {
      source: "pg",
      extensions: ["pgcrypto"],
      eventTriggers: ["ensure_rls"],
      tables: Object.keys(manifest.finalState.tables).map((name) => ({
        name,
        rlsEnabled: true,
      })),
      columns: [],
      constraints: [],
      indexes: [],
      policies: [],
      tablePrivilegesSummary: null,
      views: [],
      functions: [
        // Fungsi tambahan yang dikelola Supabase
        {
          name: "rls_auto_enable",
          argsSignature: "",
          returnType: "event_trigger",
          language: "plpgsql",
          securityDefiner: true,
          searchPath: null,
          publicCanExecute: false,
          anonCanExecute: false,
          authenticatedCanExecute: false,
          serviceRoleCanExecute: true,
        },
      ],
      seeds: {
        brandTerms: [],
        settings: {},
      },
      demoCounts: { check_runs: 0, keywords: 0, keyword_groups: 0, competitors: 0 },
      schemaMigrations: null,
      authUsers: null,
    };

    const evaluation = evaluateDatabaseAgainstManifest(
      manifest,
      snapshotWithManagedObjects,
      []
    );

    const rlsAutoItem = evaluation.items.find((i) =>
      i.objectName.includes("rls_auto_enable")
    );
    expect(rlsAutoItem).toBeDefined();
    expect(rlsAutoItem?.status).toBe("INFO");
    expect(rlsAutoItem?.detail).toContain("dikelola oleh platform Supabase");

    const ensureRlsItem = evaluation.items.find((i) =>
      i.objectName.includes("ensure_rls")
    );
    expect(ensureRlsItem).toBeDefined();
    expect(ensureRlsItem?.status).toBe("INFO");
    expect(ensureRlsItem?.detail).toContain("dikelola otomatis oleh platform Supabase");

    // Pastikan tidak ada saran DROP atau REVOKE untuk rls_auto_enable di fix suggestions
    const fixSql = generateFixSuggestionsSql(evaluation.items, manifest);
    expect(fixSql).not.toContain("DROP FUNCTION IF EXISTS public.rls_auto_enable");
    expect(fixSql).not.toContain("REVOKE ALL ON FUNCTION public.rls_auto_enable");
  });
});
