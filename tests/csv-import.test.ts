import { describe, expect, it } from "vitest";
import {
  MAX_CSV_IMPORT_ROWS,
  parseKeywordCsvPreview,
} from "@/lib/csv-import";

describe("Parser Impor CSV Keyword (lib/csv-import.ts)", () => {
  it("merapikan spasi, melewati header, membuang duplikat (case-insensitive), dan mendeteksi grup baru", () => {
    const csv = [
      "keyword,group",
      "  software   hr   terbaik  ,  Produk HR  ",
      "SOFTWARE HR TERBAIK,Produk HR", // duplikat di dalam file
      "aplikasi payroll indonesia,Produk HR", // sudah ada di database
      "sistem penilaian kinerja,  Manajemen Talenta  ", // keyword baru + grup baru
      "a,Produk HR", // tidak valid (< 2 karakter)
    ].join("\n");

    const preview = parseKeywordCsvPreview(
      csv,
      ["Aplikasi Payroll Indonesia"],
      ["Produk HR"]
    );

    expect(preview.validRows).toEqual([
      {
        lineNumber: 2,
        keyword: "software hr terbaik",
        group: "Produk HR",
      },
      {
        lineNumber: 5,
        keyword: "sistem penilaian kinerja",
        group: "Manajemen Talenta",
      },
    ]);

    expect(preview.duplicateRows).toEqual([
      {
        lineNumber: 3,
        keyword: "SOFTWARE HR TERBAIK",
        group: "Produk HR",
        reason: "Duplicate inside CSV file",
      },
      {
        lineNumber: 4,
        keyword: "aplikasi payroll indonesia",
        group: "Produk HR",
        reason: "Already exists in database",
      },
    ]);

    expect(preview.invalidRows).toHaveLength(1);
    expect(preview.invalidRows[0]?.lineNumber).toBe(6);
    expect(preview.invalidRows[0]?.reason).toContain("at least 2 characters");

    expect(preview.newGroupsToCreate).toEqual(["Manajemen Talenta"]);
  });

  it("membatasi maksimal 500 baris data per impor", () => {
    const rows = ["keyword,group"];
    for (let i = 1; i <= 505; i++) {
      rows.push(`keyword uji nomor ${i},Grup Uji`);
    }

    const preview = parseKeywordCsvPreview(rows.join("\n"), [], []);

    expect(preview.exceededMaxRows).toBe(true);
    expect(preview.validRows).toHaveLength(MAX_CSV_IMPORT_ROWS);
    expect(preview.invalidRows).toHaveLength(5);
    expect(preview.invalidRows[0]?.reason).toContain("500 rows");
  });

  it("mendukung nilai dengan tanda kutip ganda dan menolak baris lebih dari 2 kolom", () => {
    const csv = [
      "keyword,group",
      '"software hr, payroll, dan absensi",Produk HR',
      "keyword salah,Grup A,Kolom Tambahan",
    ].join("\n");

    const preview = parseKeywordCsvPreview(csv, [], []);

    expect(preview.validRows).toEqual([
      {
        lineNumber: 2,
        keyword: "software hr, payroll, dan absensi",
        group: "Produk HR",
      },
    ]);
    expect(preview.invalidRows).toHaveLength(1);
    expect(preview.invalidRows[0]?.reason).toContain("2-column format");
  });
});
