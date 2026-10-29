import fs from "node:fs";
import path from "node:path";

export interface ManifestExtension {
  name: string;
  sourceMigration: string;
}

export interface ManifestColumn {
  name: string;
  dataType: string;
  normalizedType: string;
  nullable: boolean;
  defaultExpr: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  sourceMigration: string;
}

export interface ManifestConstraint {
  type: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK";
  columns: string[];
  referencesTable?: string;
  referencesColumn?: string;
  onDelete?: string;
  checkExpression?: string;
  sourceMigration: string;
}

export interface ManifestTable {
  name: string;
  sourceMigration: string;
  modifiedByMigrations: string[];
  rlsEnabled: boolean;
  rlsSourceMigration: string | null;
  columns: ManifestColumn[];
  constraints: ManifestConstraint[];
}

export interface ManifestIndex {
  name: string;
  table: string;
  columnsExpr: string;
  columns: Array<{ name: string; order: "ASC" | "DESC" }>;
  unique: boolean;
  sourceMigration: string;
}

export interface ManifestPolicy {
  name: string;
  table: string;
  command: string;
  roles: string[];
  usingExpr: string;
  withCheckExpr: string | null;
  sourceMigration: string;
}

export interface ManifestView {
  name: string;
  securityInvoker: boolean;
  definitionSql: string;
  normalizedDefinition: string;
  sourceMigration: string;
  modifiedByMigrations: string[];
}

export interface ManifestFunction {
  name: string;
  schema: string;
  argsSignature: string;
  argTypes: string[];
  returnType: string;
  language: string;
  securityDefiner: boolean;
  searchPath: string | null;
  revokedFrom: string[];
  grantedTo: string[];
  sourceMigration: string;
  modifiedByMigrations: string[];
}

export interface ManifestPermissionOp {
  action: "GRANT" | "REVOKE";
  privileges: string[];
  objectType: "FUNCTION" | "TABLE";
  objectName: string;
  argsSignature: string;
  roles: string[];
  sourceMigration: string;
}

export interface ManifestBrandTermSeed {
  term: string;
  enabled: boolean;
  sourceMigration: string;
}

export interface ManifestSettingSeed {
  key: string;
  value: Record<string, unknown>;
  sourceMigration: string;
  modifiedByMigrations: string[];
}

export interface MigrationFileStepSummary {
  fileName: string;
  extensionsCreated: string[];
  tablesCreated: string[];
  columnsAdded: Array<{ table: string; column: string; dataType: string }>;
  indexesCreated: string[];
  rlsEnabledTables: string[];
  policiesCreated: Array<{ name: string; table: string }>;
  viewsCreatedOrReplaced: string[];
  functionsCreatedOrReplaced: string[];
  permissionOps: ManifestPermissionOp[];
  seedUpdates: string[];
}

export interface MigrationManifest {
  generatedFromDir: string;
  migrationFiles: string[];
  perFileSummary: MigrationFileStepSummary[];
  finalState: {
    extensions: ManifestExtension[];
    tables: Record<string, ManifestTable>;
    indexes: ManifestIndex[];
    policies: ManifestPolicy[];
    views: Record<string, ManifestView>;
    functions: Record<string, ManifestFunction>;
    permissions: ManifestPermissionOp[];
    seeds: {
      brand_terms: ManifestBrandTermSeed[];
      settings: Record<string, ManifestSettingSeed>;
    };
  };
}

export function normalizeSqlType(rawType: string): string {
  const t = rawType.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "int" || t === "int4" || t === "int32" || t === "integer") {
    return "integer";
  }
  if (t === "int8" || t === "int64" || t === "bigint") return "bigint";
  if (t === "bool" || t === "boolean") return "boolean";
  if (t === "timestamptz" || t === "timestamp with time zone") {
    return "timestamp with time zone";
  }
  return t;
}

export function normalizeSqlDefault(rawDefault: string | null): string | null {
  if (rawDefault === null || rawDefault === undefined) return null;
  return rawDefault
    .trim()
    .replace(/::[a-zA-Z0-9_ ]+/g, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim()
    .toLowerCase();
}

export function normalizeViewSql(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/;$/, "")
    .trim()
    .toLowerCase();
}

function splitTopLevelComma(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inSingleQuote = false;
  let current = "";

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "'" && body[i - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (!inSingleQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === "," && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function parseColumnDefinition(
  rawDef: string,
  sourceMigration: string
): {
  column?: ManifestColumn;
  constraints: ManifestConstraint[];
} {
  const cleaned = rawDef.trim();
  const constraints: ManifestConstraint[] = [];

  // Table-level constraint check
  if (/^(primary\s+key|unique|foreign\s+key|constraint|check)\b/i.test(cleaned)) {
    const pkMatch = cleaned.match(/primary\s+key\s*\(([^)]+)\)/i);
    if (pkMatch?.[1]) {
      constraints.push({
        type: "PRIMARY KEY",
        columns: pkMatch[1].split(",").map((s) => s.trim()),
        sourceMigration,
      });
    }
    const uqMatch = cleaned.match(/unique\s*\(([^)]+)\)/i);
    if (uqMatch?.[1]) {
      constraints.push({
        type: "UNIQUE",
        columns: uqMatch[1].split(",").map((s) => s.trim()),
        sourceMigration,
      });
    }
    const chkMatch = cleaned.match(/check\s*\((.+)\)$/i);
    if (chkMatch?.[1]) {
      constraints.push({
        type: "CHECK",
        columns: [],
        checkExpression: chkMatch[1].trim(),
        sourceMigration,
      });
    }
    return { constraints };
  }

  const colMatch = cleaned.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)(.*)$/i);
  if (!colMatch) return { constraints };

  const colName = colMatch[1]!;
  const rawDataType = colMatch[2]!;
  const rest = (colMatch[3] ?? "").trim();

  const isPrimaryKey = /\bprimary\s+key\b/i.test(rest);
  const isUnique = /\bunique\b/i.test(rest);
  const isNotNull = isPrimaryKey || /\bnot\s+null\b/i.test(rest);

  let defaultExpr: string | null = null;
  const defaultMatch = rest.match(
    /\bdefault\s+(.+?)(?=\s+(?:not\s+null|null|primary\s+key|unique|references|check)\b|$)/i
  );
  if (defaultMatch?.[1]) {
    defaultExpr = defaultMatch[1].trim();
  }

  if (isPrimaryKey) {
    constraints.push({
      type: "PRIMARY KEY",
      columns: [colName],
      sourceMigration,
    });
  }

  if (isUnique) {
    constraints.push({
      type: "UNIQUE",
      columns: [colName],
      sourceMigration,
    });
  }

  const fkMatch = rest.match(
    /\breferences\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(\s*([a-zA-Z0-9_]+)\s*\)(?:\s+on\s+delete\s+(cascade|set\s+null|restrict|no\s+action))?/i
  );
  if (fkMatch?.[1] && fkMatch?.[2]) {
    const onDeleteRaw = (fkMatch[3] ?? "NO ACTION")
      .replace(/\s+/g, " ")
      .toUpperCase();
    constraints.push({
      type: "FOREIGN KEY",
      columns: [colName],
      referencesTable: fkMatch[1],
      referencesColumn: fkMatch[2],
      onDelete: onDeleteRaw,
      sourceMigration,
    });
  }

  const checkMatch = rest.match(/\bcheck\s*\((.+)\)/i);
  if (checkMatch?.[1]) {
    constraints.push({
      type: "CHECK",
      columns: [colName],
      checkExpression: checkMatch[1].trim(),
      sourceMigration,
    });
  }

  return {
    column: {
      name: colName,
      dataType: rawDataType.toLowerCase(),
      normalizedType: normalizeSqlType(rawDataType),
      nullable: !isNotNull,
      defaultExpr,
      isPrimaryKey,
      isUnique,
      sourceMigration,
    },
    constraints,
  };
}

function parseFunctionArgTypes(rawArgs: string): string[] {
  const trimmed = rawArgs.trim();
  if (!trimmed) return [];
  const parts = splitTopLevelComma(trimmed);
  return parts.map((part) => {
    const withoutDefault = part.split(/\bdefault\b|=/i)[0]!.trim();
    const tokens = withoutDefault.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      return normalizeSqlType(tokens[0]!);
    }
    const modePrefix = /^(in|out|inout|variadic)$/i.test(tokens[0]!) ? 1 : 0;
    const typeTokens = tokens.slice(modePrefix + 1);
    return normalizeSqlType(
      typeTokens.length > 0 ? typeTokens.join(" ") : tokens[tokens.length - 1]!
    );
  });
}

/**
 * Menyusun manifest lengkap dari daftar dokumen migrasi SQL secara berurutan.
 * Sumber kebenaran murni berasal dari teks SQL migrasi.
 */
export function buildManifestFromSqlFiles(
  files: Array<{ fileName: string; content: string }>,
  generatedFromDir = "supabase/migrations"
): MigrationManifest {
  const sortedFiles = [...files].sort((a, b) =>
    a.fileName.localeCompare(b.fileName)
  );

  const extensionsMap = new Map<string, ManifestExtension>();
  const tables: Record<string, ManifestTable> = {};
  const indexesMap = new Map<string, ManifestIndex>();
  const policiesMap = new Map<string, ManifestPolicy>();
  const views: Record<string, ManifestView> = {};
  const functions: Record<string, ManifestFunction> = {};
  const permissions: ManifestPermissionOp[] = [];
  const brandTermsMap = new Map<string, ManifestBrandTermSeed>();
  const settingsMap: Record<string, ManifestSettingSeed> = {};
  const perFileSummary: MigrationFileStepSummary[] = [];

  for (const file of sortedFiles) {
    const { fileName, content } = file;
    // Buang komentar satu baris (-- ...) tetapi pertahankan struktur baris
    const cleanSql = content.replace(/--.*$/gm, "");

    const stepSummary: MigrationFileStepSummary = {
      fileName,
      extensionsCreated: [],
      tablesCreated: [],
      columnsAdded: [],
      indexesCreated: [],
      rlsEnabledTables: [],
      policiesCreated: [],
      viewsCreatedOrReplaced: [],
      functionsCreatedOrReplaced: [],
      permissionOps: [],
      seedUpdates: [],
    };

    // 1. CREATE EXTENSION
    const extRegex =
      /create\s+extension\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([a-zA-Z0-9_-]+))/gi;
    let extMatch: RegExpExecArray | null;
    while ((extMatch = extRegex.exec(cleanSql)) !== null) {
      const extName = (extMatch[1] ?? extMatch[2] ?? "").trim();
      if (extName) {
        extensionsMap.set(extName, {
          name: extName,
          sourceMigration: fileName,
        });
        stepSummary.extensionsCreated.push(extName);
      }
    }

    // 2. CREATE TABLE
    const createTableRegex =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
    let tblMatch: RegExpExecArray | null;
    while ((tblMatch = createTableRegex.exec(cleanSql)) !== null) {
      const tableName = tblMatch[1]!.trim();
      const body = tblMatch[2]!;
      const itemDefs = splitTopLevelComma(body);

      const cols: ManifestColumn[] = [];
      const tableConstraints: ManifestConstraint[] = [];

      for (const itemDef of itemDefs) {
        const parsed = parseColumnDefinition(itemDef, fileName);
        if (parsed.column) {
          cols.push(parsed.column);
        }
        tableConstraints.push(...parsed.constraints);
      }

      tables[tableName] = {
        name: tableName,
        sourceMigration: fileName,
        modifiedByMigrations: [fileName],
        rlsEnabled: false,
        rlsSourceMigration: null,
        columns: cols,
        constraints: tableConstraints,
      };
      stepSummary.tablesCreated.push(tableName);
    }

    // 3. ALTER TABLE ... ADD COLUMN
    const alterAddColRegex =
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([^;]+);/gi;
    let alterMatch: RegExpExecArray | null;
    while ((alterMatch = alterAddColRegex.exec(cleanSql)) !== null) {
      const tableName = alterMatch[1]!.trim();
      const colDefStr = alterMatch[2]!.trim();
      const parsed = parseColumnDefinition(colDefStr, fileName);
      const targetTable = tables[tableName];
      if (targetTable && parsed.column) {
        const existingIdx = targetTable.columns.findIndex(
          (c) => c.name === parsed.column!.name
        );
        if (existingIdx >= 0) {
          targetTable.columns[existingIdx] = parsed.column;
        } else {
          targetTable.columns.push(parsed.column);
        }
        targetTable.constraints.push(...parsed.constraints);
        if (!targetTable.modifiedByMigrations.includes(fileName)) {
          targetTable.modifiedByMigrations.push(fileName);
        }
        stepSummary.columnsAdded.push({
          table: tableName,
          column: parsed.column.name,
          dataType: parsed.column.normalizedType,
        });
      }
    }

    // 4. CREATE INDEX
    const indexRegex =
      /create\s+(unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+)\s+on\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*;/gi;
    let idxMatch: RegExpExecArray | null;
    while ((idxMatch = indexRegex.exec(cleanSql)) !== null) {
      const isUnique = Boolean(idxMatch[1]);
      const idxName = idxMatch[2]!.trim();
      const tableName = idxMatch[3]!.trim();
      const colsExpr = idxMatch[4]!.trim();
      const colsParsed = colsExpr.split(",").map((c) => {
        const tokens = c.trim().split(/\s+/);
        const name = tokens[0]!;
        const order: "ASC" | "DESC" =
          tokens[1]?.toUpperCase() === "DESC" ? "DESC" : "ASC";
        return { name, order };
      });

      indexesMap.set(idxName, {
        name: idxName,
        table: tableName,
        columnsExpr: colsExpr.replace(/\s+/g, " "),
        columns: colsParsed,
        unique: isUnique,
        sourceMigration: fileName,
      });
      stepSummary.indexesCreated.push(idxName);
    }

    // 5. ALTER TABLE ... ENABLE ROW LEVEL SECURITY
    const rlsRegex =
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s+enable\s+row\s+level\s+security\s*;/gi;
    let rlsMatch: RegExpExecArray | null;
    while ((rlsMatch = rlsRegex.exec(cleanSql)) !== null) {
      const tableName = rlsMatch[1]!.trim();
      if (tables[tableName]) {
        tables[tableName]!.rlsEnabled = true;
        tables[tableName]!.rlsSourceMigration = fileName;
      }
      stepSummary.rlsEnabledTables.push(tableName);
    }

    // 6. CREATE POLICY
    const policyRegex =
      /create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?([a-zA-Z0-9_]+)\s+for\s+(select|insert|update|delete|all)\s+to\s+([a-zA-Z0-9_,\s]+?)\s+using\s*\(([^;]+?)\)(?:\s+with\s+check\s*\(([^;]+?)\))?\s*;/gi;
    let polMatch: RegExpExecArray | null;
    while ((polMatch = policyRegex.exec(cleanSql)) !== null) {
      const polName = polMatch[1]!.trim();
      const tableName = polMatch[2]!.trim();
      const command = polMatch[3]!.trim().toUpperCase();
      const roles = polMatch[4]!
        .split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);
      const usingExpr = polMatch[5]!.trim();
      const withCheckExpr = polMatch[6] ? polMatch[6].trim() : null;

      policiesMap.set(`${tableName}::${polName}`, {
        name: polName,
        table: tableName,
        command,
        roles,
        usingExpr,
        withCheckExpr,
        sourceMigration: fileName,
      });
      stepSummary.policiesCreated.push({ name: polName, table: tableName });
    }

    // 7. CREATE [OR REPLACE] VIEW
    const viewRegex =
      /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-zA-Z0-9_]+)\s*(?:with\s*\(([^)]+)\))?\s+as\s+([\s\S]*?);/gi;
    let viewMatch: RegExpExecArray | null;
    while ((viewMatch = viewRegex.exec(cleanSql)) !== null) {
      const viewName = viewMatch[1]!.trim();
      const withOpts = (viewMatch[2] ?? "").toLowerCase();
      const defSql = viewMatch[3]!.trim();
      const securityInvoker = /security_invoker\s*=\s*(?:true|on|1)/i.test(
        withOpts
      );

      const existing = views[viewName];
      const modifiedList = existing
        ? [...existing.modifiedByMigrations, fileName]
        : [fileName];

      views[viewName] = {
        name: viewName,
        securityInvoker,
        definitionSql: defSql,
        normalizedDefinition: normalizeViewSql(defSql),
        sourceMigration: existing ? existing.sourceMigration : fileName,
        modifiedByMigrations: modifiedList,
      };
      stepSummary.viewsCreatedOrReplaced.push(viewName);
    }

    // 8. CREATE [OR REPLACE] FUNCTION
    const fnRegex =
      /create\s+(?:or\s+replace\s+)?function\s+(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)\s*\(((?:[^()]|\([^()]*\))*)\)\s*returns\s+([\s\S]*?)\s+as\s+\$\$([\s\S]*?)\$\$\s*;/gi;
    let fnMatch: RegExpExecArray | null;
    while ((fnMatch = fnRegex.exec(cleanSql)) !== null) {
      const schemaName = (fnMatch[1] ?? "public").trim().toLowerCase();
      const fnName = fnMatch[2]!.trim().toLowerCase();
      const rawArgs = fnMatch[3]!.trim();
      const headerTail = fnMatch[4]!.trim();

      const argTypes = parseFunctionArgTypes(rawArgs);
      const returnTypeMatch = headerTail.match(
        /^(.+?)(?=\s+(?:language|security|set|immutable|stable|volatile)\b|$)/i
      );
      const returnType = (returnTypeMatch?.[1] ?? headerTail)
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();

      const langMatch = headerTail.match(/\blanguage\s+([a-zA-Z0-9_]+)/i);
      const language = (langMatch?.[1] ?? "sql").toLowerCase();
      const securityDefiner = /\bsecurity\s+definer\b/i.test(headerTail);
      const searchPathMatch = headerTail.match(
        /\bset\s+search_path\s*(?:=|\s+to\s+)\s*([a-zA-Z0-9_,\s"']+)/i
      );
      const searchPath = searchPathMatch?.[1]
        ? searchPathMatch[1].trim().replace(/^['"]|['"]$/g, "")
        : null;

      const existing = functions[fnName];
      const modifiedList = existing
        ? [...existing.modifiedByMigrations, fileName]
        : [fileName];

      functions[fnName] = {
        name: fnName,
        schema: schemaName,
        argsSignature: argTypes.join(", "),
        argTypes,
        returnType,
        language,
        securityDefiner,
        searchPath,
        revokedFrom: existing ? [...existing.revokedFrom] : [],
        grantedTo: existing ? [...existing.grantedTo] : [],
        sourceMigration: existing ? existing.sourceMigration : fileName,
        modifiedByMigrations: modifiedList,
      };
      stepSummary.functionsCreatedOrReplaced.push(fnName);
    }

    // 9. REVOKE & GRANT ON FUNCTION
    const permRegex =
      /(revoke|grant)\s+(all(?:\s+privileges)?|execute)\s+on\s+function\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(((?:[^()]|\([^()]*\))*)\)\s+(?:from|to)\s+([^;]+);/gi;
    let permMatch: RegExpExecArray | null;
    while ((permMatch = permRegex.exec(cleanSql)) !== null) {
      const action = permMatch[1]!.toUpperCase() as "GRANT" | "REVOKE";
      const privRaw = permMatch[2]!.toUpperCase();
      const fnName = permMatch[3]!.trim().toLowerCase();
      const argsSig = parseFunctionArgTypes(permMatch[4] ?? "").join(", ");
      const roles = permMatch[5]!
        .split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);

      const permOp: ManifestPermissionOp = {
        action,
        privileges: privRaw.startsWith("ALL") ? ["ALL", "EXECUTE"] : ["EXECUTE"],
        objectType: "FUNCTION",
        objectName: fnName,
        argsSignature: argsSig,
        roles,
        sourceMigration: fileName,
      };
      permissions.push(permOp);
      stepSummary.permissionOps.push(permOp);

      const targetFn = functions[fnName];
      if (targetFn) {
        if (!targetFn.modifiedByMigrations.includes(fileName)) {
          targetFn.modifiedByMigrations.push(fileName);
        }
        if (action === "REVOKE") {
          for (const r of roles) {
            if (!targetFn.revokedFrom.includes(r)) {
              targetFn.revokedFrom.push(r);
            }
          }
        } else if (action === "GRANT") {
          for (const r of roles) {
            if (!targetFn.grantedTo.includes(r)) {
              targetFn.grantedTo.push(r);
            }
          }
        }
      }
    }

    // 10. Baris Seed: brand_terms
    const brandSeedBlockMatch = cleanSql.match(
      /insert\s+into\s+(?:public\.)?brand_terms\s*\(\s*term\s*,\s*enabled\s*\)\s*values\s*([\s\S]*?)(?:on\s+conflict[\s\S]*?)?;/i
    );
    if (brandSeedBlockMatch?.[1]) {
      const tupleRegex = /\(\s*'([^']+)'\s*,\s*(true|false)\s*\)/gi;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tupleRegex.exec(brandSeedBlockMatch[1])) !== null) {
        const term = tMatch[1]!;
        const enabled = tMatch[2]!.toLowerCase() === "true";
        brandTermsMap.set(term, {
          term,
          enabled,
          sourceMigration: fileName,
        });
      }
      stepSummary.seedUpdates.push("brand_terms");
    }

    // 11. Baris Seed: settings
    const settingsSeedRegex =
      /insert\s+into\s+(?:public\.)?settings\s*\(\s*key\s*,\s*value\s*\)\s*values\s*\(\s*'([^']+)'\s*,\s*'(\{[\s\S]*?\})'::jsonb\s*\)\s*on\s+conflict\s*\(\s*key\s*\)\s*do\s+(nothing|update[\s\S]*?);/gi;
    let setMatch: RegExpExecArray | null;
    while ((setMatch = settingsSeedRegex.exec(cleanSql)) !== null) {
      const key = setMatch[1]!;
      const jsonStr = setMatch[2]!;
      const conflictClause = setMatch[3]!;

      try {
        const parsedVal = JSON.parse(jsonStr) as Record<string, unknown>;
        const existing = settingsMap[key];

        if (!existing) {
          settingsMap[key] = {
            key,
            value: parsedVal,
            sourceMigration: fileName,
            modifiedByMigrations: [fileName],
          };
        } else if (/^update/i.test(conflictClause)) {
          const jsonbSetMatch = conflictClause.match(
            /jsonb_set\s*\([^,]+,\s*'\{([^}]+)\}'\s*,\s*'([^']+)'::jsonb/i
          );
          const nextValue = { ...existing.value, ...parsedVal };
          if (jsonbSetMatch?.[1] && jsonbSetMatch?.[2]) {
            const fieldKey = jsonbSetMatch[1].trim();
            nextValue[fieldKey] = JSON.parse(jsonbSetMatch[2]);
          }
          existing.value = nextValue;
          if (!existing.modifiedByMigrations.includes(fileName)) {
            existing.modifiedByMigrations.push(fileName);
          }
        }
        stepSummary.seedUpdates.push(`settings(${key})`);
      } catch {
        // Abaikan jika JSON tidak valid
      }
    }

    // 11b. UPDATE langsung pada settings (misal: UPDATE settings SET value = jsonb_set(...) WHERE key = '...')
    const settingsUpdateRegex =
      /update\s+(?:public\.)?settings\s+set\s+([\s\S]*?)\s+where\s+key\s*=\s*'([^']+)'\s*;/gi;
    let updMatch: RegExpExecArray | null;
    while ((updMatch = settingsUpdateRegex.exec(cleanSql)) !== null) {
      const setClause = updMatch[1]!;
      const key = updMatch[2]!;
      const existing = settingsMap[key];
      if (existing) {
        const jsonbSetMatch = setClause.match(
          /jsonb_set\s*\([^,]+,\s*'\{([^}]+)\}'\s*,\s*'([^']+)'::jsonb/i
        );
        if (jsonbSetMatch?.[1] && jsonbSetMatch?.[2]) {
          try {
            const fieldKey = jsonbSetMatch[1].trim();
            existing.value = {
              ...existing.value,
              [fieldKey]: JSON.parse(jsonbSetMatch[2]),
            };
            if (!existing.modifiedByMigrations.includes(fileName)) {
              existing.modifiedByMigrations.push(fileName);
            }
            stepSummary.seedUpdates.push(`settings(${key})`);
          } catch {
            // Abaikan jika JSON tidak valid
          }
        }
      }
    }

    perFileSummary.push(stepSummary);
  }

  return {
    generatedFromDir,
    migrationFiles: sortedFiles.map((f) => f.fileName),
    perFileSummary,
    finalState: {
      extensions: Array.from(extensionsMap.values()),
      tables,
      indexes: Array.from(indexesMap.values()),
      policies: Array.from(policiesMap.values()),
      views,
      functions,
      permissions,
      seeds: {
        brand_terms: Array.from(brandTermsMap.values()),
        settings: settingsMap,
      },
    },
  };
}

export function loadMigrationsAndBuildManifest(
  migrationsDir = path.join(process.cwd(), "supabase", "migrations")
): MigrationManifest {
  const fileNames = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const files = fileNames.map((fileName) => ({
    fileName,
    content: fs.readFileSync(path.join(migrationsDir, fileName), "utf-8"),
  }));

  return buildManifestFromSqlFiles(files, "supabase/migrations");
}

export const buildManifestFromDirectory = loadMigrationsAndBuildManifest;
