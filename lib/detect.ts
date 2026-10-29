import type { ParsedAiOverview, ParsedAiOverviewSource } from "@/lib/serpapi";

export type CheckStatus = "no_ai_overview" | "not_detected" | "detected";

export interface BrandTermConfig {
  term: string;
  enabled?: boolean;
}

export const DEFAULT_BRAND_TERMS: BrandTermConfig[] = [
  { term: "LinovHR", enabled: true },
  { term: "Linov HR", enabled: true },
  { term: "linovhr.com", enabled: true },
  { term: "Linov", enabled: false },
];

/**
 * Mengekstrak hostname bersih (huruf kecil, tanpa trailing dot) dari URL atau string hostname.
 * Mengembalikan null jika input bukan URL http/https atau hostname valid.
 */
export function extractHostname(urlOrHostname: string): string | null {
  const trimmed = urlOrHostname.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.includes("://")) {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return parsed.hostname.toLowerCase().replace(/\.$/, "");
    }

    // Jika input berupa hostname langsung tanpa skema (misal "www.linovhr.com")
    if (trimmed.includes("/") || trimmed.includes(" ") || trimmed.includes("@")) {
      const parsed = new URL(`https://${trimmed}`);
      return parsed.hostname.toLowerCase().replace(/\.$/, "");
    }

    const parsed = new URL(`https://${trimmed}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/**
 * Mencocokkan apakah URL atau hostname termasuk dalam targetDomain (atau subdomainnya).
 * Contoh untuk targetDomain = "linovhr.com":
 * - "https://linovhr.com/fitur" -> true
 * - "https://www.linovhr.com/blog" -> true
 * - "https://app.linovhr.com" -> true
 * - "https://notlinovhr.com" -> false
 */
export function isMatchingDomain(
  urlOrHostname: string,
  targetDomain: string = process.env.BRAND_DOMAIN ?? "linovhr.com"
): boolean {
  const hostname = extractHostname(urlOrHostname);
  const rawTarget = extractHostname(targetDomain);

  if (!hostname || !rawTarget) {
    return false;
  }

  const normalizedTarget = rawTarget.replace(/^www\./, "");
  return (
    hostname === normalizedTarget ||
    hostname.endsWith(`.${normalizedTarget}`)
  );
}

/**
 * Deteksi Tingkat 1: Memeriksa apakah domain merek (atau subdomainnya) ada di daftar sumber AI Overview.
 */
export function detectDomainCitation(
  sources: Array<Pick<ParsedAiOverviewSource, "url" | "domain">>,
  brandDomain: string = process.env.BRAND_DOMAIN ?? "linovhr.com"
): boolean {
  for (const source of sources) {
    if (source.url && isMatchingDomain(source.url, brandDomain)) {
      return true;
    }
    if (source.domain && isMatchingDomain(source.domain, brandDomain)) {
      return true;
    }
  }
  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Membangun RegExp pencocokan kata utuh (whole-word, case-insensitive) untuk suatu istilah merek.
 */
export function buildBrandTermRegex(term: string): RegExp {
  const trimmed = term.trim();
  const parts = trimmed.split(/\s+/).map(escapeRegex);
  const patternBody = parts.join("\\s+");

  // Jika istilah mengandung titik seperti domain ("linovhr.com"), tolak tanda hubung di sekitarnya (misal "evil-linovhr.com")
  if (trimmed.includes(".")) {
    return new RegExp(`(?<![a-zA-Z0-9-])${patternBody}(?![a-zA-Z0-9-])`, "i");
  }

  return new RegExp(
    `(?<![a-zA-Z0-9]|[a-zA-Z0-9]\\.)` +
      patternBody +
      `(?![a-zA-Z0-9]|\\.[a-zA-Z0-9])`,
    "i"
  );
}

/**
 * Deteksi Tingkat 2: Memeriksa apakah teks jawaban AI Overview memuat salah satu istilah merek aktif
 * sebagai kata utuh (case-insensitive).
 */
export function detectBrandMentionInText(
  text: string,
  brandTerms: Array<string | BrandTermConfig> = DEFAULT_BRAND_TERMS
): { detected: boolean; matchedTerms: string[] } {
  if (!text || !text.trim()) {
    return { detected: false, matchedTerms: [] };
  }

  const activeTerms = brandTerms
    .map((item) =>
      typeof item === "string"
        ? { term: item.trim(), enabled: true }
        : { term: item.term.trim(), enabled: item.enabled !== false }
    )
    .filter((item) => item.enabled && item.term.length > 0);

  const matchedTerms: string[] = [];

  for (const { term } of activeTerms) {
    const regex = buildBrandTermRegex(term);
    if (regex.test(text)) {
      matchedTerms.push(term);
    }
  }

  return {
    detected: matchedTerms.length > 0,
    matchedTerms,
  };
}

export interface AnnotatedCheckSource extends ParsedAiOverviewSource {
  is_own: boolean;
  is_competitor: boolean;
  mentions_brand: boolean;
}

export interface DetectionEvaluation {
  status: CheckStatus;
  detected_domain: boolean;
  detected_text: boolean;
  detected_third_party: boolean;
  matched_terms: string[];
  sources: AnnotatedCheckSource[];
}

export interface EvaluateDetectionOptions {
  brandDomain?: string;
  brandTerms?: Array<string | BrandTermConfig>;
  competitorDomains?: string[];
  detectedThirdParty?: boolean;
  thirdPartyMentionsByUrl?: Record<string, boolean>;
}

/**
 * Menghitung hasil deteksi lengkap (tingkat 1, tingkat 2, dan opsional tingkat 3)
 * beserta status akhir (`no_ai_overview`, `not_detected`, `detected`) dan anotasi sumber.
 */
export function evaluateAiOverviewDetection(
  parsed: ParsedAiOverview,
  options: EvaluateDetectionOptions = {}
): DetectionEvaluation {
  const brandDomain =
    options.brandDomain ?? process.env.BRAND_DOMAIN ?? "linovhr.com";
  const brandTerms = options.brandTerms ?? DEFAULT_BRAND_TERMS;
  const competitorDomains = options.competitorDomains ?? [];
  const thirdPartyMap = options.thirdPartyMentionsByUrl ?? {};

  if (!parsed.hasAiOverview) {
    return {
      status: "no_ai_overview",
      detected_domain: false,
      detected_text: false,
      detected_third_party: false,
      matched_terms: [],
      sources: [],
    };
  }

  const detected_domain = detectDomainCitation(parsed.sources, brandDomain);
  const textResult = detectBrandMentionInText(parsed.answerText, brandTerms);
  const detected_text = textResult.detected;

  const annotatedSources: AnnotatedCheckSource[] = parsed.sources.map(
    (source) => {
      const is_own =
        isMatchingDomain(source.url, brandDomain) ||
        isMatchingDomain(source.domain, brandDomain);
      const is_competitor =
        !is_own &&
        competitorDomains.some(
          (compDomain) =>
            isMatchingDomain(source.url, compDomain) ||
            isMatchingDomain(source.domain, compDomain)
        );
      const mentions_brand = is_own
        ? true
        : Boolean(thirdPartyMap[source.url]);

      return {
        ...source,
        is_own,
        is_competitor,
        mentions_brand,
      };
    }
  );

  const detected_third_party =
    options.detectedThirdParty ??
    annotatedSources.some((s) => !s.is_own && s.mentions_brand);

  const status: CheckStatus =
    detected_domain || detected_text || detected_third_party
      ? "detected"
      : "not_detected";

  return {
    status,
    detected_domain,
    detected_text,
    detected_third_party,
    matched_terms: textResult.matchedTerms,
    sources: annotatedSources,
  };
}
