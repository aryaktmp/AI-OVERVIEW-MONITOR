import { describe, expect, it } from "vitest";
import {
  buildEightWeekBuckets,
  computeCompetitorDomainRanking,
  computeDashboardAnalytics,
  formatDetectionTypeLabel,
  splitTextByBrandTerms,
  type AnalyticsCheckInput,
  type AnalyticsKeywordInput,
} from "@/lib/analytics";

describe("Fungsi Agregasi Dasbor (lib/analytics.ts)", () => {
  const referenceDate = new Date("2026-10-29T10:00:00.000Z"); // Kamis

  it("membangun 8 rentang minggu dengan urutan kronologis", () => {
    const buckets = buildEightWeekBuckets(referenceDate);
    expect(buckets).toHaveLength(8);
    expect(buckets[7]?.label).toBe("26 Okt");
    expect(buckets[6]?.label).toBe("19 Okt");
    expect(buckets[0]?.startMs).toBeLessThan(buckets[7]!.startMs);
  });

  it("menghitung tingkat deteksi dan selisih mingguan (weekly delta) dengan akurat", () => {
    const buckets = buildEightWeekBuckets(referenceDate);
    const prevWeekIso = new Date(buckets[6]!.startMs + 3600_000).toISOString();
    const currWeekIso = new Date(buckets[7]!.startMs + 3600_000).toISOString();

    const keywords: AnalyticsKeywordInput[] = [
      { id: "kw-1", text: "software hr terbaik", groupName: "Produk HR", active: true },
      { id: "kw-2", text: "aplikasi payroll", groupName: "Produk HR", active: true },
      { id: "kw-3", text: "apa itu hris", groupName: "Panduan HR", active: true },
      { id: "kw-4", text: "keyword nonaktif", groupName: "Umum", active: false },
    ];

    const checks: AnalyticsCheckInput[] = [
      // Minggu lalu (index 6): 2 AI Overview muncul, 1 terdeteksi -> 50%
      {
        id: "chk-prev-1",
        keyword_id: "kw-1",
        run_id: "run-prev",
        checked_at: prevWeekIso,
        status: "detected",
        detected_domain: true,
        detected_text: false,
        detected_third_party: false,
        is_demo: true,
      },
      {
        id: "chk-prev-2",
        keyword_id: "kw-2",
        run_id: "run-prev",
        checked_at: prevWeekIso,
        status: "not_detected",
        detected_domain: false,
        detected_text: false,
        detected_third_party: false,
        is_demo: true,
      },
      // Minggu ini (index 7): 3 AI Overview muncul, 2 terdeteksi -> 67%
      {
        id: "chk-curr-1",
        keyword_id: "kw-1",
        run_id: "run-curr",
        checked_at: currWeekIso,
        status: "detected",
        detected_domain: true,
        detected_text: true,
        detected_third_party: false,
        is_demo: true,
      },
      {
        id: "chk-curr-2",
        keyword_id: "kw-2",
        run_id: "run-curr",
        checked_at: currWeekIso,
        status: "detected",
        detected_domain: false,
        detected_text: true,
        detected_third_party: false,
        is_demo: true,
      },
      {
        id: "chk-curr-3",
        keyword_id: "kw-3",
        run_id: "run-curr",
        checked_at: currWeekIso,
        status: "not_detected",
        detected_domain: false,
        detected_text: false,
        detected_third_party: false,
        is_demo: true,
      },
    ];

    const summary = computeDashboardAnalytics(keywords, checks, referenceDate);

    expect(summary.totalKeywords).toBe(4);
    expect(summary.activeKeywords).toBe(3);
    expect(summary.hasDemoData).toBe(true);

    // Minggu lalu (index 6)
    expect(summary.prevAiOverviewCount).toBe(2);
    expect(summary.prevDetectedCount).toBe(1);
    expect(summary.prevDetectionRate).toBe(50);

    // Minggu ini (index 7)
    expect(summary.currentAiOverviewCount).toBe(3);
    expect(summary.currentDetectedCount).toBe(2);
    expect(summary.currentDetectionRate).toBe(67);

    // Selisih mingguan
    expect(summary.aiOverviewDelta).toBe(1);
    expect(summary.detectedDelta).toBe(1);
    expect(summary.detectionRateDelta).toBe(17);

    // Label jenis deteksi pada kw-1
    const kw1Row = summary.keywordRows.find((r) => r.id === "kw-1");
    expect(kw1Row?.detectionTypeLabel).toBe(
      "Domain dikutip, Nama disebut di teks"
    );
  });

  it("menghitung peringkat domain kompetitor berdasarkan jumlah keyword unik", () => {
    const citations = [
      { keyword_id: "kw-1", domain: "www.talenta.co" },
      { keyword_id: "kw-1", domain: "blog.talenta.co" }, // keyword sama -> tetap dihitung 1 keyword unik
      { keyword_id: "kw-2", domain: "talenta.co" },
      { keyword_id: "kw-3", domain: "talenta.co" },
      { keyword_id: "kw-1", domain: "www.linovhr.com" },
      { keyword_id: "kw-2", domain: "linovhr.com" },
      { keyword_id: "kw-3", domain: "wikipedia.org" },
    ];

    const ranking = computeCompetitorDomainRanking(
      citations,
      "linovhr.com",
      ["talenta.co", "gadjian.com"]
    );

    expect(ranking[0]).toEqual({
      domain: "talenta.co",
      keywordCount: 3,
      percentageOfMax: 100,
      isOwn: false,
      isCompetitor: true,
    });

    expect(ranking[1]).toEqual({
      domain: "linovhr.com",
      keywordCount: 2,
      percentageOfMax: 67,
      isOwn: true,
      isCompetitor: false,
    });

    expect(ranking[2]).toEqual({
      domain: "wikipedia.org",
      keywordCount: 1,
      percentageOfMax: 33,
      isOwn: false,
      isCompetitor: false,
    });

    // Kompetitor tanpa kutipan tetap muncul dengan 0 keyword
    expect(ranking[3]).toEqual({
      domain: "gadjian.com",
      keywordCount: 0,
      percentageOfMax: 0,
      isOwn: false,
      isCompetitor: true,
    });
  });

  it("menandai istilah merek di dalam teks AI Overview", () => {
    const text =
      "Aplikasi HRIS seperti LinovHR dari PT Linov Roket Prestasi membantu HR.";
    const segments = splitTextByBrandTerms(text, [
      { term: "LinovHR", enabled: true },
      { term: "PT Linov Roket Prestasi", enabled: true },
    ]);

    const highlighted = segments.filter((s) => s.highlighted).map((s) => s.text);
    expect(highlighted).toEqual(["LinovHR", "PT Linov Roket Prestasi"]);
  });

  it("memformat label jenis deteksi sesuai bahasa antarmuka", () => {
    expect(
      formatDetectionTypeLabel({
        detected_domain: false,
        detected_text: false,
        detected_third_party: false,
      })
    ).toBe("-");

    expect(
      formatDetectionTypeLabel({
        detected_domain: false,
        detected_text: false,
        detected_third_party: true,
      })
    ).toBe("Disebut di sumber lain");
  });
});
