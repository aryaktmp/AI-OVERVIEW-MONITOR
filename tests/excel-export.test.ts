import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  generateExcelExportBuffer,
  type ExcelExportRow,
  type ExcelExportMetadata,
} from "@/lib/excel-export";

describe("Excel Export Engine (lib/excel-export.ts)", () => {
  const sampleRows: ExcelExportRow[] = [
    {
      keyword: "software hr terbaik indonesia",
      group: "HRIS & Inti",
      checked_at: "2026-11-04T01:30:00.000Z",
      status: "detected",
      detected_domain: true,
      detected_text: true,
      detected_third_party: false,
      source_domains: ["linovhr.com", "mekari.com"],
      competitor_domains_cited: ["mekari.com"],
    },
    {
      keyword: "aplikasi payroll online",
      group: "Payroll, Pajak & BPJS",
      checked_at: "2026-11-04T01:35:00.000Z",
      status: "not_detected",
      detected_domain: false,
      detected_text: false,
      detected_third_party: false,
      source_domains: ["gadjian.com"],
      competitor_domains_cited: ["gadjian.com"],
    },
  ];

  const sampleMetadata: ExcelExportMetadata = {
    reportTitle: "Laporan Pemantauan AI Overview — LinovHR",
    generatedAt: "2026-11-04T02:00:00.000Z",
    mode: "latest",
    totalKeywords: 2,
    detectedKeywords: 1,
    detectionRate: 0.5,
    aiOverviewCount: 2,
    aiOverviewRate: 1.0,
  };

  it("menghasilkan buffer XLSX yang valid dengan signature zip OpenXML (PK)", async () => {
    const buffer = await generateExcelExportBuffer(sampleRows, sampleMetadata);

    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(1000);
    // Verifikasi magic bytes XLSX / ZIP: 0x50 0x4B 0x03 0x04 ("PK..")
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("membuat 2 sheet: Data Pantauan dan Ringkasan & Metadata", async () => {
    const buffer = await generateExcelExportBuffer(sampleRows, sampleMetadata);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]
    );

    const sheetNames = wb.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain("Data Pantauan");
    expect(sheetNames).toContain("Ringkasan & Metadata");
  });

  it("menerapkan header styling, freeze panes, dan auto-filter pada Sheet 1 (Data Pantauan)", async () => {
    const buffer = await generateExcelExportBuffer(sampleRows, sampleMetadata);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]
    );

    const dataSheet = wb.getWorksheet("Data Pantauan");
    expect(dataSheet).toBeDefined();

    // Verifikasi Freeze Panes
    const views = dataSheet!.views;
    expect(views).toBeDefined();
    expect(views.length).toBeGreaterThan(0);
    const frozenView = views[0] as Partial<ExcelJS.WorksheetViewFrozen>;
    expect(frozenView.ySplit).toBe(4);

    // Verifikasi AutoFilter
    expect(dataSheet!.autoFilter).toBeDefined();

    // Verifikasi Baris 4 (Header)
    const headerRow = dataSheet!.getRow(4);
    expect(headerRow.getCell(1).value).toBe("Keyword");
    expect(headerRow.getCell(2).value).toBe("Grup Produk");
    expect(headerRow.getCell(3).value).toBe("Waktu Pengecekan");
    expect(headerRow.getCell(4).value).toBe("Status AI Overview");
    expect(headerRow.getCell(5).value).toBe("LinovHR Terdeteksi");
    expect(headerRow.getCell(8).value).toBe("Domain Sumber Sitasi");

    // Verifikasi Header Fill & Font
    const headerCell = headerRow.getCell(1);
    expect(headerCell.font?.bold).toBe(true);
    expect(headerCell.fill?.type).toBe("pattern");
  });

  it("mengisi data baris dengan format tanggal, boolean ramah baca, dan border", async () => {
    const buffer = await generateExcelExportBuffer(sampleRows, sampleMetadata);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]
    );

    const dataSheet = wb.getWorksheet("Data Pantauan");
    expect(dataSheet).toBeDefined();

    // Baris 5: Data pertama (software hr terbaik indonesia)
    const row1 = dataSheet!.getRow(5);
    expect(row1.getCell(1).value).toBe("software hr terbaik indonesia");
    expect(row1.getCell(2).value).toBe("HRIS & Inti");
    expect(row1.getCell(3).value).toBeInstanceOf(Date);
    expect(row1.getCell(3).numFmt).toBe("yyyy-mm-dd hh:mm:ss");
    expect(row1.getCell(4).value).toBe("detected");
    expect(row1.getCell(5).value).toBe("Ya");
    expect(row1.getCell(8).value).toBe("linovhr.com; mekari.com");
    expect(row1.getCell(9).value).toBe("mekari.com");

    // Verifikasi sel memiliki border
    expect(row1.getCell(1).border?.top).toBeDefined();
    expect(row1.getCell(1).border?.bottom).toBeDefined();

    // Baris 6: Data kedua (aplikasi payroll online)
    const row2 = dataSheet!.getRow(6);
    expect(row2.getCell(1).value).toBe("aplikasi payroll online");
    expect(row2.getCell(5).value).toBe("Tidak");
  });

  it("mengisi Sheet 2 (Ringkasan & Metadata) dengan parameter dan ringkasan metrik KPI", async () => {
    const buffer = await generateExcelExportBuffer(sampleRows, sampleMetadata);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]
    );

    const summarySheet = wb.getWorksheet("Ringkasan & Metadata");
    expect(summarySheet).toBeDefined();

    // Judul Ringkasan
    expect(summarySheet!.getCell("A1").value).toBe(
      "Ringkasan Statistik & Metadata Ekspor"
    );

    // Verifikasi parameter ekspor
    expect(summarySheet!.getCell("A3").value).toBe("PARAMETER EKSPOR");
    expect(summarySheet!.getCell("A4").value).toBe("Waktu Ekspor");
    expect(summarySheet!.getCell("A5").value).toBe("Mode Ekspor");

    // Verifikasi metrik KPI
    expect(summarySheet!.getCell("A10").value).toBe("RINGKASAN METRIK KINERJA");
  });
});
