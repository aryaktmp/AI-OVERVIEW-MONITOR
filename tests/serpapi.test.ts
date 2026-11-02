import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  extractDomainFromUrl,
  fetchKeywordAiOverview,
  isGoogleDomain,
  normalizeUrl,
  parseSerpApiResponse,
  sanitizeSerpApiRaw,
  unwrapGoogleUrl,
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
      dryRun: false,
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
      dryRun: false,
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

  it("mengurai tautan perantara Google (pengaman defensif: parameter q=, url=, encoded, dan path relatif)", () => {
    // Pengaman defensif: parameter q pada www.google.co.id
    expect(
      unwrapGoogleUrl(
        "https://www.google.co.id/url?q=https://linovhr.com/fitur-payroll&sa=U&ved=2ahUKEwj"
      )
    ).toBe("https://linovhr.com/fitur-payroll");

    // Pengaman defensif: parameter q yang di-URL encode
    expect(
      unwrapGoogleUrl(
        "https://www.google.com/url?q=https%3A%2F%2Ftalenta.co%2Fdemo&sa=U"
      )
    ).toBe("https://talenta.co/demo");

    // Pengaman defensif: parameter url pada google.com
    expect(
      unwrapGoogleUrl(
        "https://www.google.com/url?url=https://www.gadjian.com/fitur"
      )
    ).toBe("https://www.gadjian.com/fitur");

    // Pengaman defensif: path relatif /url?q=...
    expect(
      unwrapGoogleUrl("/url?q=https%3A%2F%2Fdataon.com%2Fhris")
    ).toBe("https://dataon.com/hris");

    // URL langsung non-Google tidak diubah
    expect(unwrapGoogleUrl("https://linovhr.com/blog")).toBe(
      "https://linovhr.com/blog"
    );

    // URL internal Google tanpa redirect tidak diubah
    expect(unwrapGoogleUrl("https://www.google.co.id/search?q=test")).toBe(
      "https://www.google.co.id/search?q=test"
    );
  });

  it("mengidentifikasi domain Google internal dengan isGoogleDomain dan tidak menganggap youtube sebagai Google internal", () => {
    expect(isGoogleDomain("www.google.co.id")).toBe(true);
    expect(isGoogleDomain("google.co.id")).toBe(true);
    expect(isGoogleDomain("www.google.com")).toBe(true);
    expect(isGoogleDomain("google.com")).toBe(true);
    expect(isGoogleDomain("support.google.com")).toBe(true);
    expect(isGoogleDomain("maps.google.co.id")).toBe(true);
    expect(isGoogleDomain("google.co.uk")).toBe(true);

    // Non-Google domains
    expect(isGoogleDomain("youtube.com")).toBe(false);
    expect(isGoogleDomain("www.youtube.com")).toBe(false);
    expect(isGoogleDomain("linovhr.com")).toBe(false);
    expect(isGoogleDomain("notlinovhr.com")).toBe(false);
    expect(isGoogleDomain("google.evilcorp.com")).toBe(false);
  });

  it("menormalkan URL untuk deduplikasi via normalizeUrl", () => {
    expect(normalizeUrl("https://linovhr.com/")).toBe("https://linovhr.com");
    expect(normalizeUrl("HTTPS://WWW.LINOVHR.COM/fitur/")).toBe(
      "https://www.linovhr.com/fitur"
    );
    expect(normalizeUrl("https://example.com/page?b=2&a=1")).toBe(
      "https://example.com/page?a=1&b=2"
    );
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page"
    );
  });

  it("mengurai respons SerpApi dengan tautan perantara, menghapus duplikat, dan menandai is_google_internal", () => {
    const mockRawResponse = {
      ai_overview: {
        text_blocks: [
          {
            type: "paragraph",
            snippet: "Software HR Indonesia membantu administrasi karyawan.",
          },
        ],
        references: [
          // Tautan perantara Google yang mengarah ke linovhr.com
          {
            index: 0,
            title: "Fitur LinovHR",
            link: "https://www.google.co.id/url?q=https://linovhr.com/fitur&sa=U",
          },
          // Duplikat tautan yang sama setelah unwrap dan normalisasi (dengan judul sama, sa berbeda)
          {
            index: 1,
            title: "Fitur LinovHR",
            link: "https://www.google.co.id/url?q=https://linovhr.com/fitur/&sa=OTHER",
          },
          // Tautan perantara Google mengarah ke kompetitor talenta.co
          {
            index: 2,
            title: "Talenta Demo",
            link: "https://www.google.com/url?url=https%3A%2F%2Ftalenta.co%2Fdemo",
          },
          // Tautan internal Google yang tetap Google setelah normalisasi
          {
            index: 3,
            title: "Pencarian Google HR",
            link: "https://www.google.co.id/search?q=hr+software",
          },
          // Tautan domain mirip yang bukan milik sendiri
          {
            index: 4,
            title: "Not LinovHR",
            link: "https://notlinovhr.com/hris",
          },
        ],
      },
    };

    const parsed = parseSerpApiResponse(mockRawResponse);

    expect(parsed.hasAiOverview).toBe(true);
    // 5 referensi, 1 duplikat terhapus -> tersisa 4 sumber unik
    expect(parsed.sources).toHaveLength(4);
    expect(parsed.uniqueSourcesCount).toBe(4);

    // Sumber 0: linovhr.com (tautan perantara terurai)
    expect(parsed.sources[0]).toMatchObject({
      url: "https://linovhr.com/fitur",
      domain: "linovhr.com",
      is_google_internal: false,
    });

    // Sumber 1: talenta.co (tautan perantara terurai)
    expect(parsed.sources[1]).toMatchObject({
      url: "https://talenta.co/demo",
      domain: "talenta.co",
      is_google_internal: false,
    });

    // Sumber 2: Google internal tetap disimpan tetapi ditandai is_google_internal
    expect(parsed.sources[2]).toMatchObject({
      url: "https://www.google.co.id/search?q=hr+software",
      domain: "www.google.co.id",
      is_google_internal: true,
    });

    // Sumber 3: notlinovhr.com
    expect(parsed.sources[3]).toMatchObject({
      url: "https://notlinovhr.com/hris",
      domain: "notlinovhr.com",
      is_google_internal: false,
    });

    // Evaluasi deteksi: linovhr.com terdeteksi, Google internal dikecualikan, notlinovhr.com ditolak
    const evaluation = evaluateAiOverviewDetection(parsed, {
      brandDomain: "linovhr.com",
      competitorDomains: ["talenta.co"],
    });

    expect(evaluation.status).toBe("detected");
    expect(evaluation.detected_domain).toBe(true); // karena ada linovhr.com
    expect(evaluation.sources[0]?.is_own).toBe(true);
    expect(evaluation.sources[1]?.is_competitor).toBe(true);

    // Google internal tidak dianggap is_own maupun is_competitor
    expect(evaluation.sources[2]?.is_google_internal).toBe(true);
    expect(evaluation.sources[2]?.is_own).toBe(false);
    expect(evaluation.sources[2]?.is_competitor).toBe(false);

    // notlinovhr.com bukan is_own
    expect(evaluation.sources[3]?.is_own).toBe(false);
  });

  it("mengurai fixture asli software-hr-terbaik.json dan mendeteksi domain nyata termasuk linovhr.com", () => {
    const raw = loadFixture("software-hr-terbaik.json");
    const parsed = parseSerpApiResponse(raw);

    expect(parsed.hasAiOverview).toBe(true);
    // 7 referensi mentah, 2 YouTube dengan judul berbeda tetap dipertahankan (kunci dedup url+judul) -> 7 sumber
    expect(parsed.sources).toHaveLength(7);
    expect(parsed.sources_total).toBe(7);
    expect(parsed.sources_resolved).toBe(7);
    expect(parsed.link_kind_token).toBe(7);
    expect(parsed.link_kind_direct).toBe(0);
    expect(parsed.link_kind_google_internal).toBe(0);
    expect(parsed.parser_warning).toBeNull();

    // Sumber hasil source_icon & platform media memiliki penanda url_is_origin_only
    for (const s of parsed.sources) {
      expect(s.url_is_origin_only).toBe(true);
    }

    const domains = parsed.sources.map((s) => s.domain);
    // Pastikan TIDAK ADA domain www.google.co.id
    expect(domains).not.toContain("www.google.co.id");
    expect(domains).not.toContain("google.co.id");

    // Pastikan domain nyata terbaca
    expect(domains).toContain("www.talenta.co");
    expect(domains).toContain("jobseeker.software");
    expect(domains).toContain("www.hashmicro.com");
    expect(domains).toContain("jubelio.com");
    expect(domains).toContain("www.linovhr.com");
    expect(domains).toContain("www.youtube.com");

    const evaluation = evaluateAiOverviewDetection(parsed, {
      brandDomain: "linovhr.com",
      competitorDomains: ["talenta.co", "hashmicro.com"],
    });

    expect(evaluation.status).toBe("detected");
    expect(evaluation.detected_domain).toBe(true);
    expect(evaluation.detected_text).toBe(true);
    expect(evaluation.matched_terms).toContain("LinovHR");

    const linovSource = evaluation.sources.find((s) => s.domain === "www.linovhr.com");
    expect(linovSource?.is_own).toBe(true);

    const talentaSource = evaluation.sources.find((s) => s.domain === "www.talenta.co");
    expect(talentaSource?.is_competitor).toBe(true);
  });

  it("mengurai fixture asli cara-hitung-pph-21-karyawan.json dan menghasilkan domain-domain nyata", () => {
    const raw = loadFixture("cara-hitung-pph-21-karyawan.json");
    const parsed = parseSerpApiResponse(raw);

    expect(parsed.hasAiOverview).toBe(true);
    expect(parsed.sources).toHaveLength(12);
    expect(parsed.sources_total).toBe(12);
    expect(parsed.sources_resolved).toBe(11);
    expect(parsed.link_kind_token).toBe(12);
    expect(parsed.link_kind_direct).toBe(0);
    expect(parsed.link_kind_google_internal).toBe(0);
    expect(parsed.parser_warning).toBeNull();

    const domains = new Set(parsed.sources.map((s) => s.domain));
    // Domain unik harus lebih dari 10 domain nyata
    expect(domains.size).toBeGreaterThanOrEqual(10);

    expect(domains.has("ortax.org")).toBe(true);
    expect(domains.has("pegadaian.co.id")).toBe(true);
    expect(domains.has("kalkulator.pajak.go.id")).toBe(true);
    expect(domains.has("klikpajak.id")).toBe(true);
    expect(domains.has("pbtaxand.com")).toBe(true);
    expect(domains.has("www.talenta.co")).toBe(true);
    expect(domains.has("ayopajak.com")).toBe(true);
    expect(domains.has("www.facebook.com")).toBe(true);
    expect(domains.has("djpb.kemenkeu.go.id")).toBe(true);

    // Ref 3 (Kemenkeu Learning Center) yang tetap berdomain Google ditandai is_google_internal
    const internalSource = parsed.sources.find((s) => s.domain === "www.google.co.id");
    expect(internalSource).toBeDefined();
    expect(internalSource?.is_google_internal).toBe(true);

    const evaluation = evaluateAiOverviewDetection(parsed, {
      brandDomain: "linovhr.com",
    });

    // Google internal tidak dianggap is_own
    expect(evaluation.detected_domain).toBe(false);
  });

  it("mengurai fixture asli software-hr-terbaik-A.json (direct links) dengan URL lengkap dan url_is_origin_only=false", () => {
    const raw = loadFixture("software-hr-terbaik-A.json");
    const parsed = parseSerpApiResponse(raw);

    expect(parsed.hasAiOverview).toBe(true);
    expect(parsed.sources).toHaveLength(7);
    expect(parsed.sources_total).toBe(7);
    expect(parsed.sources_resolved).toBe(7);
    expect(parsed.link_kind_direct).toBe(7);
    expect(parsed.link_kind_token).toBe(0);
    expect(parsed.link_kind_google_internal).toBe(0);
    expect(parsed.parser_warning).toBeNull();

    // Semua sumber direct link memiliki url_is_origin_only = false
    for (const s of parsed.sources) {
      expect(s.url_is_origin_only).toBe(false);
    }

    const linovSource = parsed.sources.find((s) => s.domain === "www.linovhr.com");
    expect(linovSource).toBeDefined();
    expect(linovSource?.url).toBe(
      "https://www.linovhr.com/blog/software-hris-manufaktur-sistem-shift/"
    );
    expect(linovSource?.url_is_origin_only).toBe(false);

    const talentaSource = parsed.sources.find((s) => s.domain === "www.talenta.co");
    expect(talentaSource).toBeDefined();
    expect(talentaSource?.url).toBe("https://www.talenta.co/solusi/hris/");

    const evaluation = evaluateAiOverviewDetection(parsed, {
      brandDomain: "linovhr.com",
      competitorDomains: ["talenta.co", "hashmicro.com"],
    });

    expect(evaluation.status).toBe("detected");
    expect(evaluation.detected_domain).toBe(true);
    expect(evaluation.detected_text).toBe(true);
    expect(evaluation.matched_terms).toContain("LinovHR");

    const evalLinov = evaluation.sources.find((s) => s.domain === "www.linovhr.com");
    expect(evalLinov?.is_own).toBe(true);

    const evalTalenta = evaluation.sources.find((s) => s.domain === "www.talenta.co");
    expect(evalTalenta?.is_competitor).toBe(true);
  });

  it("mengurai fixture asli software-hr-terbaik-B.json dan software-hr-terbaik-C.json dengan URL langsung yang konsisten", () => {
    for (const fixtureName of [
      "software-hr-terbaik-B.json",
      "software-hr-terbaik-C.json",
    ]) {
      const raw = loadFixture(fixtureName);
      const parsed = parseSerpApiResponse(raw);

      expect(parsed.hasAiOverview).toBe(true);
      expect(parsed.sources).toHaveLength(7);
      expect(parsed.link_kind_direct).toBe(7);
      expect(parsed.link_kind_token).toBe(0);
      expect(parsed.link_kind_google_internal).toBe(0);

      for (const s of parsed.sources) {
        expect(s.url_is_origin_only).toBe(false);
      }

      const linovSource = parsed.sources.find(
        (s) => s.domain === "www.linovhr.com"
      );
      expect(linovSource?.url).toBe(
        "https://www.linovhr.com/blog/software-hris-manufaktur-sistem-shift/"
      );
    }
  });

  it("mempertahankan dua referensi dengan domain sama jika judulnya berbeda (dedup url + judul), dan menggabungkannya jika judul sama", () => {
    const parsed = parseSerpApiResponse({
      ai_overview: {
        text_blocks: [{ snippet: "Video referensi HR" }],
        references: [
          {
            index: 0,
            title: "Video Tutorial HR 1",
            source: "YouTube",
            link: "https://www.google.co.id/goto?url=CAES1",
          },
          {
            index: 1,
            title: "Video Tutorial HR 2",
            source: "YouTube",
            link: "https://www.google.co.id/goto?url=CAES2",
          },
          {
            index: 2,
            title: "Video Tutorial HR 1", // Duplikat persis URL + judul
            source: "YouTube",
            link: "https://www.google.co.id/goto?url=CAES3",
          },
        ],
      },
    });

    expect(parsed.sources).toHaveLength(2);
    expect(parsed.sources[0]?.title).toBe("Video Tutorial HR 1");
    expect(parsed.sources[1]?.title).toBe("Video Tutorial HR 2");
    expect(parsed.sources[0]?.url_is_origin_only).toBe(true);
  });

  it("tidak menebak nilai source tak dikenal menjadi domain dan menandainya unresolved", () => {
    const parsed = parseSerpApiResponse({
      ai_overview: {
        text_blocks: [{ snippet: "Teks pembahasan tanpa domain" }],
        references: [
          {
            index: 0,
            title: "Portal Berita Tak Dikenal",
            source: "portalberita.co.id", // Bukan di KNOWN_SOURCE_PLATFORMS, tidak boleh ditebak
            link: "https://www.google.co.id/goto?url=CAESxyz",
          },
        ],
      },
    });

    expect(parsed.sources).toHaveLength(1);
    // Link berupa goto tanpa favicon/parameter url berujung pada domain google internal
    expect(parsed.sources[0]?.is_google_internal).toBe(true);

    const evaluation = evaluateAiOverviewDetection(parsed, {
      brandDomain: "linovhr.com",
      competitorDomains: ["portalberita.co.id"],
    });

    // Tidak dianggap competitor meskipun string source cocok nama domain competitor
    expect(evaluation.sources[0]?.is_competitor).toBe(false);
  });

  it("mencatat parser_warning=low_resolution jika resolusi di bawah 80% dari minimal 5 sumber", () => {
    const parsed = parseSerpApiResponse({
      ai_overview: {
        text_blocks: [{ snippet: "Overview dengan semua tautan google internal" }],
        references: [
          { index: 0, title: "Ref 1", link: "https://www.google.co.id/goto?url=1" },
          { index: 1, title: "Ref 2", link: "https://www.google.co.id/goto?url=2" },
          { index: 2, title: "Ref 3", link: "https://www.google.co.id/goto?url=3" },
          { index: 3, title: "Ref 4", link: "https://www.google.co.id/goto?url=4" },
          { index: 4, title: "Ref 5", link: "https://www.google.co.id/goto?url=5" },
        ],
      },
    });

    expect(parsed.sources_total).toBe(5);
    expect(parsed.sources_resolved).toBe(0);
    expect(parsed.parser_warning).toBe("low_resolution");
  });

  it("memastikan deteksi domain menolak notlinovhr.com jika linovhr.com tidak ada", () => {
    const parsedWithOnlyNotLinov = parseSerpApiResponse({
      ai_overview: {
        text_blocks: [{ snippet: "Uji coba tanpa linov" }],
        references: [
          {
            index: 0,
            title: "Bukan Linov",
            link: "https://notlinovhr.com/payroll",
          },
          {
            index: 1,
            title: "Google Search",
            link: "https://www.google.co.id/search?q=payroll",
          },
        ],
      },
    });

    const evalResult = evaluateAiOverviewDetection(parsedWithOnlyNotLinov, {
      brandDomain: "linovhr.com",
    });

    expect(evalResult.detected_domain).toBe(false);
    expect(evalResult.sources[0]?.is_own).toBe(false);
    expect(evalResult.sources[1]?.is_google_internal).toBe(true);
    expect(evalResult.sources[1]?.is_own).toBe(false);
  });
});
