import { describe, it, expect } from "vitest";
import {
  DEFAULT_BRAND_TERMS,
  detectBrandMentionInText,
  detectDomainCitation,
  evaluateAiOverviewDetection,
  isMatchingDomain,
} from "@/lib/detect";
import type { ParsedAiOverview } from "@/lib/serpapi";

describe("Fase 2: Deteksi Tingkat 1 (Domain) & Tingkat 2 (Teks)", () => {
  describe("Pencocokan Domain (Hostname)", () => {
    it("mencocokkan domain utama linovhr.com dan subdomainnya (www.linovhr.com, blog.linovhr.com)", () => {
      expect(isMatchingDomain("https://linovhr.com", "linovhr.com")).toBe(true);
      expect(
        isMatchingDomain("https://www.linovhr.com/software-payroll/", "linovhr.com")
      ).toBe(true);
      expect(
        isMatchingDomain("https://blog.linovhr.com/artikel-hris", "linovhr.com")
      ).toBe(true);
      expect(isMatchingDomain("www.linovhr.com", "linovhr.com")).toBe(true);
    });

    it("menolak domain mirip yang bukan milik sendiri (notlinovhr.com, linovhr.com.evil.id)", () => {
      expect(isMatchingDomain("https://notlinovhr.com", "linovhr.com")).toBe(
        false
      );
      expect(
        isMatchingDomain("https://www.notlinovhr.com/hris", "linovhr.com")
      ).toBe(false);
      expect(
        isMatchingDomain("https://linovhr.com.evil.id/login", "linovhr.com")
      ).toBe(false);
      expect(
        isMatchingDomain("https://competitor.com/?ref=linovhr.com", "linovhr.com")
      ).toBe(false);
    });

    it("mendeteksi kutipan domain pada daftar sumber AI Overview", () => {
      expect(
        detectDomainCitation(
          [
            { url: "https://www.gadjian.com/", domain: "www.gadjian.com" },
            {
              url: "https://www.linovhr.com/fitur/",
              domain: "www.linovhr.com",
            },
          ],
          "linovhr.com"
        )
      ).toBe(true);

      expect(
        detectDomainCitation(
          [
            {
              url: "https://notlinovhr.com/artikel",
              domain: "notlinovhr.com",
            },
          ],
          "linovhr.com"
        )
      ).toBe(false);
    });
  });

  describe("Pencocokan Nama Merek di Teks (Kata Utuh & Case-Insensitive)", () => {
    it("mendeteksi LinovHR, Linov HR, dan linovhr.com tanpa membedakan huruf besar/kecil", () => {
      expect(
        detectBrandMentionInText("Salah satu aplikasi terbaik adalah linovhr.")
      ).toEqual({
        detected: true,
        matchedTerms: ["LinovHR"],
      });

      expect(
        detectBrandMentionInText(
          "Perusahaan menggunakan LINOV HR untuk mengelola PPh 21."
        )
      ).toEqual({
        detected: true,
        matchedTerms: ["Linov HR"],
      });

      expect(
        detectBrandMentionInText("Kunjungi situs resmi di linovhr.com sekarang.")
      ).toEqual({
        detected: true,
        matchedTerms: ["linovhr.com"],
      });
    });

    it("tidak mencocokkan potongan kata atau istilah Linov sendirian secara bawaan", () => {
      expect(
        detectBrandMentionInText(
          "Istilah Linov saja secara bawaan dimatikan agar tidak memicu positif palsu.",
          DEFAULT_BRAND_TERMS
        ).detected
      ).toBe(false);

      expect(
        detectBrandMentionInText("Domain notlinovhr.com atau kata superlinovhrx.")
          .detected
      ).toBe(false);
    });

    it("mengizinkan deteksi Linov jika opsi tersebut diaktifkan oleh admin", () => {
      const customTerms = [
        ...DEFAULT_BRAND_TERMS.filter((t) => t.term !== "Linov"),
        { term: "Linov", enabled: true },
      ];
      const res = detectBrandMentionInText(
        "Platform Linov membantu proses HRD.",
        customTerms
      );
      expect(res.detected).toBe(true);
      expect(res.matchedTerms).toContain("Linov");
    });
  });

  describe("Evaluasi Status Akhir & Flag Terpisah", () => {
    it("menghasilkan status no_ai_overview jika AI Overview tidak muncul", () => {
      const parsed: ParsedAiOverview = {
        hasAiOverview: false,
        answerText: "",
        sources: [],
        pageToken: null,
      };

      const res = evaluateAiOverviewDetection(parsed);
      expect(res.status).toBe("no_ai_overview");
      expect(res.detected_domain).toBe(false);
      expect(res.detected_text).toBe(false);
      expect(res.detected_third_party).toBe(false);
    });

    it("menghasilkan status not_detected jika AI Overview muncul namun semua tingkat negatif", () => {
      const parsed: ParsedAiOverview = {
        hasAiOverview: true,
        answerText: "Berikut daftar aplikasi HRIS di Indonesia: A, B, dan C.",
        sources: [
          {
            position: 0,
            title: "Artikel HR",
            url: "https://notlinovhr.com/review",
            domain: "notlinovhr.com",
          },
        ],
        pageToken: null,
      };

      const res = evaluateAiOverviewDetection(parsed);
      expect(res.status).toBe("not_detected");
      expect(res.detected_domain).toBe(false);
      expect(res.detected_text).toBe(false);
      expect(res.detected_third_party).toBe(false);
    });

    it("menyimpan flag detected_domain dan detected_text secara terpisah ketika positif", () => {
      const parsed: ParsedAiOverview = {
        hasAiOverview: true,
        answerText: "Rekomendasi sistem payroll: LinovHR untuk perusahaan.",
        sources: [
          {
            position: 0,
            title: "LinovHR Payroll",
            url: "https://www.linovhr.com/payroll",
            domain: "www.linovhr.com",
          },
        ],
        pageToken: null,
      };

      const res = evaluateAiOverviewDetection(parsed);
      expect(res.status).toBe("detected");
      expect(res.detected_domain).toBe(true);
      expect(res.detected_text).toBe(true);
      expect(res.detected_third_party).toBe(false);
      expect(res.sources[0]?.is_own).toBe(true);
    });
  });
});
