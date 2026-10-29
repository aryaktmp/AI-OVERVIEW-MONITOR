import Link from "next/link";
import { ArrowRight, Settings } from "lucide-react";
import { getCompetitorPageData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function KompetitorPage() {
  const { ranking, competitors, hasDemoData, totalChecksAnalyzed } =
    await getCompetitorPageData();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--ink)]">
            Most Frequently Cited Domains
          </h1>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Across the same keywords ({totalChecksAnalyzed} keywords checked),
            which domains appear most often in AI Overview.
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/pengaturan" className="inline-flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            Manage competitors list
          </Link>
        </Button>
      </div>

      <DemoDataBanner visible={hasDemoData} />

      {ranking.length === 0 || totalChecksAnalyzed === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <CardHeader>
            <CardTitle>No domain citations recorded yet</CardTitle>
            <CardDescription className="mx-auto max-w-md">
              Run keyword checks first or load demo data to view domain rankings
              cited by Google AI Overview.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2.5">
            <Button asChild variant="primary">
              <Link href="/pengaturan">Open settings &amp; run check</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/keyword">View keywords list</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Domains Cited by Keyword Count</CardTitle>
              <span className="text-xs text-[var(--muted)]">
                Calculated from the latest check result of each keyword
              </span>
            </div>
          </CardHeader>

          <CardContent className="space-y-2.5">
            {ranking.map((row) => (
              <div
                key={row.domain}
                className="grid grid-cols-1 items-center gap-2 text-xs sm:grid-cols-[200px_1fr_90px] sm:gap-2.5"
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={
                      row.isOwn
                        ? "font-bold text-[var(--cite)]"
                        : "font-semibold text-[var(--ink)]"
                    }
                  >
                    {row.domain}
                    {row.isOwn ? " (You)" : ""}
                  </span>
                  {row.isCompetitor && (
                    <Badge variant="notDetected">Competitor</Badge>
                  )}
                </div>

                <div className="h-4 overflow-hidden rounded-full bg-[var(--none)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(row.keywordCount > 0 ? 4 : 0, row.percentageOfMax)}%`,
                      backgroundColor: row.isOwn ? "var(--cite)" : "var(--muted)",
                    }}
                  />
                </div>

                <div className="font-mono text-xs text-[var(--muted)] sm:text-right">
                  {row.keywordCount} {row.keywordCount === 1 ? "keyword" : "keywords"}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Monitored Competitors */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              Monitored Competitors ({competitors.length})
            </CardTitle>
            <Link
              href="/pengaturan"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cite)] hover:underline"
            >
              Add or manage in Settings
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>

        <CardContent>
          {competitors.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              No competitors registered yet. Add competitor domains on the
              Settings page to automatically tag competitor citations.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {competitors.map((c) => (
                <div
                  key={c.id}
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-[var(--ink)]">{c.name}</span>
                  <span className="font-mono text-[11px] text-[var(--muted)]">
                    {c.domain}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
