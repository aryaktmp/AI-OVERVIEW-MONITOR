import Link from "next/link";
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
import { CompetitorManagerCard } from "@/components/competitor-manager-card";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage() {
  const { ranking, competitors, hasDemoData, totalChecksAnalyzed } =
    await getCompetitorPageData();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--ink)]">
          Most Frequently Cited Domains &amp; Competitors
        </h1>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Across the same keywords ({totalChecksAnalyzed} keywords checked),
          which domains appear most often in AI Overview, and manage your monitored competitor domains.
        </p>
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
              <Link href="/settings">Open settings &amp; run check</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/keywords">View keywords list</Link>
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

      {/* Interactive Monitored Competitors Manager */}
      <CompetitorManagerCard competitors={competitors} />
    </div>
  );
}
