import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";
import {
  CSV_EXPORT_HEADERS,
  formatCsvExportRow,
  type CsvExportRow,
} from "@/lib/csv-export";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

interface KeywordMeta {
  id: string;
  text: string;
  groupName: string;
  isDemo: boolean;
}

function normalizeDateBound(raw: string | null, isEndOfDay: boolean): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isEndOfDay
      ? `${trimmed}T23:59:59.999Z`
      : `${trimmed}T00:00:00.000Z`;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

export async function GET(request: Request) {
  // 1. Wajib terautentikasi lewat sesi pengguna & masuk daftar ALLOWED_EMAILS (bukan CRON_SECRET)
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();

  if (authError || !user?.email) {
    return NextResponse.json(
      { error: "Sesi tidak ditemukan. Silakan masuk terlebih dahulu." },
      { status: 401 }
    );
  }

  if (!isEmailAllowed(user.email)) {
    return NextResponse.json(
      { error: "Email Anda tidak memiliki izin untuk mengekspor data." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const modeParam = (url.searchParams.get("mode") ?? "latest")
    .trim()
    .toLowerCase();
  const mode: "latest" | "history" =
    modeParam === "history" ? "history" : "latest";

  const includeDemoParam = (url.searchParams.get("include_demo") ?? "")
    .trim()
    .toLowerCase();
  const includeDemo =
    includeDemoParam === "true" || includeDemoParam === "1";

  const fromIso = normalizeDateBound(url.searchParams.get("from"), false);
  const toIso = normalizeDateBound(url.searchParams.get("to"), true);

  const supabase = createSupabaseAdminClient();

  // 2. Ambil daftar keyword secara bertahap (1000 baris per query)
  const keywordMap = new Map<string, KeywordMeta>();
  let kwOffset = 0;

  while (true) {
    let kwQuery = supabase
      .from("keywords")
      .select("id, text, is_demo, keyword_groups(name, is_demo)")
      .order("text", { ascending: true })
      .range(kwOffset, kwOffset + PAGE_SIZE - 1);

    if (!includeDemo) {
      kwQuery = kwQuery.eq("is_demo", false);
    }

    const { data: kwPage, error: kwError } = await kwQuery;
    if (kwError) {
      return NextResponse.json(
        { error: `Gagal memuat daftar keyword: ${kwError.message}` },
        { status: 500 }
      );
    }

    const rows = kwPage ?? [];
    for (const rawRow of rows) {
      const r = rawRow as {
        id: string;
        text: string;
        is_demo?: boolean;
        keyword_groups?:
          | { name?: string; is_demo?: boolean }
          | Array<{ name?: string; is_demo?: boolean }>
          | null;
      };
      const grp = Array.isArray(r.keyword_groups)
        ? r.keyword_groups[0]
        : r.keyword_groups;

      keywordMap.set(r.id, {
        id: r.id,
        text: r.text,
        groupName: grp?.name ?? "Tanpa Grup",
        isDemo: Boolean(r.is_demo),
      });
    }

    if (rows.length < PAGE_SIZE) {
      break;
    }
    kwOffset += PAGE_SIZE;
  }

  // 3. Ambil data checks secara bertahap (1000 baris per query)
  const csvLines: string[] = [CSV_EXPORT_HEADERS.join(",")];
  const seenLatestKeywords = new Set<string>();
  let checkOffset = 0;

  while (true) {
    let checkQuery = supabase
      .from("checks")
      .select(
        "id, keyword_id, checked_at, status, detected_domain, detected_text, detected_third_party, check_runs!inner(is_demo), check_sources(domain, is_competitor, position)"
      )
      .order("checked_at", { ascending: false })
      .range(checkOffset, checkOffset + PAGE_SIZE - 1);

    if (!includeDemo) {
      checkQuery = checkQuery.eq("check_runs.is_demo", false);
    }

    if (mode === "history") {
      if (fromIso) {
        checkQuery = checkQuery.gte("checked_at", fromIso);
      }
      if (toIso) {
        checkQuery = checkQuery.lte("checked_at", toIso);
      }
    }

    const { data: checkPage, error: checkError } = await checkQuery;
    if (checkError) {
      return NextResponse.json(
        { error: `Gagal memuat data pemeriksaan: ${checkError.message}` },
        { status: 500 }
      );
    }

    const pageRows = checkPage ?? [];
    for (const rawCheck of pageRows) {
      const c = rawCheck as {
        id: string;
        keyword_id: string;
        checked_at: string;
        status: string;
        detected_domain: boolean;
        detected_text: boolean;
        detected_third_party: boolean;
        check_sources?: Array<{
          domain: string;
          is_competitor: boolean;
          position: number;
        }> | null;
      };

      const kwMeta = keywordMap.get(c.keyword_id);
      if (!kwMeta) {
        continue;
      }

      if (mode === "latest") {
        if (seenLatestKeywords.has(c.keyword_id)) {
          continue;
        }
        seenLatestKeywords.add(c.keyword_id);
      }

      const sortedSources = [...(c.check_sources ?? [])].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );

      const sourceDomains = Array.from(
        new Set(sortedSources.map((s) => s.domain).filter(Boolean))
      );
      const competitorDomainsCited = Array.from(
        new Set(
          sortedSources
            .filter((s) => s.is_competitor)
            .map((s) => s.domain)
            .filter(Boolean)
        )
      );

      const exportRow: CsvExportRow = {
        keyword: kwMeta.text,
        group: kwMeta.groupName,
        checked_at: c.checked_at,
        status: c.status,
        detected_domain: Boolean(c.detected_domain),
        detected_text: Boolean(c.detected_text),
        detected_third_party: Boolean(c.detected_third_party),
        source_domains: sourceDomains,
        competitor_domains_cited: competitorDomainsCited,
      };

      csvLines.push(formatCsvExportRow(exportRow));
    }

    if (
      pageRows.length < PAGE_SIZE ||
      (mode === "latest" && seenLatestKeywords.size >= keywordMap.size)
    ) {
      break;
    }

    checkOffset += PAGE_SIZE;
  }

  const csvBody = `${csvLines.join("\n")}\n`;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename =
    mode === "history"
      ? `linovhr-ai-overview-riwayat-${dateStamp}.csv`
      : `linovhr-ai-overview-terbaru-${dateStamp}.csv`;

  return new Response(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
