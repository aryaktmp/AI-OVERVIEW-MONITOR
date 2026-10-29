import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

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
}

export interface ParsedAiOverview {
  hasAiOverview: boolean;
  answerText: string;
  sources: ParsedAiOverviewSource[];
  pageToken: string | null;
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
 * dari objek respons mentah SerpApi.
 */
export function sanitizeSerpApiRaw<T>(input: T): T {
  if (typeof input === "string") {
    return input.replace(
      /([?&])api_key=[^&\s"']+/gi,
      "$1api_key=[REDACTED]"
    ) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeSerpApiRaw(item)) as unknown as T;
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k.toLowerCase() === "api_key" || k.toLowerCase() === "apikey") {
        continue;
      }
      out[k] = sanitizeSerpApiRaw(v);
    }
    return out as T;
  }
  return input;
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
  if (Array.isArray(aiOverview.references)) {
    aiOverview.references.forEach((ref, idx) => {
      if (!ref || typeof ref !== "object") return;
      const link = typeof ref.link === "string" ? ref.link.trim() : "";
      if (!link) return;
      const domain = extractDomainFromUrl(link);
      if (!domain) return;

      sources.push({
        position: typeof ref.index === "number" ? ref.index : idx,
        title: typeof ref.title === "string" ? ref.title.trim() : "",
        url: link,
        domain,
        snippet: typeof ref.snippet === "string" ? ref.snippet.trim() : undefined,
        sourceName: typeof ref.source === "string" ? ref.source.trim() : undefined,
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

  const isDryRun =
    options.dryRun ??
    (!options.fetchFn &&
      (process.env.SERPAPI_DRY_RUN === "true" ||
        process.env.SERPAPI_DRY_RUN === "1"));

  if (isDryRun) {
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
