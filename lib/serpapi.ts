import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isDryRun } from "./dry-run";

export const serpApiSearchParamsSchema = z.object({
  keyword: z.string().trim().min(1, "Keyword tidak boleh kosong"),
  googleDomain: z.string().default("google.co.id"),
  gl: z.string().default("id"),
  hl: z.string().default("id"),
  location: z.string().default("Indonesia"),
});

export type SerpApiSearchParams = z.infer<typeof serpApiSearchParamsSchema>;

export interface ParsedAiOverviewSource {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  sourceName?: string;
  is_google_internal?: boolean;
}

export interface ParsedAiOverview {
  hasAiOverview: boolean;
  answerText: string;
  sources: ParsedAiOverviewSource[];
  pageToken: string | null;
  uniqueSourcesCount?: number;
}

export interface SerpApiTextBlock {
  type?: string;
  title?: string;
  snippet?: string;
  list?: SerpApiListItem[];
  text_blocks?: SerpApiTextBlock[];
  table?: string[][];
}

export interface SerpApiListItem {
  title?: string;
  snippet?: string;
  list?: SerpApiListItem[];
  text_blocks?: SerpApiTextBlock[];
}

export interface SerpApiReference {
  index?: number;
  title?: string;
  link?: string;
  snippet?: string;
  source?: string;
  source_icon?: string;
  thumbnail?: string;
}

export interface SerpApiAiOverviewRaw {
  page_token?: string;
  serpapi_link?: string;
  text_blocks?: SerpApiTextBlock[];
  references?: SerpApiReference[];
  error?: string;
}

export interface SerpApiRawResponse {
  search_metadata?: Record<string, unknown>;
  search_parameters?: Record<string, unknown>;
  ai_overview?: SerpApiAiOverviewRaw;
  text_blocks?: SerpApiTextBlock[];
  references?: SerpApiReference[];
  error?: string;
  serpapi_calls_count?: number;
  dry_run?: boolean;
  [key: string]: unknown;
}

/**
 * Menghapus properti api_key dan parameter query api_key=... secara rekursif
 * dari objek respons mentah SerpApi, serta menyamarkan string nilai api_key jika muncul di teks.
 */
export function sanitizeSerpApiRaw<T>(input: T): T {
  const secretKey = typeof process !== "undefined" ? process.env?.SERPAPI_KEY : undefined;

  function clean(val: unknown): unknown {
    if (typeof val === "string") {
      let str = val.replace(
        /([?&])api_key=[^&\s"']+/gi,
        "$1api_key=[REDACTED]"
      );
      if (secretKey && secretKey.length >= 8) {
        str = str.split(secretKey).join("[REDACTED]");
      }
      return str;
    }
    if (Array.isArray(val)) {
      return val.map(clean);
    }
    if (val && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (k.toLowerCase() === "api_key" || k.toLowerCase() === "apikey") {
          continue;
        }
        out[k] = clean(v);
      }
      return out;
    }
    return val;
  }

  return clean(input) as T;
}

/**
 * Mengekstrak hostname huruf kecil dari URL.
 * Mengembalikan string kosong jika URL tidak valid.
 */
export function extractDomainFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Memeriksa apakah domain atau URL merupakan domain milik Google
 * (misal google.co.id, www.google.com, support.google.com, maps.google.com).
 * Layanan pihak ketiga/terpisah seperti youtube.com tidak dianggap sebagai domain internal Google.
 */
export function isGoogleDomain(hostnameOrUrl: string): boolean {
  if (!hostnameOrUrl || typeof hostnameOrUrl !== "string") return false;
  let hostname = extractDomainFromUrl(
    hostnameOrUrl.includes("://") ? hostnameOrUrl : `https://${hostnameOrUrl}`
  );
  if (!hostname) {
    hostname = hostnameOrUrl.toLowerCase().trim().replace(/^www\./, "");
  }
  if (!hostname) return false;

  const parts = hostname.toLowerCase().split(".");
  const googleIdx = parts.lastIndexOf("google");
  if (googleIdx === -1) return false;

  // Bagian setelah kata 'google' hanya boleh berupa ccTLD/gTLD (misal: ['com'], ['co', 'id'], ['de'])
  const afterGoogle = parts.slice(googleIdx + 1);
  if (afterGoogle.length === 0 || afterGoogle.length > 2) return false;

  if (afterGoogle.length === 2) {
    const [sub, cc] = afterGoogle;
    if (cc.length !== 2) return false;
    if (!["co", "com", "org", "net", "edu", "gov", "gen", "ac"].includes(sub)) {
      return false;
    }
  } else if (afterGoogle.length === 1) {
    const [tld] = afterGoogle;
    if (tld.length < 2) return false;
  }
  return true;
}

/**
 * Mengurai tautan perantara Google (Google redirect / intermediary link)
 * seperti google.co.id/url?q=... atau google.com/url?url=...
 * untuk mengekstrak URL tujuan akhir yang sebenarnya.
 */
export function unwrapGoogleUrl(rawUrl: string, maxDepth: number = 3): string {
  if (!rawUrl || typeof rawUrl !== "string" || maxDepth <= 0) return rawUrl || "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  try {
    // Gunakan base https://www.google.co.id jika URL berupa path relatif seperti /url?q=...
    const parsed = new URL(trimmed, "https://www.google.co.id");
    const isGoogle = isGoogleDomain(parsed.hostname);
    const isUrlPath = parsed.pathname === "/url" || parsed.pathname === "/url/";

    if (isGoogle || isUrlPath) {
      const candidateParam =
        parsed.searchParams.get("q") ||
        parsed.searchParams.get("url") ||
        parsed.searchParams.get("dest");

      if (candidateParam) {
        let decoded = candidateParam.trim();
        if (/^https?%3A/i.test(decoded)) {
          try {
            decoded = decodeURIComponent(decoded);
          } catch {
            // Abaikan jika gagal mendecode
          }
        }
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          return unwrapGoogleUrl(decoded, maxDepth - 1);
        }
      }
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Menormalkan URL untuk perbandingan dan deduplikasi:
 * - Huruf kecil pada protokol dan hostname
 * - Menghapus trailing slash pada path
 * - Mengurutkan parameter query secara konsisten
 * - Mengabaikan fragment (#anchor)
 */
export function normalizeUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    let pathname = parsed.pathname;

    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    } else if (pathname === "/") {
      pathname = "";
    }

    parsed.searchParams.sort();
    const search = parsed.searchParams.toString();
    const query = search ? `?${search}` : "";

    return `${protocol}//${hostname}${pathname}${query}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

const KNOWN_SOURCE_PLATFORMS: Record<string, string> = {
  youtube: "https://www.youtube.com",
  instagram: "https://www.instagram.com",
  facebook: "https://www.facebook.com",
  tiktok: "https://www.tiktok.com",
  linkedin: "https://www.linkedin.com",
  twitter: "https://twitter.com",
  x: "https://x.com",
};

/**
 * Memilih URL terbaik dari field referensi SerpApi.
 *
 * Jalur yang dievaluasi berurutan:
 * 1. Direct link candidates (ref.link, ref.url, ref.destination_url, ref.target_url) setelah di-unwrap
 *    dari perantara Google (pengaman defensif untuk format /url?q=...). Jika non-Google, langsung dipakai.
 * 2. Parameter `url` pada `ref.source_icon`: Pada Google SERP desktop terbaru, tautan AI Overview
 *    dibungkus token goto (/goto?url=CAES...), namun URL tujuan sebenarnya tersedia di parameter `url`
 *    pada favicon proxy Google (https://encrypted-tbn*.gstatic.com/faviconV2?url=https://...).
 * 3. Nama platform atau domain pada `ref.source`: Jika source merupakan platform media (YouTube, Instagram, Facebook)
 *    atau berformat domain (misal "humanis.id").
 * 4. Fallback ke ref.link (tetap disimpan dan ditandai is_google_internal jika tetap domain Google).
 */
export function resolveReferenceUrl(ref: SerpApiReference): {
  url: string;
  chosenField: string;
} {
  const record = ref as Record<string, unknown>;

  // 1. Cek direct link (dan unwrap jika tautan perantara Google /url?q=...)
  const candidates: Array<{ field: string; val?: unknown }> = [
    { field: "link", val: ref.link },
    { field: "url", val: record.url },
    { field: "destination_url", val: record.destination_url },
    { field: "target_url", val: record.target_url },
  ];

  for (const cand of candidates) {
    if (typeof cand.val === "string" && cand.val.trim()) {
      const unwrapped = unwrapGoogleUrl(cand.val.trim());
      const domain = extractDomainFromUrl(unwrapped);
      if (domain && !isGoogleDomain(domain)) {
        return { url: unwrapped, chosenField: cand.field };
      }
    }
  }

  // 2. Cek source_icon (parameter url pada Google FaviconV2 proxy)
  if (typeof ref.source_icon === "string" && ref.source_icon.trim()) {
    try {
      const iconUrl = new URL(ref.source_icon.trim());
      const targetFromIcon =
        iconUrl.searchParams.get("url") || iconUrl.searchParams.get("q");
      if (
        targetFromIcon &&
        (targetFromIcon.startsWith("http://") ||
          targetFromIcon.startsWith("https://"))
      ) {
        const domain = extractDomainFromUrl(targetFromIcon);
        if (domain && !isGoogleDomain(domain)) {
          return { url: targetFromIcon, chosenField: "source_icon.url" };
        }
      }
    } catch {
      // Abaikan jika bukan URL valid
    }
  }

  // 3. Cek source jika merupakan domain atau platform populer
  if (typeof ref.source === "string" && ref.source.trim()) {
    const src = ref.source.trim();
    const srcLower = src.toLowerCase();

    if (KNOWN_SOURCE_PLATFORMS[srcLower]) {
      return {
        url: KNOWN_SOURCE_PLATFORMS[srcLower],
        chosenField: "source.platform",
      };
    }

    if (srcLower.includes(".") && !srcLower.includes(" ")) {
      const targetDomain = `https://${srcLower}`;
      const domain = extractDomainFromUrl(targetDomain);
      if (domain && !isGoogleDomain(domain)) {
        return { url: `https://${domain}`, chosenField: "source.domain" };
      }
    }
  }

  // 4. Fallback ke ref.link (atau url alternatif) yang ada
  const fallbackVal =
    (typeof ref.link === "string" && ref.link.trim()) ||
    (typeof record.url === "string" && (record.url as string).trim()) ||
    "";

  return { url: fallbackVal, chosenField: "link.fallback" };
}

function collectTextFromListItems(items: SerpApiListItem[], out: string[]): void {
  for (const item of items) {
    if (typeof item.title === "string" && item.title.trim()) {
      out.push(item.title.trim());
    }
    if (typeof item.snippet === "string" && item.snippet.trim()) {
      out.push(item.snippet.trim());
    }
    if (Array.isArray(item.text_blocks)) {
      collectTextFromBlocks(item.text_blocks, out);
    }
    if (Array.isArray(item.list)) {
      collectTextFromListItems(item.list, out);
    }
  }
}

function collectTextFromBlocks(blocks: SerpApiTextBlock[], out: string[]): void {
  for (const block of blocks) {
    if (typeof block.title === "string" && block.title.trim()) {
      out.push(block.title.trim());
    }
    if (typeof block.snippet === "string" && block.snippet.trim()) {
      out.push(block.snippet.trim());
    }
    if (Array.isArray(block.list)) {
      collectTextFromListItems(block.list, out);
    }
    if (Array.isArray(block.text_blocks)) {
      collectTextFromBlocks(block.text_blocks, out);
    }
    if (Array.isArray(block.table)) {
      for (const row of block.table) {
        if (Array.isArray(row)) {
          const line = row
            .filter(
              (cell): cell is string =>
                typeof cell === "string" && cell.trim().length > 0
            )
            .join(" | ");
          if (line) out.push(line);
        }
      }
    }
  }
}

/**
 * Mengurai respons JSON mentah dari SerpApi (baik dari engine=google maupun engine=google_ai_overview)
 * menjadi struktur standar: keberadaan AI Overview, teks jawaban, daftar sumber, dan pageToken.
 */
export function parseSerpApiResponse(raw: unknown): ParsedAiOverview {
  if (!raw || typeof raw !== "object") {
    return {
      hasAiOverview: false,
      answerText: "",
      sources: [],
      pageToken: null,
    };
  }

  const data = raw as SerpApiRawResponse;

  // Tangani respons langsung dari engine=google_ai_overview maupun objek bersarang ai_overview dari engine=google
  const aiOverview: SerpApiAiOverviewRaw | undefined =
    data.ai_overview && typeof data.ai_overview === "object"
      ? data.ai_overview
      : Array.isArray(data.text_blocks) || Array.isArray(data.references)
        ? {
            text_blocks: data.text_blocks,
            references: data.references,
          }
        : undefined;

  if (!aiOverview || aiOverview.error) {
    return {
      hasAiOverview: false,
      answerText: "",
      sources: [],
      pageToken: null,
    };
  }

  const pageToken =
    typeof aiOverview.page_token === "string" && aiOverview.page_token.trim()
      ? aiOverview.page_token.trim()
      : null;

  const textSegments: string[] = [];
  if (Array.isArray(aiOverview.text_blocks)) {
    collectTextFromBlocks(aiOverview.text_blocks, textSegments);
  }
  const answerText = textSegments.join("\n");

  const sources: ParsedAiOverviewSource[] = [];
  const seenNormalizedUrls = new Set<string>();

  if (Array.isArray(aiOverview.references)) {
    aiOverview.references.forEach((ref, idx) => {
      if (!ref || typeof ref !== "object") return;
      const { url: resolvedUrl } = resolveReferenceUrl(ref);
      if (!resolvedUrl) return;

      const domain = extractDomainFromUrl(resolvedUrl);
      if (!domain) return;

      const normUrl = normalizeUrl(resolvedUrl);
      if (normUrl) {
        if (seenNormalizedUrls.has(normUrl)) {
          // Hapus duplikat berdasarkan URL ternormalisasi
          return;
        }
        seenNormalizedUrls.add(normUrl);
      }

      const is_google_internal = isGoogleDomain(domain);

      sources.push({
        position: typeof ref.index === "number" ? ref.index : idx,
        title: typeof ref.title === "string" ? ref.title.trim() : "",
        url: resolvedUrl,
        domain,
        snippet: typeof ref.snippet === "string" ? ref.snippet.trim() : undefined,
        sourceName: typeof ref.source === "string" ? ref.source.trim() : undefined,
        is_google_internal,
      });
    });
  }

  // Jika hanya ada page_token tanpa text_blocks dan tanpa references, konten AI Overview belum dimuat
  const hasAiOverview = textSegments.length > 0 || sources.length > 0;

  return {
    hasAiOverview,
    answerText,
    sources,
    pageToken,
    uniqueSourcesCount: sources.length,
  };
}

export interface SerpApiClientOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  dryRun?: boolean;
}

export interface SerpApiCheckResult {
  parsed: ParsedAiOverview;
  raw: SerpApiRawResponse;
  firstRaw: SerpApiRawResponse;
  secondRaw: SerpApiRawResponse | null;
  usedFollowUpPageToken: boolean;
  apiCallsCount: number;
}

function hashKeyword(keyword: string): number {
  let h = 0;
  for (let i = 0; i < keyword.length; i++) {
    h = (h * 31 + keyword.charCodeAt(i)) >>> 0;
  }
  return h;
}

function loadFixtureJson(fileName: string): SerpApiRawResponse {
  const filePath = path.join(process.cwd(), "tests", "fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SerpApiRawResponse;
}

function simulateDryRunKeyword(keyword: string): SerpApiCheckResult {
  const bucket = hashKeyword(keyword.toLowerCase()) % 3;

  if (bucket === 0) {
    const firstRaw = sanitizeSerpApiRaw({
      ...loadFixtureJson("ai-overview-ada.json"),
      dry_run: true,
      serpapi_calls_count: 1,
    });
    return {
      parsed: parseSerpApiResponse(firstRaw),
      raw: firstRaw,
      firstRaw,
      secondRaw: null,
      usedFollowUpPageToken: false,
      apiCallsCount: 1,
    };
  }

  if (bucket === 1) {
    const firstRaw = sanitizeSerpApiRaw({
      ...loadFixtureJson("ai-overview-tidak-ada.json"),
      dry_run: true,
      serpapi_calls_count: 1,
    });
    return {
      parsed: parseSerpApiResponse(firstRaw),
      raw: firstRaw,
      firstRaw,
      secondRaw: null,
      usedFollowUpPageToken: false,
      apiCallsCount: 1,
    };
  }

  // Bucket 2: simulasi kasus page_token (2 panggilan SerpApi)
  const firstRaw = sanitizeSerpApiRaw(
    loadFixtureJson("ai-overview-page-token.json")
  );
  const secondRaw = sanitizeSerpApiRaw(
    loadFixtureJson("ai-overview-page-token-followup.json")
  );
  const mergedRaw: SerpApiRawResponse = sanitizeSerpApiRaw({
    ...firstRaw,
    ai_overview: {
      ...firstRaw.ai_overview,
      text_blocks: secondRaw.text_blocks,
      references: secondRaw.references,
      error: secondRaw.error,
    },
    ai_overview_followup: secondRaw,
    dry_run: true,
    serpapi_calls_count: 2,
  });

  return {
    parsed: parseSerpApiResponse(mergedRaw),
    raw: mergedRaw,
    firstRaw,
    secondRaw,
    usedFollowUpPageToken: true,
    apiCallsCount: 2,
  };
}

/**
 * Memanggil SerpApi di sisi server untuk satu keyword.
 * Jika SERPAPI_DRY_RUN=true (dan tidak ada fetchFn khusus), mengembalikan data dari fixture tanpa memanggil jaringan.
 * Jika respons pertama hanya mengembalikan page_token di dalam ai_overview,
 * otomatis melakukan panggilan kedua ke engine=google_ai_overview.
 */
export async function fetchKeywordAiOverview(
  input: string | SerpApiSearchParams,
  options: SerpApiClientOptions = {}
): Promise<SerpApiCheckResult> {
  const params = serpApiSearchParamsSchema.parse(
    typeof input === "string" ? { keyword: input } : input
  );

  const dryRunMode = options.dryRun ?? isDryRun();

  if (dryRunMode) {
    return simulateDryRunKeyword(params.keyword);
  }

  const apiKey = options.apiKey ?? process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_KEY wajib tersedia di server.");
  }

  const fetchImpl = options.fetchFn ?? fetch;

  const searchUrl = new URL("https://serpapi.com/search.json");
  searchUrl.searchParams.set("engine", "google");
  searchUrl.searchParams.set("q", params.keyword);
  searchUrl.searchParams.set("google_domain", params.googleDomain);
  searchUrl.searchParams.set("gl", params.gl);
  searchUrl.searchParams.set("hl", params.hl);
  searchUrl.searchParams.set("location", params.location);
  searchUrl.searchParams.set("api_key", apiKey);

  const firstRes = await fetchImpl(searchUrl.toString());
  if (!firstRes.ok) {
    throw new Error(
      `Permintaan SerpApi engine=google gagal dengan status HTTP ${firstRes.status}`
    );
  }

  const firstRawUnsanitized = (await firstRes.json()) as SerpApiRawResponse;
  if (firstRawUnsanitized.error) {
    throw new Error(`SerpApi mengembalikan galat: ${firstRawUnsanitized.error}`);
  }
  const firstRaw = sanitizeSerpApiRaw({
    ...firstRawUnsanitized,
    serpapi_calls_count: 1,
  });

  const firstParsed = parseSerpApiResponse(firstRaw);

  // Jika AI Overview sudah berisi teks/referensi, atau tidak ada page_token, selesai
  if (firstParsed.hasAiOverview || !firstParsed.pageToken) {
    return {
      parsed: firstParsed,
      raw: firstRaw,
      firstRaw,
      secondRaw: null,
      usedFollowUpPageToken: false,
      apiCallsCount: 1,
    };
  }

  // Panggil segera engine=google_ai_overview menggunakan page_token karena token cepat kedaluwarsa
  const followUpUrl = new URL("https://serpapi.com/search.json");
  followUpUrl.searchParams.set("engine", "google_ai_overview");
  followUpUrl.searchParams.set("page_token", firstParsed.pageToken);
  followUpUrl.searchParams.set("api_key", apiKey);

  const secondRes = await fetchImpl(followUpUrl.toString());
  const secondRawUnsanitized = (await secondRes
    .json()
    .catch(() => ({}))) as SerpApiRawResponse;

  const isNoResultError =
    typeof secondRawUnsanitized.error === "string" &&
    /Google hasn't returned any results/i.test(secondRawUnsanitized.error);

  if (!secondRes.ok && !isNoResultError) {
    throw new Error(
      `Permintaan SerpApi engine=google_ai_overview gagal dengan status HTTP ${secondRes.status}`
    );
  }

  if (secondRawUnsanitized.error && !isNoResultError) {
    throw new Error(
      `SerpApi google_ai_overview mengembalikan galat: ${secondRawUnsanitized.error}`
    );
  }
  const secondRaw = sanitizeSerpApiRaw(secondRawUnsanitized);

  const secondAiOverview: SerpApiAiOverviewRaw =
    secondRaw.ai_overview && typeof secondRaw.ai_overview === "object"
      ? secondRaw.ai_overview
      : {
          text_blocks: secondRaw.text_blocks,
          references: secondRaw.references,
          error: secondRaw.error,
        };

  const mergedRaw: SerpApiRawResponse = sanitizeSerpApiRaw({
    ...firstRaw,
    ai_overview: {
      ...firstRaw.ai_overview,
      ...secondAiOverview,
    },
    ai_overview_followup: secondRaw,
    serpapi_calls_count: 2,
  });

  const secondParsed = parseSerpApiResponse(mergedRaw);

  return {
    parsed: secondParsed,
    raw: mergedRaw,
    firstRaw,
    secondRaw,
    usedFollowUpPageToken: true,
    apiCallsCount: 2,
  };
}
