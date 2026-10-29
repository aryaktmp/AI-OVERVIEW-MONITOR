import { z } from "zod";

export const MAX_CSV_IMPORT_ROWS = 500;

export const CSV_TEMPLATE_CONTENT = [
  "keyword,group",
  "software hr terbaik,Produk HR",
  "aplikasi payroll indonesia,Produk HR",
  "cara hitung pph 21 karyawan,Panduan HR",
  "hris vs hrms,Perbandingan",
].join("\n");

export function normalizeWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export const csvKeywordRowSchema = z.object({
  keyword: z
    .string()
    .min(2, "Keyword must be at least 2 characters")
    .max(200, "Keyword must be at most 200 characters"),
  group: z.string().max(80, "Group name must be at most 80 characters"),
});

export interface ValidCsvRow {
  lineNumber: number;
  keyword: string;
  group: string;
}

export interface DuplicateCsvRow {
  lineNumber: number;
  keyword: string;
  group: string;
  reason: string;
}

export interface InvalidCsvRow {
  lineNumber: number;
  rawKeyword: string;
  rawGroup: string;
  reason: string;
}

export interface CsvImportPreview {
  validRows: ValidCsvRow[];
  duplicateRows: DuplicateCsvRow[];
  invalidRows: InvalidCsvRow[];
  newGroupsToCreate: string[];
  totalDataRows: number;
  exceededMaxRows: boolean;
}

/**
 * Mengurai satu baris CSV (mendukung tanda kutip ganda RFC 4180).
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Mengurai dan memvalidasi isi CSV dengan kolom `keyword,group`.
 * - Merapikan spasi berlebih
 * - Memvalidasi setiap baris dengan Zod
 * - Membatasi maksimal 500 baris data per impor
 * - Membuang duplikat (case-insensitive) baik di dalam file maupun terhadap keyword yang sudah ada
 * - Mendeteksi grup baru yang belum ada untuk dibuat otomatis
 */
export function parseKeywordCsvPreview(
  csvText: string,
  existingKeywords: string[] = [],
  existingGroups: string[] = []
): CsvImportPreview {
  const cleanedText = csvText.replace(/^\uFEFF/, "");
  const rawLines = cleanedText.split(/\r?\n/);

  const existingKwSet = new Set(
    existingKeywords.map((k) => normalizeWhitespace(k).toLowerCase())
  );
  const existingGroupSet = new Set(
    existingGroups.map((g) => normalizeWhitespace(g).toLowerCase())
  );

  const seenInFileKwSet = new Set<string>();
  const newGroupsMap = new Map<string, string>(); // lower -> original normalized

  const validRows: ValidCsvRow[] = [];
  const duplicateRows: DuplicateCsvRow[] = [];
  const invalidRows: InvalidCsvRow[] = [];

  let dataRowCount = 0;
  let exceededMaxRows = false;
  let headerChecked = false;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNumber = idx + 1;
    const rawLine = rawLines[idx] ?? "";
    if (!rawLine.trim()) {
      continue;
    }

    const cols = parseCsvLine(rawLine);
    const col0 = normalizeWhitespace(cols[0] ?? "");
    const col1 = normalizeWhitespace(cols[1] ?? "");

    if (!headerChecked) {
      headerChecked = true;
      if (
        col0.toLowerCase() === "keyword" &&
        (col1.toLowerCase() === "group" ||
          col1.toLowerCase() === "grup" ||
          col1 === "")
      ) {
        continue;
      }
    }

    dataRowCount++;

    if (dataRowCount > MAX_CSV_IMPORT_ROWS) {
      exceededMaxRows = true;
      invalidRows.push({
        lineNumber,
        rawKeyword: col0,
        rawGroup: col1,
        reason: `Exceeds maximum limit of ${MAX_CSV_IMPORT_ROWS} rows per import`,
      });
      continue;
    }

    if (cols.length > 2 && cols.slice(2).some((c) => c.trim().length > 0)) {
      invalidRows.push({
        lineNumber,
        rawKeyword: col0,
        rawGroup: col1,
        reason:
          "Too many columns (use 2-column format: keyword,group)",
      });
      continue;
    }

    const validation = csvKeywordRowSchema.safeParse({
      keyword: col0,
      group: col1,
    });

    if (!validation.success) {
      invalidRows.push({
        lineNumber,
        rawKeyword: col0,
        rawGroup: col1,
        reason:
          validation.error.issues[0]?.message ?? "Invalid CSV row",
      });
      continue;
    }

    const keyword = validation.data.keyword;
    const group = validation.data.group;
    const lowerKw = keyword.toLowerCase();

    if (existingKwSet.has(lowerKw)) {
      duplicateRows.push({
        lineNumber,
        keyword,
        group,
        reason: "Already exists in database",
      });
      continue;
    }

    if (seenInFileKwSet.has(lowerKw)) {
      duplicateRows.push({
        lineNumber,
        keyword,
        group,
        reason: "Duplicate inside CSV file",
      });
      continue;
    }

    seenInFileKwSet.add(lowerKw);
    validRows.push({
      lineNumber,
      keyword,
      group,
    });

    if (group) {
      const lowerGrp = group.toLowerCase();
      if (!existingGroupSet.has(lowerGrp) && !newGroupsMap.has(lowerGrp)) {
        newGroupsMap.set(lowerGrp, group);
      }
    }
  }

  return {
    validRows,
    duplicateRows,
    invalidRows,
    newGroupsToCreate: Array.from(newGroupsMap.values()),
    totalDataRows: dataRowCount,
    exceededMaxRows,
  };
}
