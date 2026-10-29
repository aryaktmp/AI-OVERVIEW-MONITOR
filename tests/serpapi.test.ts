import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  extractDomainFromUrl,
  fetchKeywordAiOverview,
  parseSerpApiResponse,
  sanitizeSerpApiRaw,
} from "@/lib/serpapi";
import { evaluateAiOverviewDetection } from "@/lib/detect";

function loadFixture(fileName: string): unknown {
  const fullPath = path.join(process.cwd(), "tests", "fixtures", fileName);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
}

describe("Fase 2: Parser & Klien SerpApi dengan Fixture Asli", () => {
  it("mengurai fixture ai-overview-ada.json (memiliki text_blocks dan 11 references)", () => {
    const raw = loadFixture("ai-overview-ada.json");
    const parsed = parseSerpApiResponse(raw);

    expect(parsed.hasAiOverview).toBe(true);
    expect(parsed.pageToken).toBeNull();
    expect(parsed.answerText).toContain(
      "Software HR (Human Resources) dan HRIS (Human Resource Information System) di Indonesia"
    );
    expect(parsed.answerText).toContain(
      "LinovHR: Disesuaikan untuk perusahaan menengah ke atas dengan struktur multi-cabang yang sangat bisa dikustomisasi."
    );
    expect(parsed.sources).toHaveLength(11);
    expect(parsed.sources[0]).toMatchObject({
      position: 0,
      title:
        "HRIS Indonesia – Software HR Terbaik untuk Kelola Karyawan Lebih Praktis",
      url: "https://humanis.id/",
      domain: "humanis.id",
    });
    expect(parsed.sources[7]).toMatchObject({
      position: 7,
      title: "Software HRIS Terbaik di Indonesia | Gadjian",
      url: "https://www.gadjian.com/",
      domain: "www.gadjian.com",
    });

    const evaluation = evaluateAiOverviewDetection(parsed, {
      brandDomain: "linovhr.com",
      competitorDomains: ["gadjian.com", "dataon.com"],
    });
    expect(evaluation.status).toBe("detected");
    expect(evaluation.detected_domain).toBe(false);
    expect(evaluation.detected_text).toBe(true);
    expect(evaluation.detected_third_party).toBe(false);
    expect(evaluation.matched_terms).toContain("LinovHR");
    expect(evaluation.sources[3]?.is_competitor).toBe(true);
    expect(evaluation.sources[7]?.is_competitor).toBe(true);
  });

  it("mengurai fixture ai-overview-tidak-ada.json (tanpa objek ai_overview)", () => {
    const raw = loadFixture("ai-overview-tidak-ada.json");
    const parsed = parseSerpApiResponse(raw);

    expect(parsed.hasAiOverview).toBe(false);
    expect(parsed.answerText).toBe("");
    expect(parsed.sources).toEqual([]);
    expect(parsed.pageToken).toBeNull();

    const evaluation = evaluateAiOverviewDetection(parsed);
    expect(evaluation.status).toBe("no_ai_overview");
    expect(evaluation.detected_domain).toBe(false);
    expect(evaluation.detected_text).toBe(false);
    expect(evaluation.detected_third_party).toBe(false);
  });

  it("mengurai fixture ai-overview-page-token.json (hanya berisi page_token tanpa text_blocks)", () => {
    const raw = loadFixture("ai-overview-page-token.json");
    const parsed = parseSerpApiResponse(raw);

    expect(parsed.hasAiOverview).toBe(false);
    expect(parsed.answerText).toBe("");
    expect(parsed.sources).toEqual([]);
    expect(parsed.pageToken).toBeTypeOf("string");
    expect((parsed.pageToken ?? "").length).toBeGreaterThan(50);
  });

  it("mengurai fixture ai-overview-page-token-followup.json (respons panggilan ke-2 saat AI Overview kosong)", () => {
    const followUpRaw = loadFixture("ai-overview-page-token-followup.json");
    const parsed = parseSerpApiResponse(followUpRaw);

    expect(parsed.hasAiOverview).toBe(false);
    expect(parsed.answerText).toBe("");
    expect(parsed.sources).toEqual([]);
  });

  it("menangani panggilan kedua engine=google_ai_overview yang mengembalikan konten AI Overview", async () => {
    const firstFixture = loadFixture("ai-overview-page-token.json");
    const adaFixture = loadFixture("ai-overview-ada.json") as {
      ai_overview: unknown;
    };

    const mockFetch = vi.fn<typeof fetch>();

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(firstFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ai_overview: adaFixture.ai_overview }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchKeywordAiOverview("succession planning system", {
      apiKey: "fake_test_key",
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.apiCallsCount).toBe(2);
    expect(result.usedFollowUpPageToken).toBe(true);
    expect(result.parsed.hasAiOverview).toBe(true);
    expect(result.parsed.sources).toHaveLength(11);
  });

  it("menangani panggilan kedua dengan fixture asli ai-overview-page-token-followup.json (ai_overview_state: Fully empty)", async () => {
    const firstFixture = loadFixture("ai-overview-page-token.json");
    const secondFixture = loadFixture("ai-overview-page-token-followup.json");
    const mockFetch = vi.fn<typeof fetch>();

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(firstFixture), { status: 200 })
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(secondFixture), { status: 200 })
    );

    const result = await fetchKeywordAiOverview("succession planning system", {
      apiKey: "fake_test_key",
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.apiCallsCount).toBe(2);
    expect(result.usedFollowUpPageToken).toBe(true);
    expect(result.parsed.hasAiOverview).toBe(false);

    const evaluation = evaluateAiOverviewDetection(result.parsed);
    expect(evaluation.status).toBe("no_ai_overview");
  });

  it("menghapus api_key dari objek maupun URL saat sanitizeSerpApiRaw dipanggil", () => {
    const dirty = {
      api_key: "rahasia123",
      search_metadata: {
        google_url: "https://serpapi.com/search.json?q=test&api_key=rahasia123&hl=id",
      },
    };
    const cleaned = sanitizeSerpApiRaw(dirty);
    expect("api_key" in cleaned).toBe(false);
    expect(cleaned.search_metadata.google_url).not.toContain("rahasia123");
    expect(cleaned.search_metadata.google_url).toContain("api_key=[REDACTED]");
  });

  it("mengekstrak domain dengan benar dari URL valid dan menolak URL tidak valid", () => {
    expect(extractDomainFromUrl("https://www.linovhr.com/fitur-payroll")).toBe(
      "www.linovhr.com"
    );
    expect(extractDomainFromUrl("https://linovhr.com")).toBe("linovhr.com");
    expect(extractDomainFromUrl("javascript:alert(1)")).toBe("");
    expect(extractDomainFromUrl("bukan-url")).toBe("");
  });
});
