import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifestFromDirectory,
  buildManifestFromSqlFiles,
  type MigrationManifest,
} from "../lib/migration-manifest";
import {
  evaluateDatabaseAgainstManifest,
  generateFixSuggestionsSql,
  generateStandaloneVerifySql,
  maskEmailAddress,
  VERIFY_DB_READONLY_QUERIES,
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

    // Pastikan manifest.json di disk sinkron dengan hasil parse terbaru dari supabase/migrations/
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
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE)\b/i;

    for (const [queryName, sqlQuery] of Object.entries(
      VERIFY_DB_READONLY_QUERIES
    )) {
      const match = sqlQuery.match(forbiddenKeywordsRegex);
      expect(
        match,
        `Kueri VERIFY_DB_READONLY_QUERIES.${queryName} tidak boleh memuat kata kunci tulis/DDL, ditemukan: ${match?.[0] ?? "tidak ada"}`
      ).toBeNull();
    }

    const manifest = buildManifestFromDirectory(migrationsDir);
    const standaloneSql = generateStandaloneVerifySql(manifest);
    const standaloneWithoutComments = standaloneSql.replace(/--.*$/gm, "");
    const standaloneMatch = standaloneWithoutComments.match(
      forbiddenKeywordsRegex
    );
    expect(
      standaloneMatch,
      `Kueri standalone verify.sql tidak boleh memuat kata kunci tulis/DDL, ditemukan: ${standaloneMatch?.[0] ?? "tidak ada"}`
    ).toBeNull();
  });

  it("mem-parsing contoh migrasi sintetis secara berurutan (tabel, kolom baru, constraint, indeks, RLS, view security_invoker, fungsi SECURITY DEFINER, GRANT/REVOKE, dan seed)", () => {
    const sampleMigrations = [
      {
        fileName: "0001_init.sql",
        content: `
          CREATE EXTENSION IF NOT EXISTS "pgcrypto";

          CREATE TABLE items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
            title text UNIQUE NOT NULL,
            state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done')),
            created_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE INDEX items_state_idx ON items(state);

          ALTER TABLE items ENABLE ROW LEVEL SECURITY;

          CREATE POLICY "Authenticated can select items"
            ON items FOR SELECT TO authenticated USING (true);

          INSERT INTO brand_terms (term, enabled) VALUES
            ('LinovHR', true),
            ('Linov', false)
          ON CONFLICT (term) DO NOTHING;

          INSERT INTO settings (key, value) VALUES
            ('search_config', '{"enable_third_party_check": true}'::jsonb)
          ON CONFLICT (key) DO NOTHING;
        `,
      },
      {
        fileName: "0002_alter_and_fn.sql",
        content: `
          ALTER TABLE items ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

          CREATE OR REPLACE VIEW active_items
          WITH (security_invoker = true) AS
          SELECT id, title, is_demo FROM items WHERE state = 'done';

          CREATE OR REPLACE FUNCTION public.get_item_count()
          RETURNS bigint
          LANGUAGE sql
          STABLE
          SECURITY DEFINER
          SET search_path = public
          AS $$
            SELECT count(*)::bigint FROM public.items;
          $$;

          REVOKE EXECUTE ON FUNCTION public.get_item_count() FROM PUBLIC, anon, authenticated;
          GRANT EXECUTE ON FUNCTION public.get_item_count() TO service_role;

          UPDATE public.settings
          SET value = jsonb_set(value, '{enable_third_party_check}', 'false'::jsonb, true)
          WHERE key = 'search_config';
        `,
      },
    ];

    const manifest = buildManifestFromSqlFiles(sampleMigrations, "synthetic");

    expect(manifest.migrationFiles).toEqual([
      "0001_init.sql",
      "0002_alter_and_fn.sql",
    ]);
    expect(manifest.finalState.extensions).toEqual([
      { name: "pgcrypto", sourceMigration: "0001_init.sql" },
    ]);

    const itemsTable = manifest.finalState.tables["items"];
    expect(itemsTable).toBeDefined();
    expect(itemsTable!.rlsEnabled).toBe(true);
    const isDemoCol = itemsTable!.columns.find((c) => c.name === "is_demo");
    expect(isDemoCol).toEqual({
      name: "is_demo",
      dataType: "boolean",
      normalizedType: "boolean",
      nullable: false,
      defaultExpr: "false",
      isPrimaryKey: false,
      isUnique: false,
      sourceMigration: "0002_alter_and_fn.sql",
    });

    // Pastikan FK ON DELETE SET NULL dan CHECK constraint tercatat
    const fk = itemsTable!.constraints.find((c) => c.type === "FOREIGN KEY");
    expect(fk?.referencesTable).toBe("groups");
    expect(fk?.onDelete).toBe("SET NULL");

    const chk = itemsTable!.constraints.find((c) => c.type === "CHECK");
    expect(chk?.checkExpression).toContain("pending");

    // Pastikan view dan opsi security_invoker tercatat
    const view = manifest.finalState.views["active_items"];
    expect(view).toBeDefined();
    expect(view!.securityInvoker).toBe(true);

    // Pastikan fungsi SECURITY DEFINER, search_path, REVOKE, dan GRANT tercatat
    const fn = manifest.finalState.functions["get_item_count"];
    expect(fn).toBeDefined();
    expect(fn!.securityDefiner).toBe(true);
    expect(fn!.searchPath).toBe("public");
    expect(fn!.revokedFrom).toEqual(
      expect.arrayContaining(["public", "anon", "authenticated"])
    );
    expect(fn!.grantedTo).toContain("service_role");

    // Pastikan keadaan akhir seed settings mengikuti migrasi kedua (enable_third_party_check = false)
    expect(
      manifest.finalState.seeds.settings["search_config"]?.value
        .enable_third_party_check
    ).toBe(false);

    // Uji evaluator terhadap snapshot yang memiliki ketidaksesuaian & pastikan fix-suggestions.sql dihasilkan
    const evaluation = evaluateDatabaseAgainstManifest(
      manifest,
      {
        source: "pg",
        extensions: ["pgcrypto"],
        tables: [
          { name: "items", rlsEnabled: true },
          { name: "extra_untracked_table", rlsEnabled: false },
        ],
        columns: [
          {
            table: "items",
            name: "id",
            dataType: "uuid",
            nullable: false,
            defaultExpr: "gen_random_uuid()",
          },
          {
            table: "items",
            name: "group_id",
            dataType: "uuid",
            nullable: true,
            defaultExpr: null,
          },
          {
            table: "items",
            name: "title",
            dataType: "text",
            nullable: false,
            defaultExpr: null,
          },
          {
            table: "items",
            name: "state",
            dataType: "text",
            nullable: false,
            defaultExpr: "'pending'",
          },
          {
            table: "items",
            name: "created_at",
            dataType: "timestamptz",
            nullable: false,
            defaultExpr: "now()",
          },
        ],
        constraints: [],
        indexes: [],
        policies: [],
        tablePrivilegesSummary: [],
        views: [
          {
            name: "active_items",
            exists: true,
            securityInvoker: false,
            definitionSql: "SELECT id, title, is_demo FROM items WHERE state = 'done'",
          },
        ],
        functions: [
          {
            name: "get_item_count",
            argsSignature: "",
            returnType: "bigint",
            language: "sql",
            securityDefiner: true,
            searchPath: null,
            publicCanExecute: true,
            anonCanExecute: true,
            authenticatedCanExecute: false,
            serviceRoleCanExecute: true,
          },
        ],
        seeds: {
          brandTerms: [
            { term: "LinovHR", enabled: true },
            { term: "Linov", enabled: false },
          ],
          settings: {
            search_config: { enable_third_party_check: true },
          },
        },
        demoCounts: {
          check_runs: 0,
          keywords: 0,
          keyword_groups: 0,
          competitors: 0,
        },
        schemaMigrations: null,
        authUsers: {
          totalUsers: 1,
          emailsLower: ["admin@linovhr.com"],
        },
      },
      ["admin@linovhr.com"]
    );

    const driftTable = evaluation.items.find(
      (i) => i.category === "a" && i.status === "DRIFT"
    );
    expect(driftTable?.objectName).toContain("extra_untracked_table");

    const missingCol = evaluation.items.find(
      (i) => i.category === "b" && i.objectName === "Kolom items.is_demo"
    );
    expect(missingCol?.status).toBe("FAIL");

    const fixSql = generateFixSuggestionsSql(evaluation.items, manifest);
    expect(fixSql).toContain("ADD COLUMN IF NOT EXISTS is_demo");
    expect(fixSql).toContain("REVOKE EXECUTE ON FUNCTION public.get_item_count()");

    // Pastikan penyamaran email menyembunyikan identitas pengguna
    expect(maskEmailAddress("aryakk@linovhr.com")).toBe("a***@linovhr.com");
  });
});
