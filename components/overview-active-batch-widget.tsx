"use client";

import Link from "next/link";
import {
  ChevronRight,
  Clock,
  Layers,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  getScheduledBatchForDate,
  getJakartaWeekBoundaries,
  type BatchWithKeywordsCount,
  type BatchScheduleSlotWithBatch,
  type BatchScheduleSettingsRecord,
  type ScheduledBatchResult,
} from "@/lib/keyword-batches";
import { cn } from "@/lib/utils";

interface OverviewActiveBatchWidgetProps {
  batches: BatchWithKeywordsCount[];
  slots?: BatchScheduleSlotWithBatch[];
  scheduleSettings: BatchScheduleSettingsRecord;
  monthlyRunCount: number;
  scheduledBatchInfo?: ScheduledBatchResult<BatchWithKeywordsCount>;
  recentCheckRuns?: Array<{
    id: string;
    started_at: string;
    status: string;
    total: number;
    done: number;
  }>;
}

export function OverviewActiveBatchWidget({
  batches,
  scheduleSettings,
  monthlyRunCount,
  scheduledBatchInfo,
  recentCheckRuns = [],
}: OverviewActiveBatchWidgetProps) {
  const activeBatch = batches.find((b) => b.is_active);
  const now = new Date();
  const currentResolution =
    scheduledBatchInfo ??
    getScheduledBatchForDate(now, batches, scheduleSettings);
  const targetActiveBatch = currentResolution.batch ?? activeBatch;
  const currentWeekBounds = getJakartaWeekBoundaries(now);
  const maxRuns = scheduleSettings.max_runs_per_month || 4;
  const isAuto = scheduleSettings.mode === "auto";

  // Susun data 4 minggu jadwal turunan (Minggu berjalan + 3 minggu ke depan)
  const timelineWeeks = [0, 1, 2, 3].map((offset) => {
    const mondayMs =
      currentWeekBounds.startMs + offset * 7 * 24 * 60 * 60 * 1000;
    const mondayDate = new Date(mondayMs);
    const bounds = getJakartaWeekBoundaries(mondayDate);
    const resolution = getScheduledBatchForDate(
      mondayDate,
      batches,
      scheduleSettings
    );
    const isCurrentWeek = offset === 0;

    const runInWeek = (recentCheckRuns ?? []).find(
      (r) => r.started_at >= bounds.startIso && r.started_at <= bounds.endIso
    );

    return {
      offset,
      mondayDateString: bounds.mondayDateString,
      assignedBatch: resolution.batch,
      isCurrentWeek,
      isOverride: resolution.isOverride,
      runInWeek,
    };
  });

  const nextWeekScheduled = timelineWeeks[1]?.assignedBatch;

  return (
    <Card className="border-[var(--line)] shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold text-[var(--ink)]">
                Weekly Batch Rotation &amp; Schedule Status
              </CardTitle>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-semibold font-mono",
                  isAuto
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                )}
              >
                {isAuto ? "Auto Rotation Active" : "Manual Override"}
              </Badge>
            </div>
            <CardDescription className="mt-0.5">
              Automated 4-week Monday schedule rotations and current monthly scan allocation.
            </CardDescription>
          </div>

          <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1">
            <Link href="/keywords?tab=schedule">
              <span>Manage Batches &amp; Calendar</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Top Summary Row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Active Batch Now */}
          <div className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-hover)] p-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-xs font-bold text-sm"
              style={{
                backgroundColor: targetActiveBatch?.color || "var(--cite)",
              }}
            >
              <Layers className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                {currentResolution.isOverride ? "Override Active" : "Scheduled Batch This Week"}
              </div>
              <div className="font-bold text-sm text-[var(--ink)] truncate">
                {targetActiveBatch ? targetActiveBatch.name : "No Active Batch"}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {targetActiveBatch
                  ? `${targetActiveBatch.activeKeywords} active (${targetActiveBatch.totalKeywords} total)`
                  : "All keywords idle"}
              </div>
            </div>
          </div>

          {/* Schedule Mode & Next Run */}
          <div className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-hover)] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--none)] text-[var(--ink)] shadow-xs">
              <Clock className="h-5 w-5 text-[var(--cite)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Rotation Interval
              </div>
              <div className="font-bold text-sm text-[var(--ink)]">
                Every Monday · 00:00 WIB (01:00 UTC)
              </div>
              <div className="text-xs text-[var(--muted)] flex items-center gap-1 truncate">
                <Sparkles className="h-3 w-3 text-[var(--seen)] shrink-0" />
                <span className="truncate">
                  Next: {nextWeekScheduled ? nextWeekScheduled.name : "Upcoming Monday"} ({timelineWeeks[1]?.mondayDateString})
                </span>
              </div>
            </div>
          </div>

          {/* Monthly Run Quota Progress */}
          <div className="flex flex-col justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-hover)] p-3 space-y-1.5 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--muted)]">
                Monthly Run Allocation
              </span>
              <span className="font-mono font-bold text-[var(--ink)]">
                {monthlyRunCount} / {maxRuns} Runs
              </span>
            </div>
            <Progress
              value={monthlyRunCount}
              max={maxRuns}
              className="h-2 bg-[var(--line)]"
            />
            <div className="text-[11px] text-[var(--muted)] flex justify-between">
              <span>{Math.max(0, maxRuns - monthlyRunCount)} remaining this month</span>
              <span>{Math.round((monthlyRunCount / maxRuns) * 100)}% used</span>
            </div>
          </div>
        </div>

        {/* 4-Week Schedule Slot Timeline */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-[var(--muted)]">
            Upcoming 4-Week Schedule Rotation
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {timelineWeeks.map(({ offset, mondayDateString, assignedBatch, isCurrentWeek, runInWeek }) => (
              <div
                key={mondayDateString}
                className={cn(
                  "relative flex flex-col justify-between rounded-lg border p-3 transition-all",
                  isCurrentWeek
                    ? "border-[var(--cite)] bg-[var(--cite-bg)]/25 ring-2 ring-[var(--cite)]/30 shadow-xs"
                    : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-[var(--muted)] uppercase font-mono">
                    {isCurrentWeek ? "This Week" : `+${offset} Week`} ({mondayDateString.slice(5)})
                  </span>
                  {runInWeek ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
                    >
                      {runInWeek.status === "done"
                        ? `${runInWeek.done} checks`
                        : `${runInWeek.status}`}
                    </Badge>
                  ) : isCurrentWeek ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold border-[var(--cite)] text-[var(--cite)] bg-white/60 dark:bg-black/20"
                    >
                      <Zap className="h-2.5 w-2.5 mr-1 fill-current" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-[var(--muted)]">
                      Upcoming
                    </Badge>
                  )}
                </div>

                <div className="space-y-1">
                  {assignedBatch ? (
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: assignedBatch.color || "var(--cite)",
                        }}
                      />
                      <span className="font-bold text-xs text-[var(--ink)] truncate">
                        {assignedBatch.name}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--muted)] italic">
                      No batch assigned
                    </span>
                  )}

                  <div className="text-[11px] text-[var(--muted)] font-mono">
                    {assignedBatch
                      ? `${assignedBatch.activeKeywords} keywords`
                      : "0 keywords"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
