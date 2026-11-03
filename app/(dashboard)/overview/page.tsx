import Link from "next/link";
import {
  AlertTriangle,
  Layers,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { getDashboardOverviewData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExportDataDialog } from "@/components/export-csv-button";
import { WeeklyTrendChart } from "@/components/weekly-trend-chart";
import { GroupCitationBarChart } from "@/components/group-citation-bar-chart";
import { OverviewActiveBatchWidget } from "@/components/overview-active-batch-widget";
import { OverviewHeatmapCard } from "@/components/overview-heatmap-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSlotWeekNumber } from "@/lib/keyword-batches";

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
        isPositive ? "text-[var(--success-text)]" : "text-[var(--destructive)]"
      }`}
    >
      {isPositive ? "+" : ""}
      {delta}
      {suffix} vs last week
    </i>
  );
}

export default async function OverviewPage() {
  const {
    analytics,
    batches,
    slots,
    scheduleSettings,
    monthlyRunCount,
    unbatchedActiveKeywordsCount,
  } = await getDashboardOverviewData();

  if (analytics.totalKeywords === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No monitored keywords yet</CardTitle>
          <CardDescription>
            Add keywords first to start monitoring LinovHR citations in Google
            AI Overview.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link href="/keywords">Add first keyword</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings">Open settings</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const activeBatch = batches.find((b) => b.is_active);
  const currentSlotWeek = getSlotWeekNumber(new Date());

  return (
    <div className="space-y-5">
      {/* Header Overview dengan Tombol Ekspor Cepat */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--ink)]">
            Executive Overview
          </h1>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            AI Overview citation performance, weekly batch schedule status, and
            trend analytics for LinovHR.
          </p>
        </div>

        <ExportDataDialog
          buttonLabel="Export Report"
          summaryMetrics={{
            totalKeywords: analytics.totalKeywords,
            detectedCount: analytics.currentDetectedCount,
            detectionRate: analytics.currentDetectionRate,
          }}
        />
      </div>

      <DemoDataBanner visible={analytics.hasDemoData} />

      {unbatchedActiveKeywordsCount > 0 && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <AlertDescription className="font-medium">
              <strong>Unassigned keywords warning:</strong>{" "}
              {unbatchedActiveKeywordsCount} active{" "}
              {unbatchedActiveKeywordsCount === 1
                ? "keyword has"
                : "keywords have"}{" "}
              no assigned batch and will not be checked.
            </AlertDescription>
            <Link
              href="/keywords"
              className="text-xs font-bold underline hover:opacity-80"
            >
              Assign to a batch →
            </Link>
          </div>
        </Alert>
      )}

      {/* Row 1: 4 Kartu Statistik Kunci */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total & Active Keywords */}
        <Card className="p-4 shadow-xs">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">Keywords Monitored</span>
            <Search className="h-4 w-4" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold leading-none tracking-tight text-[var(--ink)] font-mono">
              {analytics.activeKeywords}
            </span>
            <span className="text-xs text-[var(--muted)] font-mono">
              of {analytics.totalKeywords} total
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">
            {analytics.totalKeywords > 0
              ? `${Math.round((analytics.activeKeywords / analytics.totalKeywords) * 100)}% currently active`
              : "0% active"}
          </div>
        </Card>

        {/* Card 2: Active Rotation Batch */}
        <Card className="p-4 shadow-xs">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">Active Rotation Batch</span>
            <Layers
              className="h-4 w-4"
              style={{ color: activeBatch?.color || "var(--cite)" }}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between truncate">
            <span className="text-[22px] sm:text-[24px] font-extrabold leading-none tracking-tight text-[var(--ink)] truncate">
              {activeBatch ? activeBatch.name : "None"}
            </span>
            <span className="text-xs font-semibold text-[var(--cite)] font-mono">
              Week {currentSlotWeek}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)] truncate">
            {activeBatch
              ? `${activeBatch.activeKeywords} active (${activeBatch.totalKeywords} total) in current rotation`
              : "No batch currently assigned"}
          </div>
        </Card>

        {/* Card 3: AI Overview Present */}
        <Card className="p-4 shadow-xs">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">AI Overview Present</span>
            <Sparkles className="h-4 w-4 text-[var(--seen)]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold leading-none tracking-tight text-[var(--ink)] font-mono">
              {analytics.currentAiOverviewCount}
            </span>
            <DeltaBadge delta={analytics.aiOverviewDelta} />
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">
            Keywords triggering Google AI Overview
          </div>
        </Card>

        {/* Card 4: LinovHR Detection Rate */}
        <Card className="p-4 shadow-xs">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold">
              LinovHR Detection Rate
            </span>
            <TrendingUp className="h-4 w-4 text-[var(--cite)]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold leading-none tracking-tight text-[var(--cite)] font-mono">
              {analytics.currentDetectionRate}%
            </span>
            <DeltaBadge delta={analytics.detectionRateDelta} suffix=" pts" />
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">
            {analytics.currentDetectedCount} keywords cited in AI Overview
          </div>
        </Card>
      </div>

      {/* Row 2: Widget Status Batch Mingguan & Kalender Rotasi */}
      <OverviewActiveBatchWidget
        batches={batches}
        slots={slots}
        scheduleSettings={scheduleSettings}
        monthlyRunCount={monthlyRunCount}
      />

      {/* Row 3: Dua Chart Interaktif Berdampingan */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Chart 1: Line Chart Tren Mingguan */}
        <Card className="shadow-xs">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-[var(--ink)]">
                  Weekly Detection Rate Trend
                </CardTitle>
                <CardDescription className="text-xs">
                  Percentage of AI Overview citations for LinovHR over the last
                  8 weeks.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <WeeklyTrendChart weeks={analytics.weeks} />
          </CardContent>
        </Card>

        {/* Chart 2: Bar Chart Sitasi per Grup Produk */}
        <Card className="shadow-xs">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-[var(--ink)]">
                  Citations by Keyword Group
                </CardTitle>
                <CardDescription className="text-xs">
                  LinovHR detected vs AI Overview present per LinovHR product
                  module.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <GroupCitationBarChart rows={analytics.keywordRows} />
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Heatmap Sitasi 8 Minggu Terakhir dengan Paginasi & Search */}
      <OverviewHeatmapCard
        weeks={analytics.weeks}
        keywordRows={analytics.keywordRows}
        totalKeywords={analytics.totalKeywords}
        detectedCount={analytics.currentDetectedCount}
        detectionRate={analytics.currentDetectionRate}
      />
    </div>
  );
}
