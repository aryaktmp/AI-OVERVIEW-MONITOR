export const CSV_EXPORT_HEADERS = [
  "keyword",
  "group",
  "checked_at",
  "status",
  "detected_domain",
  "detected_text",
  "detected_third_party",
  "source_domains",
  "competitor_domains_cited",
] as const;

export interface CsvExportRow {
  keyword: string;
  group: string;
  checked_at: string;
  status: string;
  detected_domain: boolean;
  detected_text: boolean;
  detected_third_party: boolean;
  source_domains: string[];
  competitor_domains_cited: string[];
}

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

/**
 * Perlindungan CSV Formula Injection (CSV Injection / DDE):
 * Sel yang diawali karakter '=', '+', '-', atau '@' (baik langsung maupun setelah spasi awal)
 * diberi awalan tanda kutip tunggal (') agar aplikasi spreadsheet tidak mengeksekusinya sebagai rumus.
 */
export function sanitizeCsvFormulaCell(raw: string): string {
  if (!raw) return "";
  const firstChar = raw[0]!;
  const trimmedFirstChar = raw.trimStart()[0];
  if (
    FORMULA_TRIGGER_CHARS.has(firstChar) ||
    (trimmedFirstChar !== undefined &&
      FORMULA_TRIGGER_CHARS.has(trimmedFirstChar))
  ) {
    return `'${raw}`;
  }
  return raw;
}

/**
 * Melakukan sanitasi formula injection dan escaping standar RFC 4180
 * untuk koma (,), tanda kutip ganda ("), dan baris baru (\r atau \n).
 */
export function escapeCsvCell(
  value: string | number | boolean | null | undefined
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  const safeStr = sanitizeCsvFormulaCell(str);

  if (
    safeStr.includes(",") ||
    safeStr.includes('"') ||
    safeStr.includes("\n") ||
    safeStr.includes("\r")
  ) {
    return `"${safeStr.replace(/"/g, '""')}"`;
  }

  return safeStr;
}

/**
 * Mengubah satu objek baris ekspor menjadi satu baris CSV sesuai urutan kolom SPEC.md.
 * Daftar domain sumber (source_domains) dan kompetitor (competitor_domains_cited) dipisahkan titik koma (;).
 */
export function formatCsvExportRow(row: CsvExportRow): string {
  const sourceDomainsJoined = row.source_domains
    .map((d) => d.trim())
    .filter(Boolean)
    .join(";");

  const competitorDomainsJoined = row.competitor_domains_cited
    .map((d) => d.trim())
    .filter(Boolean)
    .join(";");

  const cells = [
    escapeCsvCell(row.keyword),
    escapeCsvCell(row.group),
    escapeCsvCell(row.checked_at),
    escapeCsvCell(row.status),
    escapeCsvCell(row.detected_domain),
    escapeCsvCell(row.detected_text),
    escapeCsvCell(row.detected_third_party),
    escapeCsvCell(sourceDomainsJoined),
    escapeCsvCell(competitorDomainsJoined),
  ];

  return cells.join(",");
}

/**
 * Menghasilkan dokumen CSV lengkap beserta baris header.
 */
export function formatCsvExportDocument(rows: CsvExportRow[]): string {
  const headerLine = CSV_EXPORT_HEADERS.join(",");
  if (rows.length === 0) {
    return `${headerLine}\n`;
  }
  const bodyLines = rows.map(formatCsvExportRow);
  return `${headerLine}\n${bodyLines.join("\n")}\n`;
}
