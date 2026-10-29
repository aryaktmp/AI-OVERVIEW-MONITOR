import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CSV_EXPORT_HEADERS,
  escapeCsvCell,
  formatCsvExportDocument,
  formatCsvExportRow,
  sanitizeCsvFormulaCell,
} from "@/lib/csv-export";
import { GET as exportGet } from "@/app/api/export/route";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

describe("Ekspor CSV & Perlindungan Formula Injection (lib/csv-export.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_EMAILS = "admin@linovhr.com";
  });

  it("menghasilkan format CSV sesuai urutan kolom dan memisahkan source_domains dengan titik koma (;)", () => {
    expect(CSV_EXPORT_HEADERS.join(",")).toBe(
      "keyword,group,checked_at,status,detected_domain,detected_text,detected_third_party,source_domains,competitor_domains_cited"
    );

    const doc = formatCsvExportDocument([
      {
        keyword: "software hr terbaik",
        group: "HRIS & Inti",
        checked_at: "2026-10-29T01:00:00.000Z",
        status: "detected",
        detected_domain: true,
        detected_text: true,
        detected_third_party: false,
        source_domains: ["linovhr.com", "gadjian.com", "mekari.com"],
        competitor_domains_cited: ["gadjian.com", "mekari.com"],
      },
    ]);

    const lines = doc.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "keyword,group,checked_at,status,detected_domain,detected_text,detected_third_party,source_domains,competitor_domains_cited"
    );
    expect(lines[1]).toBe(
      "software hr terbaik,HRIS & Inti,2026-10-29T01:00:00.000Z,detected,true,true,false,linovhr.com;gadjian.com;mekari.com,gadjian.com;mekari.com"
    );
  });

  it("melakukan escaping dengan benar untuk sel yang memuat koma, tanda kutip ganda, dan baris baru", () => {
    expect(escapeCsvCell("aplikasi payroll, pajak, dan bpjs")).toBe(
      '"aplikasi payroll, pajak, dan bpjs"'
    );
    expect(escapeCsvCell('istilah "enterprise" hris')).toBe(
      '"istilah ""enterprise"" hris"'
    );
    expect(escapeCsvCell("baris 1\nbaris 2")).toBe('"baris 1\nbaris 2"');

    const rowCsv = formatCsvExportRow({
      keyword: 'aplikasi gaji, "pph 21"',
      group: "Payroll, Pajak & BPJS",
      checked_at: "2026-10-29T01:00:00.000Z",
      status: "not_detected",
      detected_domain: false,
      detected_text: false,
      detected_third_party: false,
      source_domains: ["pajak.go.id"],
      competitor_domains_cited: [],
    });

    expect(rowCsv).toBe(
      '"aplikasi gaji, ""pph 21""","Payroll, Pajak & BPJS",2026-10-29T01:00:00.000Z,not_detected,false,false,false,pajak.go.id,'
    );
  });

  it("memberi awalan tanda kutip tunggal (') pada sel yang diawali '=', '+', '-', atau '@' untuk mencegah formula injection", () => {
    expect(sanitizeCsvFormulaCell("=cmd|' /C calc'!A0")).toBe(
      "'=cmd|' /C calc'!A0"
    );
    expect(sanitizeCsvFormulaCell("+SUM(A1:A10)")).toBe("'+SUM(A1:A10)");
    expect(sanitizeCsvFormulaCell("-2+3+cmd|' /C calc'!A0")).toBe(
      "'-2+3+cmd|' /C calc'!A0"
    );
    expect(sanitizeCsvFormulaCell("@SUM(1+1)*cmd|' /C calc'!A0")).toBe(
      "'@SUM(1+1)*cmd|' /C calc'!A0"
    );
    // Termasuk jika didahului spasi
    expect(sanitizeCsvFormulaCell("  =HYPERLINK(\"http://evil.example\")")).toBe(
      "'  =HYPERLINK(\"http://evil.example\")"
    );

    // Jika formula injection juga mengandung koma atau tanda kutip ganda, tetap di-escape RFC 4180 setelah diberi awalan '
    expect(escapeCsvCell('=HYPERLINK("https://evil.example","Klik")')).toBe(
      '\'"=HYPERLINK(""https://evil.example"",""Klik"")"\''.replace(
        /^'/,
        ""
      ) === "" // pastikan diawali "'=..." di dalam tanda kutip CSV
        ? ""
        : `"'=HYPERLINK(""https://evil.example"",""Klik"")"`
    );
  });

  it("melindungi GET /api/export dengan sesi dan ALLOWED_EMAILS (bukan CRON_SECRET)", async () => {
    process.env.CRON_SECRET = "a".repeat(32);

    // 1. Tanpa sesi login (walaupun mengirim header Authorization Bearer CRON_SECRET) -> tetap 401
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    const reqWithCronHeaderOnly = new Request(
      "http://localhost:3000/api/export?mode=latest",
      {
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      }
    );
    const res401 = await exportGet(reqWithCronHeaderOnly);
    expect(res401.status).toBe(401);

    // 2. Sesi login ada tetapi email tidak masuk ALLOWED_EMAILS -> 403
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u-1", email: "outsider@example.com" } },
      error: null,
    });
    const reqForbidden = new Request(
      "http://localhost:3000/api/export?mode=latest"
    );
    const res403 = await exportGet(reqForbidden);
    expect(res403.status).toBe(403);
  });
});
