import ExcelJS from "exceljs";

export interface ExcelExportRow {
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

export interface ExcelExportMetadata {
  reportTitle?: string;
  generatedAt?: string;
  mode: "latest" | "history";
  dateRange?: {
    from?: string | null;
    to?: string | null;
  };
  includeDemo?: boolean;
  totalKeywords?: number;
  detectedKeywords?: number;
  detectionRate?: number;
  aiOverviewCount?: number;
  aiOverviewRate?: number;
}

const COLOR_HEADER_BG = "FF1E293B"; // Slate-800
const COLOR_HEADER_TEXT = "FFFFFFFF"; // White
const COLOR_SECTION_BG = "FF334155"; // Slate-700
const COLOR_BORDER = "FFE2E8F0"; // Slate-200
const COLOR_DETECTED_TEXT = "FF059669"; // Emerald-600
const COLOR_MUTED_TEXT = "FF64748B"; // Slate-500

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLOR_BORDER } },
  left: { style: "thin", color: { argb: COLOR_BORDER } },
  bottom: { style: "thin", color: { argb: COLOR_BORDER } },
  right: { style: "thin", color: { argb: COLOR_BORDER } },
};

/**
 * Format tanggal ramah pengguna untuk teks metadata.
 */
function formatReadableDateTime(isoString?: string | null): string {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString("id-ID", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoString;
  }
}

/**
 * Membuat buffer file Excel (.xlsx) dengan 2 sheet:
 * 1. Data Pantauan (Monitoring Data): Tabel utama dengan styling, freeze header, dan auto-filter.
 * 2. Ringkasan & Metadata (Summary): Ringkasan KPI dan parameter ekspor.
 */
export async function generateExcelExportBuffer(
  rows: ExcelExportRow[],
  metadata: ExcelExportMetadata
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LinovHR AI Overview Monitor";
  workbook.lastModifiedBy = "LinovHR AI Overview Monitor";
  workbook.created = metadata.generatedAt
    ? new Date(metadata.generatedAt)
    : new Date();
  workbook.modified = new Date();

  // ==========================================
  // SHEET 1: Data Pantauan
  // ==========================================
  const dataSheet = workbook.addWorksheet("Data Pantauan", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 4 }],
  });

  // 1. Blok Judul Laporan (Baris 1-2)
  const titleCell = dataSheet.getCell("A1");
  titleCell.value =
    metadata.reportTitle ?? "Laporan Pemantauan AI Overview — LinovHR";
  titleCell.font = {
    name: "Segoe UI",
    size: 14,
    bold: true,
    color: { argb: "FF0F172A" },
  };

  const modeLabel =
    metadata.mode === "history"
      ? `Riwayat (${metadata.dateRange?.from ?? "Awal"} s/d ${metadata.dateRange?.to ?? "Sekarang"})`
      : "Cek Terakhir (Latest per Keyword)";

  const subtitleCell = dataSheet.getCell("A2");
  subtitleCell.value = `Diekspor pada: ${formatReadableDateTime(
    metadata.generatedAt ?? new Date().toISOString()
  )} | Cakupan Data: ${modeLabel} | Total Baris: ${rows.length}`;
  subtitleCell.font = {
    name: "Segoe UI",
    size: 9.5,
    italic: true,
    color: { argb: COLOR_MUTED_TEXT },
  };

  // 2. Baris Header Tabel (Baris 4)
  const tableHeaders = [
    "Keyword",
    "Grup Produk",
    "Waktu Pengecekan",
    "Status AI Overview",
    "LinovHR Terdeteksi",
    "Teks Terdeteksi",
    "Pihak Ketiga Terdeteksi",
    "Domain Sumber Sitasi",
    "Domain Kompetitor Tersitasi",
  ];

  const headerRowNumber = 4;
  const headerRow = dataSheet.getRow(headerRowNumber);
  headerRow.height = 26;

  tableHeaders.forEach((headerText, index) => {
    const colNumber = index + 1;
    const cell = headerRow.getCell(colNumber);
    cell.value = headerText;
    cell.font = {
      name: "Segoe UI",
      size: 10,
      bold: true,
      color: { argb: COLOR_HEADER_TEXT },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR_HEADER_BG },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: colNumber === 1 || colNumber === 2 ? "left" : "center",
      wrapText: false,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FF334155" } },
      left: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "medium", color: { argb: "FF0F172A" } },
      right: { style: "thin", color: { argb: "FF334155" } },
    };
  });

  // Pasang AutoFilter pada baris 4 kolom A sampai I
  dataSheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: tableHeaders.length },
  };

  // 3. Masukkan Baris Data (Mulai Baris 5)
  rows.forEach((r, idx) => {
    const rowNumber = headerRowNumber + 1 + idx;
    const dataRow = dataSheet.getRow(rowNumber);
    dataRow.height = 20;

    // A: Keyword
    const c1 = dataRow.getCell(1);
    c1.value = r.keyword;
    c1.alignment = { vertical: "middle", horizontal: "left" };

    // B: Grup
    const c2 = dataRow.getCell(2);
    c2.value = r.group;
    c2.alignment = { vertical: "middle", horizontal: "left" };

    // C: Waktu Pengecekan
    const c3 = dataRow.getCell(3);
    const parsedDate = new Date(r.checked_at);
    if (!Number.isNaN(parsedDate.getTime())) {
      c3.value = parsedDate;
      c3.numFmt = "yyyy-mm-dd hh:mm:ss";
    } else {
      c3.value = r.checked_at;
    }
    c3.alignment = { vertical: "middle", horizontal: "center" };

    // D: Status AI Overview
    const c4 = dataRow.getCell(4);
    c4.value = r.status;
    c4.alignment = { vertical: "middle", horizontal: "center" };

    // E: LinovHR Terdeteksi
    const c5 = dataRow.getCell(5);
    c5.value = r.detected_domain ? "Ya" : "Tidak";
    c5.alignment = { vertical: "middle", horizontal: "center" };
    if (r.detected_domain) {
      c5.font = {
        name: "Segoe UI",
        size: 9.5,
        bold: true,
        color: { argb: COLOR_DETECTED_TEXT },
      };
    }

    // F: Teks Terdeteksi
    const c6 = dataRow.getCell(6);
    c6.value = r.detected_text ? "Ya" : "Tidak";
    c6.alignment = { vertical: "middle", horizontal: "center" };

    // G: Pihak Ketiga
    const c7 = dataRow.getCell(7);
    c7.value = r.detected_third_party ? "Ya" : "Tidak";
    c7.alignment = { vertical: "middle", horizontal: "center" };

    // H: Domain Sumber Sitasi
    const c8 = dataRow.getCell(8);
    c8.value = r.source_domains.join("; ");
    c8.alignment = { vertical: "middle", horizontal: "left" };

    // I: Domain Kompetitor
    const c9 = dataRow.getCell(9);
    c9.value = r.competitor_domains_cited.join("; ");
    c9.alignment = { vertical: "middle", horizontal: "left" };

    // Terapkan border dan font dasar untuk seluruh sel data baris ini
    for (let col = 1; col <= tableHeaders.length; col++) {
      const cell = dataRow.getCell(col);
      cell.border = BORDER_THIN;
      if (!cell.font) {
        cell.font = { name: "Segoe UI", size: 9.5 };
      }
    }
  });

  // 4. Kalkulasi Lebar Kolom Otomatis (Auto-fit)
  dataSheet.columns.forEach((column, colIdx) => {
    let maxLen = 0;
    column.eachCell?.({ includeEmpty: false }, (cell, rowNum) => {
      if (rowNum < headerRowNumber) return; // Abaikan judul sheet
      let strVal = "";
      if (cell.value instanceof Date) {
        strVal = "2026-11-04 00:00:00";
      } else if (cell.value !== null && cell.value !== undefined) {
        strVal = String(cell.value);
      }
      if (strVal.length > maxLen) {
        maxLen = strVal.length;
      }
    });

    const headerLen = tableHeaders[colIdx]?.length ?? 10;
    const calculatedWidth = Math.max(maxLen + 3, headerLen + 4, 12);
    // Batasi lebar kolom agar tidak terlalu lebar (maks 60)
    column.width = Math.min(calculatedWidth, 60);
  });

  // ==========================================
  // SHEET 2: Ringkasan & Metadata
  // ==========================================
  const summarySheet = workbook.addWorksheet("Ringkasan & Metadata");

  // Judul Sheet 2
  const sTitle = summarySheet.getCell("A1");
  sTitle.value = "Ringkasan Statistik & Metadata Ekspor";
  sTitle.font = {
    name: "Segoe UI",
    size: 14,
    bold: true,
    color: { argb: "FF0F172A" },
  };

  // Tabel Parameter Metadata
  summarySheet.getCell("A3").value = "PARAMETER EKSPOR";
  summarySheet.getCell("A3").font = {
    name: "Segoe UI",
    size: 11,
    bold: true,
    color: { argb: "FF0F172A" },
  };

  const metadataPairs: Array<[string, string]> = [
    [
      "Waktu Ekspor",
      formatReadableDateTime(metadata.generatedAt ?? new Date().toISOString()),
    ],
    [
      "Mode Ekspor",
      metadata.mode === "history"
        ? "Seluruh Riwayat (Historical)"
        : "Cek Terakhir per Keyword (Latest)",
    ],
    [
      "Rentang Tanggal",
      metadata.dateRange?.from || metadata.dateRange?.to
        ? `${metadata.dateRange?.from ?? "Awal"} s/d ${metadata.dateRange?.to ?? "Sekarang"}`
        : "Tidak Dibatasi",
    ],
    [
      "Menyertakan Data Demo",
      metadata.includeDemo ? "Ya (Termasuk Demo)" : "Tidak (Hanya Data Asli)",
    ],
  ];

  metadataPairs.forEach(([param, val], idx) => {
    const rowNum = 4 + idx;
    const r = summarySheet.getRow(rowNum);
    r.height = 20;

    const cLabel = r.getCell(1);
    cLabel.value = param;
    cLabel.font = { name: "Segoe UI", size: 9.5, bold: true };
    cLabel.border = BORDER_THIN;
    cLabel.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF8FAFC" },
    };

    const cVal = r.getCell(2);
    cVal.value = val;
    cVal.font = { name: "Segoe UI", size: 9.5 };
    cVal.border = BORDER_THIN;
  });

  // Tabel Statistik Kinerja (KPI Summary)
  const kpiStartRow = 10;
  summarySheet.getCell(`A${kpiStartRow}`).value = "RINGKASAN METRIK KINERJA";
  summarySheet.getCell(`A${kpiStartRow}`).font = {
    name: "Segoe UI",
    size: 11,
    bold: true,
    color: { argb: "FF0F172A" },
  };

  // Header Tabel KPI
  const kpiHeaderRow = summarySheet.getRow(kpiStartRow + 1);
  kpiHeaderRow.height = 24;
  ["Indikator Metrik", "Nilai", "Keterangan"].forEach((hdr, idx) => {
    const cell = kpiHeaderRow.getCell(idx + 1);
    cell.value = hdr;
    cell.font = {
      name: "Segoe UI",
      size: 10,
      bold: true,
      color: { argb: COLOR_HEADER_TEXT },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR_SECTION_BG },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: idx === 1 ? "center" : "left",
    };
    cell.border = BORDER_THIN;
  });

  // Hitung metrik jika tidak disediakan secara eksplisit
  const calculatedTotalRows = rows.length;
  const calculatedDetectedCount = rows.filter((r) => r.detected_domain).length;
  const calculatedAioCount = rows.filter(
    (r) => r.status === "detected" || r.status === "not_detected"
  ).length;
  const calculatedDetectionRate =
    calculatedAioCount > 0 ? calculatedDetectedCount / calculatedAioCount : 0;
  const calculatedAioRate =
    calculatedTotalRows > 0 ? calculatedAioCount / calculatedTotalRows : 0;

  const totalKw = metadata.totalKeywords ?? calculatedTotalRows;
  const detectedKw = metadata.detectedKeywords ?? calculatedDetectedCount;
  const detRate = metadata.detectionRate ?? calculatedDetectionRate;
  const aioCount = metadata.aiOverviewCount ?? calculatedAioCount;
  const aioRate = metadata.aiOverviewRate ?? calculatedAioRate;

  const kpiRows: Array<{
    metric: string;
    value: number;
    format: string;
    desc: string;
  }> = [
    {
      metric: "Total Baris Data",
      value: calculatedTotalRows,
      format: "#,##0",
      desc: "Jumlah rekaman data hasil pengecekan dalam file ini",
    },
    {
      metric: "Total Keyword Terpantau",
      value: totalKw,
      format: "#,##0",
      desc: "Jumlah keyword unik yang dipantau",
    },
    {
      metric: "AI Overview Muncul",
      value: aioCount,
      format: "#,##0",
      desc: "Jumlah keyword yang memicu Google AI Overview",
    },
    {
      metric: "AI Overview Trigger Rate",
      value: aioRate,
      format: "0.0%",
      desc: "Persentase kemunculan AI Overview dari keyword yang dicek",
    },
    {
      metric: "LinovHR Tersitasi (Detected)",
      value: detectedKw,
      format: "#,##0",
      desc: "Jumlah keyword di mana domain/teks LinovHR dikutip",
    },
    {
      metric: "LinovHR Detection Rate",
      value: detRate,
      format: "0.0%",
      desc: "Rasio sitasi LinovHR terhadap AI Overview yang muncul",
    },
  ];

  kpiRows.forEach((item, idx) => {
    const rowNum = kpiStartRow + 2 + idx;
    const r = summarySheet.getRow(rowNum);
    r.height = 20;

    const c1 = r.getCell(1);
    c1.value = item.metric;
    c1.font = { name: "Segoe UI", size: 9.5, bold: true };
    c1.border = BORDER_THIN;

    const c2 = r.getCell(2);
    c2.value = item.value;
    c2.numFmt = item.format;
    c2.font = { name: "Segoe UI", size: 9.5, bold: true };
    c2.alignment = { vertical: "middle", horizontal: "center" };
    c2.border = BORDER_THIN;

    const c3 = r.getCell(3);
    c3.value = item.desc;
    c3.font = { name: "Segoe UI", size: 9.5, color: { argb: COLOR_MUTED_TEXT } };
    c3.border = BORDER_THIN;
  });

  // Atur lebar kolom Sheet 2
  summarySheet.getColumn(1).width = 30;
  summarySheet.getColumn(2).width = 24;
  summarySheet.getColumn(3).width = 50;

  // Tulis workbook ke buffer
  const rawBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(rawBuffer);
}
