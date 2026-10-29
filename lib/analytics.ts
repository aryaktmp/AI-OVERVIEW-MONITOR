import {
  DEFAULT_BRAND_TERMS,
  buildBrandTermRegex,
  isMatchingDomain,
  type BrandTermConfig,
  type CheckStatus,
} from "./detect.ts";

export type HeatmapCellState = 0 | 1 | 2; // 0 = no_ai_overview, 1 = not_detected, 2 = detected

export interface AnalyticsKeywordInput {
  id: string;
  text: string;
  groupName: string;
  active: boolean;
}

export interface AnalyticsCheckInput {
  id: string;
  keyword_id: string;
  run_id: string;
  checked_at: string;
  status: CheckStatus;
  detected_domain: boolean;
  detected_text: boolean;
  detected_third_party: boolean;
  is_demo?: boolean;
}

export interface WeekBucket {
  index: number;
  label: string;
  startMs: number;
  endMs: number;
  aiOverviewCount: number;
  detectedCount: number;
  detectionRate: number;
}

export interface KeywordWeeklyRow {
  id: string;
  keyword: string;
  groupName: string;
  active: boolean;
  weeklyStates: HeatmapCellState[];
  currentState: HeatmapCellState;
  currentStatus: CheckStatus;
  detectionTypeLabel: string;
  latestCheckId: string | null;
  latestCheckedAt: string | null;
}

export interface DashboardSummaryAnalytics {
  totalKeywords: number;
  activeKeywords: number;
  currentAiOverviewCount: number;
  prevAiOverviewCount: number;
  aiOverviewDelta: number;
  currentDetectedCount: number;
  prevDetectedCount: number;
  detectedDelta: number;
  currentDetectionRate: number;
  prevDetectionRate: number;
  detectionRateDelta: number;
  weeks: WeekBucket[];
  keywordRows: KeywordWeeklyRow[];
  hasDemoData: boolean;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatShortDate(date: Date): string {
  const day = date.getUTCDate();
  const month = SHORT_MONTHS[date.getUTCMonth()] ?? "";
  return `${day} ${month}`;
}

export const formatIndonesianShortDate = formatShortDate;

export function statusToCellState(status: CheckStatus | null | undefined): HeatmapCellState {
  if (status === "detected") return 2;
  if (status === "not_detected") return 1;
  return 0;
}

export function formatDetectionTypeLabel(flags: {
  detected_domain: boolean;
  detected_text: boolean;
  detected_third_party: boolean;
}): string {
  const types: string[] = [];
  if (flags.detected_domain) {
    types.push("Domain cited");
  }
  if (flags.detected_text) {
    types.push("Brand mentioned in text");
  }
  if (flags.detected_third_party) {
    types.push("Mentioned in other sources");
  }
  return types.length > 0 ? types.join(", ") : "-";
}

/**
 * Membangun 8 rentang minggu terakhir (Senin 00:00 UTC s/d Minggu 23:59:59 UTC)
 * dengan kolom ke-8 (index 7) adalah minggu berjalan dari referenceDate.
 */
export function buildEightWeekBuckets(referenceDate: Date = new Date()): Array<{
  index: number;
  label: string;
  startMs: number;
  endMs: number;
}> {
  const ref = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );
  // Hari Senin minggu ini (0 = Minggu -> mundur 6 hari; 1 = Senin -> mundur 0 hari)
  const dayOfWeek = ref.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const currentMondayMs = ref.getTime() - diffToMonday * 86_400_000;
  const oneWeekMs = 7 * 86_400_000;

  const buckets: Array<{
    index: number;
    label: string;
    startMs: number;
    endMs: number;
  }> = [];

  for (let i = 0; i < 8; i++) {
    const weeksAgo = 7 - i;
    const startMs = currentMondayMs - weeksAgo * oneWeekMs;
    const endMs = startMs + oneWeekMs - 1;
    buckets.push({
      index: i,
      label: formatIndonesianShortDate(new Date(startMs)),
      startMs,
      endMs,
    });
  }

  return buckets;
}

/**
 * Menghitung statistik ringkasan, selisih mingguan, grafik tren 8 minggu,
 * dan peta status per keyword.
 */
export function computeDashboardAnalytics(
  keywords: AnalyticsKeywordInput[],
  checks: AnalyticsCheckInput[],
  referenceDate: Date = new Date()
): DashboardSummaryAnalytics {
  const rawBuckets = buildEightWeekBuckets(referenceDate);

  // Urutkan checks dari terbaru ke terlama
  const sortedChecks = [...checks].sort(
    (a, b) => Date.parse(b.checked_at) - Date.parse(a.checked_at)
  );

  const checksByKeyword = new Map<string, AnalyticsCheckInput[]>();
  let hasDemoData = false;

  for (const chk of sortedChecks) {
    if (chk.is_demo) {
      hasDemoData = true;
    }
    const list = checksByKeyword.get(chk.keyword_id) ?? [];
    list.push(chk);
    checksByKeyword.set(chk.keyword_id, list);
  }

  const keywordRows: KeywordWeeklyRow[] = keywords.map((kw) => {
    const kwChecks = checksByKeyword.get(kw.id) ?? [];
    const latestOverall = kwChecks[0] ?? null;

    const weeklyChecks: Array<AnalyticsCheckInput | null> = rawBuckets.map(
      (b) => {
        return (
          kwChecks.find((c) => {
            const t = Date.parse(c.checked_at);
            return t >= b.startMs && t <= b.endMs;
          }) ?? null
        );
      }
    );

    const weeklyStates: HeatmapCellState[] = weeklyChecks.map((c) =>
      statusToCellState(c?.status)
    );

    const currentWeekCheck = weeklyChecks[7] ?? latestOverall;
    const currentStatus: CheckStatus =
      currentWeekCheck?.status ?? "no_ai_overview";
    const currentState = statusToCellState(currentStatus);

    return {
      id: kw.id,
      keyword: kw.text,
      groupName: kw.groupName || "Tanpa Grup",
      active: kw.active,
      weeklyStates,
      currentState,
      currentStatus,
      detectionTypeLabel: currentWeekCheck
        ? formatDetectionTypeLabel(currentWeekCheck)
        : "-",
      latestCheckId: currentWeekCheck?.id ?? null,
      latestCheckedAt: currentWeekCheck?.checked_at ?? null,
    };
  });

  const weeks: WeekBucket[] = rawBuckets.map((b, wIdx) => {
    let aiOverviewCount = 0;
    let detectedCount = 0;

    for (const row of keywordRows) {
      if (!row.active) continue;
      const cell = row.weeklyStates[wIdx] ?? 0;
      if (cell > 0) aiOverviewCount++;
      if (cell === 2) detectedCount++;
    }

    const detectionRate =
      aiOverviewCount > 0
        ? Math.round((detectedCount / aiOverviewCount) * 100)
        : 0;

    return {
      ...b,
      aiOverviewCount,
      detectedCount,
      detectionRate,
    };
  });

  const nowWeek = weeks[7]!;
  const prevWeek = weeks[6]!;

  return {
    totalKeywords: keywords.length,
    activeKeywords: keywords.filter((k) => k.active).length,
    currentAiOverviewCount: nowWeek.aiOverviewCount,
    prevAiOverviewCount: prevWeek.aiOverviewCount,
    aiOverviewDelta: nowWeek.aiOverviewCount - prevWeek.aiOverviewCount,
    currentDetectedCount: nowWeek.detectedCount,
    prevDetectedCount: prevWeek.detectedCount,
    detectedDelta: nowWeek.detectedCount - prevWeek.detectedCount,
    currentDetectionRate: nowWeek.detectionRate,
    prevDetectionRate: prevWeek.detectionRate,
    detectionRateDelta: nowWeek.detectionRate - prevWeek.detectionRate,
    weeks,
    keywordRows,
    hasDemoData,
  };
}

export interface SourceCitationInput {
  keyword_id: string;
  domain: string;
  url?: string;
}

export interface CompetitorRankingRow {
  domain: string;
  keywordCount: number;
  percentageOfMax: number;
  isOwn: boolean;
  isCompetitor: boolean;
}

/**
 * Menghitung peringkat domain yang paling sering dikutip untuk keyword yang dipantau.
 * Menghitung jumlah keyword unik yang mengutip tiap domain pada cek terbaru.
 */
export function computeCompetitorDomainRanking(
  citations: SourceCitationInput[],
  ownDomain: string = "linovhr.com",
  competitorDomains: string[] = []
): CompetitorRankingRow[] {
  const domainKeywordsMap = new Map<string, Set<string>>();

  const cleanOwn = ownDomain.toLowerCase().replace(/^www\./, "");
  domainKeywordsMap.set(cleanOwn, new Set());
  for (const comp of competitorDomains) {
    const cleanComp = comp.toLowerCase().replace(/^www\./, "");
    if (cleanComp) {
      domainKeywordsMap.set(cleanComp, new Set());
    }
  }

  for (const item of citations) {
    const rawDomain = item.domain.toLowerCase().replace(/^www\./, "").trim();
    if (!rawDomain) continue;

    let bucketDomain = rawDomain;
    if (isMatchingDomain(rawDomain, cleanOwn)) {
      bucketDomain = cleanOwn;
    } else {
      for (const comp of competitorDomains) {
        const cleanComp = comp.toLowerCase().replace(/^www\./, "");
        if (cleanComp && isMatchingDomain(rawDomain, cleanComp)) {
          bucketDomain = cleanComp;
          break;
        }
      }
    }

    const set = domainKeywordsMap.get(bucketDomain) ?? new Set<string>();
    set.add(item.keyword_id);
    domainKeywordsMap.set(bucketDomain, set);
  }

  const rows = Array.from(domainKeywordsMap.entries())
    .map(([domain, kwSet]) => {
      const isOwn = isMatchingDomain(domain, cleanOwn);
      const isCompetitor =
        !isOwn &&
        competitorDomains.some((comp) => isMatchingDomain(domain, comp));
      return {
        domain,
        keywordCount: kwSet.size,
        isOwn,
        isCompetitor,
      };
    })
    .filter((r) => r.keywordCount > 0 || r.isOwn || r.isCompetitor)
    .sort((a, b) => {
      if (b.keywordCount !== a.keywordCount) {
        return b.keywordCount - a.keywordCount;
      }
      return a.domain.localeCompare(b.domain);
    });

  const maxCount = Math.max(1, ...rows.map((r) => r.keywordCount));

  return rows.map((r) => ({
    ...r,
    percentageOfMax: Math.round((r.keywordCount / maxCount) * 100),
  }));
}

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Memecah teks jawaban AI Overview menjadi segmen teks biasa dan segmen istilah merek
 * yang ditandai (untuk ditampilkan pada halaman Detail Keyword).
 */
export function splitTextByBrandTerms(
  text: string,
  brandTerms: Array<string | BrandTermConfig> = DEFAULT_BRAND_TERMS
): HighlightSegment[] {
  if (!text) return [];

  const activeTerms = brandTerms
    .map((item) =>
      typeof item === "string"
        ? { term: item.trim(), enabled: true }
        : { term: item.term.trim(), enabled: item.enabled !== false }
    )
    .filter((t) => t.enabled && t.term.length > 0)
    .sort((a, b) => b.term.length - a.term.length);

  if (activeTerms.length === 0) {
    return [{ text, highlighted: false }];
  }

  const regexes = activeTerms.map((t) => buildBrandTermRegex(t.term));
  const combinedPattern = regexes.map((r) => `(${r.source})`).join("|");
  const globalRegex = new RegExp(combinedPattern, "gi");

  const segments: HighlightSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(globalRegex)) {
    const start = match.index ?? 0;
    const matchedStr = match[0] ?? "";
    if (!matchedStr) continue;

    if (start > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, start),
        highlighted: false,
      });
    }
    segments.push({
      text: matchedStr,
      highlighted: true,
    });
    lastIndex = start + matchedStr.length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      highlighted: false,
    });
  }

  return segments.length > 0 ? segments : [{ text, highlighted: false }];
}
