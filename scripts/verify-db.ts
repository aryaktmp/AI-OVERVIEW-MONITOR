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
  parseSqlEditorResultsFile,
  VERIFY_DB_READONLY_QUERIES,
  type CategoryCode,
  type DbIntrospectionSnapshot,
  type VerifyCheckItem,
  type VerifyStatus,
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
      evtRes,
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
      client.query(VERIFY_DB_READONLY_QUERIES.eventTriggers),
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
      const btRes = await client.query(VERIFY_DB_READONLY_QUERIES.seedBrandTerms);
      brandTerms = btRes.rows.map((r: { term: string; enabled: boolean }) => ({
        term: r.term,
        enabled: Boolean(r.enabled),
      }));
    }

    const settings: Record<string, Record<string, unknown>> = {};
    if (tableNamesSet.has("settings")) {
      const stRes = await client.query(VERIFY_DB_READONLY_QUERIES.seedSettings);
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
        demoCounts.check_runs = Number(r.check_runs ?? 0);
        demoCounts.keywords = Number(r.keywords ?? 0);
        demoCounts.keyword_groups = Number(r.keyword_groups ?? 0);
        demoCounts.competitors = Number(r.competitors ?? 0);
      }
    } catch {
      // Abaikan jika kolom is_demo belum ada di salah satu tabel
    }

    let schemaMigrations: Array<{ version: string; name?: string | null }> | null =
      null;
    try {
      const smRows = await client.query(VERIFY_DB_READONLY_QUERIES.schemaMigrations);
      schemaMigrations = smRows.rows as Array<{ version: string; name?: string | null }>;
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
      eventTriggers: evtRes.rows.map((r: { evtname: string }) => r.evtname),
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
          default_expr: string | null;
        }) => ({
          table: r.table_name,
          name: r.column_name,
          dataType: r.data_type,
          nullable: Boolean(r.is_nullable),
          defaultExpr: r.default_expr,
        })
      ),
      constraints: conRes.rows.map(
        (r: {
          table_name: string;
          constraint_name: string;
          constraint_type: string;
          columns: string[];
          references_table: string | null;
          references_columns: string[] | null;
          on_delete_action: string | null;
          check_expression: string | null;
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
            type: typeMap[r.constraint_type] ?? "CHECK",
            columns: r.columns ?? [],
            referencesTable: r.references_table ?? undefined,
            referencesColumn: r.references_columns?.[0] ?? undefined,
            onDelete:
              r.constraint_type === "f"
                ? decodeFkOnDeleteCode(r.on_delete_action)
                : undefined,
            checkExpression: r.check_expression ?? undefined,
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
          command_type: string;
          roles: string[];
          using_expr: string;
          with_check_expr: string | null;
        }) => ({
          name: r.policy_name,
          table: r.table_name,
          command: decodePolicyCmdCode(r.command_type),
          roles: r.roles ?? [],
          usingExpr: r.using_expr ?? "true",
          withCheckExpr: r.with_check_expr,
        })
      ),
      tablePrivilegesSummary: privRes.rows.map(
        (r: {
          table_name: string;
          anon_select: boolean;
          anon_insert: boolean;
          anon_update: boolean;
          anon_delete: boolean;
          auth_select: boolean;
          auth_insert: boolean;
          auth_update: boolean;
          auth_delete: boolean;
        }) => {
          const anonPrivs: string[] = [];
          if (r.anon_select) anonPrivs.push("SELECT");
          if (r.anon_insert) anonPrivs.push("INSERT");
          if (r.anon_update) anonPrivs.push("UPDATE");
          if (r.anon_delete) anonPrivs.push("DELETE");

          const authPrivs: string[] = [];
          if (r.auth_select) authPrivs.push("SELECT");
          if (r.auth_insert) authPrivs.push("INSERT");
          if (r.auth_update) authPrivs.push("UPDATE");
          if (r.auth_delete) authPrivs.push("DELETE");

          return {
            table: r.table_name,
            anonPrivileges: anonPrivs,
            authenticatedPrivileges: authPrivs,
          };
        }
      ),
      views: viewRes.rows.map(
        (r: {
          view_name: string;
          security_invoker: boolean;
          definition_sql: string;
        }) => ({
          name: r.view_name,
          exists: true,
          securityInvoker: Boolean(r.security_invoker),
          definitionSql: r.definition_sql,
        })
      ),
      functions: fnRes.rows.map(
        (r: {
          name: string;
          args_signature: string;
          return_type: string;
          language: string;
          is_security_definer: boolean;
          search_path_config: string | null;
          public_can_execute: boolean;
          anon_can_execute: boolean;
          auth_can_execute: boolean;
          service_role_can_execute: boolean;
        }) => ({
          name: r.name,
          argsSignature: r.args_signature,
          returnType: r.return_type,
          language: r.language,
          securityDefiner: Boolean(r.is_security_definer),
          searchPath: r.search_path_config
            ? r.search_path_config.replace(/^search_path=/, "")
            : null,
          publicCanExecute: Boolean(r.public_can_execute),
          anonCanExecute: Boolean(r.anon_can_execute),
          authenticatedCanExecute: Boolean(r.auth_can_execute),
          serviceRoleCanExecute: Boolean(r.service_role_can_execute),
        })
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
    try {
      await client.query(VERIFY_DB_READONLY_QUERIES.rollback);
    } catch {
      // Abaikan jika rollback gagal
    }
    await client.end();
  }
}

async function introspectViaSupabaseRest(
  supabaseUrl: string,
  publishableKey: string,
  secretKey: string,
  manifest: MigrationManifest
): Promise<DbIntrospectionSnapshot> {
  const pubClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const secClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [secSpecRes, anonSpecRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/?apikey=${secretKey}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    }),
    fetch(`${supabaseUrl}/rest/v1/?apikey=${publishableKey}`, {
      headers: { Authorization: `Bearer ${publishableKey}` },
    }),
  ]);

  const secSpec = secSpecRes.ok
    ? ((await secSpecRes.json()) as Record<string, unknown>)
    : {};
  const anonSpec = anonSpecRes.ok
    ? ((await anonSpecRes.json()) as Record<string, unknown>)
    : {};

  const definitions = (secSpec.definitions ?? {}) as Record<
    string,
    {
      type?: string;
      properties?: Record<
        string,
        {
          type?: string;
          format?: string;
          description?: string;
          default?: unknown;
        }
      >;
      required?: string[];
    }
  >;

  const secPaths = (secSpec.paths ?? {}) as Record<string, unknown>;
  const anonPaths = (anonSpec.paths ?? {}) as Record<string, unknown>;

  const tables: DbIntrospectionSnapshot["tables"] = [];
  const columns: DbIntrospectionSnapshot["columns"] = [];
  const constraints: DbIntrospectionSnapshot["constraints"] = [];
  const expectedViewsSet = new Set(Object.keys(manifest.finalState.views));
  const views: DbIntrospectionSnapshot["views"] = [];

  for (const [defName, defObj] of Object.entries(definitions)) {
    const props = defObj.properties ?? {};
    const requiredSet = new Set(defObj.required ?? []);

    if (expectedViewsSet.has(defName)) {
      views.push({
        name: defName,
        exists: true,
        securityInvoker: null, // Memerlukan DB method
        definitionSql: null,
      });
      continue;
    }

    tables.push({
      name: defName,
      rlsEnabled: null, // Memerlukan DB method
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

  const functions: DbIntrospectionSnapshot["functions"] = [];
  for (const [fnName, fnSpec] of Object.entries(manifest.finalState.functions)) {
    const rpcPath = `/rpc/${fnName}`;
    const inSecSpec = rpcPath in secPaths;
    let anonCanExec = rpcPath in anonPaths;

    if (fnName === "get_database_size_bytes" && inSecSpec) {
      const { error: anonRpcError } = await pubClient.rpc("get_database_size_bytes");
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
        searchPath: null, // Memerlukan DB method
        publicCanExecute: anonCanExec,
        anonCanExecute: anonCanExec,
        authenticatedCanExecute: false,
        serviceRoleCanExecute: true,
      });
    }
  }

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
      const { count } = await secClient
        .from(tbl)
        .select("*", { count: "exact", head: true })
        .eq("is_demo", true);
      demoCounts[tbl] = count ?? 0;
    }
  }

  let authUsers: { totalUsers: number; emailsLower: string[] } | null = null;
  const { data: authData } = await secClient.auth.admin.listUsers();
  if (authData?.users) {
    authUsers = {
      totalUsers: authData.users.length,
      emailsLower: authData.users
        .map((u) => (u.email ?? "").trim().toLowerCase())
        .filter(Boolean),
    };
  }

  return {
    source: "supabase-rest",
    extensions: [],
    eventTriggers: [],
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

function buildSnapshotFromSqlEditorItems(
  items: VerifyCheckItem[],
  manifest: MigrationManifest
): DbIntrospectionSnapshot {
  const extensions: string[] = [];
  const eventTriggers: string[] = [];
  const tables: DbIntrospectionSnapshot["tables"] = [];
  const columns: DbIntrospectionSnapshot["columns"] = [];
  const constraints: DbIntrospectionSnapshot["constraints"] = [];
  const indexes: DbIntrospectionSnapshot["indexes"] = [];
  const policies: NonNullable<DbIntrospectionSnapshot["policies"]> = [];
  const views: DbIntrospectionSnapshot["views"] = [];
  const functions: DbIntrospectionSnapshot["functions"] = [];
  const brandTerms: Array<{ term: string; enabled: boolean }> = [];
  const settings: Record<string, Record<string, unknown>> = {};
  const demoCounts = { check_runs: 0, keywords: 0, keyword_groups: 0, competitors: 0 };

  for (const it of items) {
    if (it.objectName.startsWith("a. Tabel: ") && it.status === "PASS") {
      const tbl = it.objectName.replace("a. Tabel: ", "").trim();
      tables.push({ name: tbl, rlsEnabled: true });
    } else if (it.objectName.startsWith("b. Kolom: ")) {
      const colFull = it.objectName.replace("b. Kolom: ", "").trim();
      const [tbl, col] = colFull.split(".");
      if (tbl && col && it.status === "PASS") {
        const dtMatch = it.detail.match(/tipe=([^,]+)/);
        const nlMatch = it.detail.match(/nullable=([^,]+)/);
        const dfMatch = it.detail.match(/default=(.+)$/);
        columns.push({
          table: tbl,
          name: col,
          dataType: dtMatch?.[1]?.trim() ?? "text",
          nullable: nlMatch?.[1]?.trim() === "true",
          defaultExpr: dfMatch?.[1]?.trim() === "null" ? null : dfMatch?.[1]?.trim() ?? null,
        });
      }
    } else if (it.objectName.startsWith("c. Constraint: ") && it.status === "PASS") {
      const conName = it.objectName.replace("c. Constraint: ", "").trim();
      for (const [tName, tSpec] of Object.entries(manifest.finalState.tables)) {
        for (const con of tSpec.constraints) {
          constraints.push({
            table: tName,
            name: conName,
            type: con.type,
            columns: con.columns,
            referencesTable: con.referencesTable,
            referencesColumn: con.referencesColumn,
            onDelete: con.onDelete,
            checkExpression: con.checkExpression,
          });
        }
      }
    } else if (it.objectName.startsWith("c. Indeks: ") && it.status === "PASS") {
      const idxName = it.objectName.replace("c. Indeks: ", "").trim();
      const manifestIdx = manifest.finalState.indexes.find((i) => i.name === idxName);
      indexes.push({
        name: idxName,
        table: manifestIdx?.table ?? "",
        unique: manifestIdx?.unique ?? false,
        indexDef: it.detail,
      });
    } else if (it.objectName.startsWith("d. Kebijakan: ") && it.status === "PASS") {
      const polName = it.objectName.replace("d. Kebijakan: ", "").trim();
      const manifestPol = manifest.finalState.policies.find((p) => p.name === polName);
      policies.push({
        name: polName,
        table: manifestPol?.table ?? "",
        command: manifestPol?.command ?? "SELECT",
        roles: manifestPol?.roles ?? ["authenticated"],
        usingExpr: manifestPol?.usingExpr ?? "true",
        withCheckExpr: manifestPol?.withCheckExpr ?? null,
      });
    } else if (it.objectName.startsWith("f. View: ")) {
      const viewName = it.objectName.replace("f. View: ", "").trim();
      views.push({
        name: viewName,
        exists: it.status === "PASS",
        securityInvoker: it.status === "PASS",
        definitionSql: manifest.finalState.views[viewName]?.definitionSql ?? null,
      });
    } else if (it.objectName.startsWith("g. Fungsi: ")) {
      const fnName = it.objectName.replace("g. Fungsi: ", "").trim();
      const manifestFn = manifest.finalState.functions[fnName];
      const hasSearchPath = it.detail.includes("search_path=") || it.detail.includes("config=[public");
      const pubExec = it.detail.includes("pub_exec=true");
      const anonExec = it.detail.includes("anon_exec=true");
      const authExec = it.detail.includes("auth_exec=true");
      const svcExec = it.detail.includes("service_role_exec=true") || it.detail.includes("svc_exec=true");
      functions.push({
        name: fnName,
        argsSignature: manifestFn?.argsSignature ?? "",
        returnType: manifestFn?.returnType ?? null,
        language: manifestFn?.language ?? "sql",
        securityDefiner: manifestFn?.securityDefiner ?? true,
        searchPath: hasSearchPath ? "public, pg_temp" : null,
        publicCanExecute: pubExec,
        anonCanExecute: anonExec,
        authenticatedCanExecute: authExec,
        serviceRoleCanExecute: svcExec,
      });
    } else if (it.objectName === "h. Seed brand_terms" && it.status === "PASS") {
      brandTerms.push(
        { term: "LinovHR", enabled: true },
        { term: "Linov HR", enabled: true },
        { term: "linovhr.com", enabled: true },
        { term: "Linov", enabled: false }
      );
    } else if (it.objectName === "h. Seed settings(search_config)") {
      settings["search_config"] = {
        enable_third_party_check: it.status === "PASS" ? false : true,
      };
    } else if (it.objectName === "l. Ekstensi: pgcrypto" && it.status === "PASS") {
      extensions.push("pgcrypto");
    } else if (it.objectName.includes("Event Trigger: ensure_rls") && it.detail.includes("aktif")) {
      eventTriggers.push("ensure_rls");
    }
  }

  return {
    source: "pg",
    extensions,
    eventTriggers,
    tables,
    columns,
    constraints,
    indexes,
    policies,
    tablePrivilegesSummary: null,
    views,
    functions,
    seeds: {
      brandTerms,
      settings,
    },
    demoCounts,
    schemaMigrations: null,
    authUsers: null,
  };
}

async function main() {
  const rootDir = process.cwd();
  const envLocalPath = path.join(rootDir, ".env.local");
  const localEnv = parseEnvFile(envLocalPath);

  const fromFileIdx = process.argv.indexOf("--from-file");
  const fromFilePath =
    fromFileIdx !== -1 && process.argv[fromFileIdx + 1]
      ? process.argv[fromFileIdx + 1]
      : null;

  const manifest = loadMigrationsAndBuildManifest();
  const verifyDir = path.join(rootDir, "supabase", "verify");
  if (!fs.existsSync(verifyDir)) {
    fs.mkdirSync(verifyDir, { recursive: true });
  }

  const manifestPath = path.join(verifyDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  const standaloneSql = generateStandaloneVerifySql(manifest);
  const verifySqlPath = path.join(verifyDir, "verify.sql");
  fs.writeFileSync(verifySqlPath, standaloneSql, "utf-8");

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
    localEnv["SUPABASE_ANON_KEY"] ??
    ""
  ).trim();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ??
    localEnv["SUPABASE_SECRET_KEY"] ??
    localEnv["SUPABASE_SERVICE_ROLE_KEY"] ??
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
  let activeMode: "DB_DIRECT" | "DB_FILE" | "API" = "API";

  if (fromFilePath) {
    console.log(`Mode Pemeriksaan     : DB (--from-file ${fromFilePath})`);
    activeMode = "DB_FILE";
    const parsedFileItems = parseSqlEditorResultsFile(fromFilePath);
    snapshot = buildSnapshotFromSqlEditorItems(parsedFileItems, manifest);
  } else if (databaseUrl) {
    console.log("Mode Pemeriksaan     : DB (PostgreSQL langsung via DATABASE_URL, BEGIN READ ONLY)");
    activeMode = "DB_DIRECT";
    snapshot = await introspectViaPostgres(databaseUrl);
  } else {
    console.log("Mode Pemeriksaan     : API (Supabase OpenAPI/REST API)");
    console.log("                       Perhatian: Kategori yang tidak diekspos oleh API berstatus UNVERIFIED.");
    activeMode = "API";
    if (supabaseUrl && publishableKey && secretKey) {
      snapshot = await introspectViaSupabaseRest(
        supabaseUrl,
        publishableKey,
        secretKey,
        manifest
      );
    }
  }

  if (!snapshot) {
    console.log("\n[INSTRUKSI SUPABASE SQL EDITOR]");
    console.log("1. Buka Supabase Dashboard -> SQL Editor.");
    console.log("2. Buka file supabase/verify/verify.sql, salin isinya, lalu klik Run.");
    console.log("3. Ekspor hasil tabel sebagai CSV (tombol Export di kanan atas hasil) atau salin barisnya.");
    console.log("4. Jalankan: npm run verify:db -- --from-file <path-ke-file-hasil>\n");
    process.exit(0);
  }

  const { items, migrationStatuses } = evaluateDatabaseAgainstManifest(
    manifest,
    snapshot,
    allowedEmails,
    rootDir
  );

  const fixSuggestionsPath = path.join(verifyDir, "fix-suggestions.sql");
  fs.writeFileSync(
    fixSuggestionsPath,
    generateFixSuggestionsSql(items, manifest),
    "utf-8"
  );
  console.log(`Saran SQL ditulis di : supabase/verify/fix-suggestions.sql\n`);

  // =========================================================================
  // 1. STATUS PENERAPAN PER FILE MIGRASI
  // =========================================================================
  console.log("-------------------------------------------------------------------------------------");
  console.log(" 1. STATUS PENERAPAN PER FILE MIGRASI (Berdasarkan Definisi Tiap File)");
  console.log("-------------------------------------------------------------------------------------");
  console.log(
    `| ${"File Migrasi".padEnd(45)} | ${"Status".padEnd(16)} | ${"Objek".padEnd(7)} | Objek yang Hilang / Belum Sesuai`
  );
  console.log(
    `+-${"-".repeat(45)}-+-${"-".repeat(16)}-+-${"-".repeat(7)}-+----------------------------------`
  );
  for (const ms of migrationStatuses) {
    const ratio = `${ms.installedObjects}/${ms.totalObjects}`;
    const missingStr =
      ms.missingObjects.length === 0 ? "-" : ms.missingObjects.join(", ");
    console.log(
      `| ${ms.fileName.padEnd(45)} | ${ms.status.padEnd(16)} | ${ratio.padEnd(7)} | ${missingStr}`
    );
  }
  console.log("");

  // =========================================================================
  // 1b. STATUS KEADAAN AKHIR (CUMULATIVE FINAL STATE)
  // =========================================================================
  console.log("-------------------------------------------------------------------------------------");
  console.log(" 1b. STATUS KEADAAN AKHIR KUMULATIF (Cumulative Final State Target)");
  console.log("-------------------------------------------------------------------------------------");
  const finalFailures = items.filter((i) => i.status === "FAIL");
  const finalUnverified = items.filter((i) => i.status === "UNVERIFIED");
  if (finalFailures.length === 0) {
    console.log(`Target Keadaan Akhir: TERCAPAI PENUH (FAIL = 0)`);
  } else {
    console.log(
      `Target Keadaan Akhir: BELUM TERCAPAI (${finalFailures.length} selisih terhadap target akhir)`
    );
    for (const f of finalFailures) {
      console.log(`  - [${f.category}] ${f.objectName}: ${f.detail}`);
    }
  }
  if (finalUnverified.length > 0) {
    console.log(`  (Catatan: ${finalUnverified.length} item berstatus UNVERIFIED karena metode pemeriksaan saat ini adalah API)`);
  }
  console.log("");

  // =========================================================================
  // 2. MATRIKS RINGKASAN MENURUT STATUS DAN METODE
  // =========================================================================
  console.log("-------------------------------------------------------------------------------------");
  console.log(" 2. RINGKASAN PEMERIKSAAN MENURUT STATUS DAN METODE");
  console.log("-------------------------------------------------------------------------------------");
  console.log(
    `| ${"Status".padEnd(16)} | ${"DB".padStart(6)} | ${"API".padStart(6)} | ${"FILE".padStart(6)} | ${"TOTAL".padStart(6)} | Keterangan`
  );
  console.log(
    `+-${"-".repeat(16)}-+-${"-".repeat(6)}-+-${"-".repeat(6)}-+-${"-".repeat(6)}-+-${"-".repeat(6)}-+----------------------------------`
  );

  const statuses: Array<{ status: VerifyStatus; desc: string }> = [
    { status: "PASS", desc: "Terverifikasi sesuai manifest" },
    { status: "UNVERIFIED", desc: "Belum dapat diverifikasi tanpa koneksi DB" },
    { status: "MIGRATION-LINT", desc: "Temuan statis pada file migrasi repositori" },
    { status: "FAIL", desc: "Selisih antara database dan manifest" },
    { status: "DRIFT", desc: "Objek ekstra di database di luar manifest" },
    { status: "INFO", desc: "Informasi tambahan / metadata platform" },
  ];

  for (const st of statuses) {
    const dbCount = items.filter((i) => i.status === st.status && i.method === "DB").length;
    const apiCount = items.filter((i) => i.status === st.status && i.method === "API").length;
    const fileCount = items.filter((i) => i.status === st.status && i.method === "FILE").length;
    const totalCount = dbCount + apiCount + fileCount;

    console.log(
      `| ${st.status.padEnd(16)} | ${String(dbCount).padStart(6)} | ${String(apiCount).padStart(6)} | ${String(fileCount).padStart(6)} | ${String(totalCount).padStart(6)} | ${st.desc}`
    );
  }
  console.log("");

  // =========================================================================
  // 2b. RINCIAN PER KATEGORI (a s/d l)
  // =========================================================================
  console.log("-------------------------------------------------------------------------------------");
  console.log(" 2b. RINCIAN PER KATEGORI (a s/d l)");
  console.log("-------------------------------------------------------------------------------------");
  console.log(
    `| ${"Kategori".padEnd(52)} | ${"Metode".padEnd(6)} | ${"PASS".padStart(5)} | ${"UNV".padStart(5)} | ${"FAIL".padStart(5)} | ${"DRIFT".padStart(5)} | ${"INFO".padStart(5)} |`
  );
  console.log(
    `+-${"-".repeat(52)}-+-${"-".repeat(6)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+-${"-".repeat(5)}-+`
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

  for (const cat of categoryOrder) {
    const catItems = items.filter((i) => i.category === cat);
    const pass = catItems.filter((i) => i.status === "PASS").length;
    const unv = catItems.filter((i) => i.status === "UNVERIFIED").length;
    const fail = catItems.filter((i) => i.status === "FAIL" || i.status === "MIGRATION-LINT").length;
    const drift = catItems.filter((i) => i.status === "DRIFT").length;
    const info = catItems.filter((i) => i.status === "INFO").length;
    const methodStr = activeMode === "API" ? "API" : "DB";

    console.log(
      `| ${CATEGORY_TITLES[cat].padEnd(52)} | ${methodStr.padEnd(6)} | ${String(pass).padStart(5)} | ${String(unv).padStart(5)} | ${String(fail).padStart(5)} | ${String(drift).padStart(5)} | ${String(info).padStart(5)} |`
    );
  }
  console.log("");

  // =========================================================================
  // 3. TEMUAN MIGRATION-LINT (FILE-LEVEL)
  // =========================================================================
  const lintItems = items.filter((i) => i.status === "MIGRATION-LINT");
  if (lintItems.length > 0) {
    console.log("-------------------------------------------------------------------------------------");
    console.log(` 3. TEMUAN MIGRATION-LINT (${lintItems.length} temuan pada file repositori)`);
    console.log("-------------------------------------------------------------------------------------");
    for (const li of lintItems) {
      console.log(`[MIGRATION-LINT] (Metode: ${li.method}) ${li.objectName}`);
      console.log(`  Keterangan   : ${li.detail}`);
      if (li.fixMigration) {
        console.log(`  Perbaikan    : Jalankan ${li.fixMigration}`);
      }
      console.log("");
    }
  }

  // =========================================================================
  // 4. TEMUAN FAIL & DRIFT DATABASE
  // =========================================================================
  const dbFailures = items.filter((i) => i.status === "FAIL" || i.status === "DRIFT");
  console.log("-------------------------------------------------------------------------------------");
  console.log(` 4. TEMUAN FAIL & DRIFT DATABASE (${dbFailures.length} temuan)`);
  console.log("-------------------------------------------------------------------------------------");
  if (dbFailures.length === 0) {
    console.log("Tidak ditemukan FAIL maupun DRIFT pada database.");
  } else {
    for (const f of dbFailures) {
      console.log(`[${f.status}] (Metode: ${f.method}) [${f.category}] ${f.objectName}`);
      if (f.sourceMigration) {
        console.log(`  Migrasi asal : ${f.sourceMigration}`);
      }
      console.log(`  Keterangan   : ${f.detail}`);
      if (f.expected) console.log(`  Diharapkan   : ${f.expected}`);
      if (f.found) console.log(`  Ditemukan    : ${f.found}`);
      if (f.fixMigration) {
        console.log(`  Solusi       : Jalankan file migrasi ${f.fixMigration}`);
      } else if (f.fixSql) {
        console.log(`  Solusi SQL   : ${f.fixSql}`);
      }
      console.log("");
    }
  }

  // =========================================================================
  // PETUNJUK VERIFY.SQL / --FROM-FILE
  // =========================================================================
  if (activeMode === "API") {
    console.log("-------------------------------------------------------------------------------------");
    console.log(" CARA MENGUJI KATEGORI UNVERIFIED DENGAN METODE DB TANPA DATABASE_URL");
    console.log("-------------------------------------------------------------------------------------");
    console.log("1. Buka Supabase Dashboard -> SQL Editor.");
    console.log("2. Buka file supabase/verify/verify.sql di repositori ini, salin isinya, lalu klik Run.");
    console.log("3. Di pojok kanan atas tabel hasil, klik 'Export' -> 'Export to CSV' dan simpan ke file");
    console.log("   (atau pilih semua baris dan salin ke file teks).");
    console.log("4. Jalankan perintah berikut untuk menghasilkan laporan dengan Metode DB:");
    console.log("   npm run verify:db -- --from-file <path-ke-file-hasil>\n");
  }

  const failCount = items.filter((i) => i.status === "FAIL").length;
  if (failCount > 0 && (activeMode === "DB_DIRECT" || activeMode === "DB_FILE")) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    "Gagal menjalankan verify-db:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
