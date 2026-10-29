import Link from "next/link";
import { Search, Sparkles, CheckCircle2, TrendingUp } from "lucide-react";
import { getDashboardOverviewData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { ExportCsvButton } from "@/components/export-csv-button";
import { WeeklyTrendChart } from "@/components/weekly-trend-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { HeatmapCellState, KeywordWeeklyRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function DeltaBadge({
  delta,
  suffix = "",
}: {
  delta: number;
  suffix?: string;
}) {
  const isPositive = delta >= 0;
  return (
    <i
      className={`ml-1.5 text-xs font-semibold not-italic ${
        isPositive ? "text-[var(--cite)]" : "text-[#C0392B]"
      }`}
    >
      {isPositive ? "+" : ""}
      {delta}
      {suffix} vs last week
    </i>
  );
}

function cellClassName(state: HeatmapCellState): string {
  if (state === 2) {
    return "h-[22px] rounded-[3px] bg-[var(--cite)]";
  }
  if (state === 1) {
    return "h-[22px] rounded-[3px] bg-[var(--seen-bg)] inset-ring inset-ring-[var(--seen)]";
  }
  return "h-[22px] rounded-[3px] bg-[var(--none)]";
}

export default async function RingkasanPage() {
  const { analytics } = await getDashboardOverviewData();

  if (analytics.totalKeywords === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No monitored keywords yet</CardTitle>
          <CardDescription>
            Add keywords first to start monitoring LinovHR citations in Google AI
            Overview.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link href="/keyword">Add first keyword</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pengaturan">Open settings</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Kelompokkan baris keyword berdasarkan grup sesuai prototipe
  const sortedRows = [...analytics.keywordRows].sort((a, b) => {
    const grpCmp = a.groupName.localeCompare(b.groupName);
    if (grpCmp !== 0) return grpCmp;
    return a.keyword.localeCompare(b.keyword);
  });

  const rowsByGroup = new Map<string, KeywordWeeklyRow[]>();
  for (const row of sortedRows) {
    const list = rowsByGroup.get(row.groupName) ?? [];
    list.push(row);
    rowsByGroup.set(row.groupName, list);
  }

  return (
    <div className="space-y-5">
      <DemoDataBanner visible={analytics.hasDemoData} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">Monitored keywords</span>
            <Search className="h-4 w-4" />
          </div>
          <div className="mt-2 text-[28px] font-extrabold leading-none tracking-tight">
            {analytics.activeKeywords}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">AI Overview present</span>
            <Sparkles className="h-4 w-4 text-[var(--seen)]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold leading-none tracking-tight">
              {analytics.currentAiOverviewCount}
            </span>
            <DeltaBadge delta={analytics.aiOverviewDelta} />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">LinovHR detected</span>
            <CheckCircle2 className="h-4 w-4 text-[var(--cite)]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold leading-none tracking-tight">
              {analytics.currentDetectedCount}
            </span>
            <DeltaBadge delta={analytics.detectedDelta} />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">Detection rate</span>
            <TrendingUp className="h-4 w-4 text-[var(--cite)]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold leading-none tracking-tight">
              {analytics.currentDetectionRate}%
            </span>
            <DeltaBadge delta={analytics.detectionRateDelta} suffix=" pts" />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weekly detection rate</CardTitle>
          <CardDescription>
            Keywords citing LinovHR compared to keywords triggering Google AI Overview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WeeklyTrendChart weeks={analytics.weeks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Keyword status over the last 8 weeks</CardTitle>
              <CardDescription>
                Each column represents one week. The rightmost column is this week.
              </CardDescription>
            </div>
            <ExportCsvButton />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="grid min-w-[520px] grid-cols-[minmax(190px,1.6fr)_repeat(8,minmax(34px,1fr))] items-center gap-[3px]">
              <div />
              {analytics.weeks.map((w) => {
                const [day, month] = w.label.split(" ");
                return (
                  <div
                    key={w.index}
                    className="text-center text-[11px] leading-tight text-[var(--muted)]"
                  >
                    {day}
                    <br />
                    {month}
                  </div>
                );
              })}

              {Array.from(rowsByGroup.entries()).map(([groupName, rows]) => (
                <div key={groupName} className="contents">
                  <div className="col-span-full mt-2.5 text-[13px] font-extrabold">
                    {groupName}
                  </div>
                  {rows.map((row) => (
                    <div key={row.id} className="contents">
                      <Link
                        href={`/keyword/${row.id}`}
                        title={row.keyword}
                        className="truncate text-[13px] hover:underline"
                      >
                        {row.keyword}
                      </Link>
                      {row.weeklyStates.map((st, idx) => (
                        <div
                          key={idx}
                          className={cellClassName(st)}
                          title={`${row.keyword} (${analytics.weeks[idx]?.label}): ${
                            st === 2
                              ? "LinovHR detected"
                              : st === 1
                                ? "AI Overview present, LinovHR not detected"
                                : "AI Overview not present"
                          }`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3.5 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px] bg-[var(--cite)]" />
              LinovHR detected
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px] bg-[var(--seen-bg)] inset-ring inset-ring-[var(--seen)]" />
              AI Overview present, LinovHR not detected
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px] bg-[var(--none)]" />
              AI Overview not present
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
