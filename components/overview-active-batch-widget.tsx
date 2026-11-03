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
  getSlotWeekNumber,
  type BatchWithKeywordsCount,
  type BatchScheduleSlotWithBatch,
  type BatchScheduleSettingsRecord,
} from "@/lib/keyword-batches";
import { cn } from "@/lib/utils";

interface OverviewActiveBatchWidgetProps {
  batches: BatchWithKeywordsCount[];
  slots: BatchScheduleSlotWithBatch[];
  scheduleSettings: BatchScheduleSettingsRecord;
  monthlyRunCount: number;
}

export function OverviewActiveBatchWidget({
  batches,
  slots,
  scheduleSettings,
  monthlyRunCount,
}: OverviewActiveBatchWidgetProps) {
  const activeBatch = batches.find((b) => b.is_active);
  const currentSlotWeek = getSlotWeekNumber(new Date());
  const maxRuns = scheduleSettings.max_runs_per_month || 4;
  const isAuto = scheduleSettings.mode === "auto";

  // Susun data 4 slot mingguan (Slot 1..4)
  const slotMap = new Map<number, BatchScheduleSlotWithBatch>();
  for (const s of slots) {
    slotMap.set(s.week_number, s);
  }

  const slotWeeks = [1, 2, 3, 4].map((num) => {
    const slot = slotMap.get(num);
    const assignedBatch = slot?.batch_id
      ? batches.find((b) => b.id === slot.batch_id)
      : null;
    const isCurrentWeek = currentSlotWeek === num;

    return {
      slotNumber: num,
      assignedBatch,
      isCurrentWeek,
    };
  });

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
                backgroundColor: activeBatch?.color || "var(--cite)",
              }}
            >
              <Layers className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Active Batch Now
              </div>
              <div className="font-bold text-sm text-[var(--ink)] truncate">
                {activeBatch ? activeBatch.name : "No Active Batch"}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {activeBatch ? `${activeBatch.activeKeywords} active (${activeBatch.totalKeywords} total)` : "All keywords idle"}
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
                Every Monday · 01:00 UTC
              </div>
              <div className="text-xs text-[var(--muted)] flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-[var(--seen)]" />
                <span>Next slot: Week {currentSlotWeek === 4 ? 1 : currentSlotWeek + 1}</span>
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
            Monthly 4-Week Rotation Timeline
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {slotWeeks.map(({ slotNumber, assignedBatch, isCurrentWeek }) => (
              <div
                key={slotNumber}
                className={cn(
                  "relative flex flex-col justify-between rounded-lg border p-3 transition-all",
                  isCurrentWeek
                    ? "border-[var(--cite)] bg-[var(--cite-bg)]/25 ring-2 ring-[var(--cite)]/30 shadow-xs"
                    : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-[var(--muted)] uppercase font-mono">
                    Week {slotNumber}
                  </span>
                  {isCurrentWeek ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold border-[var(--cite)] text-[var(--cite)] bg-white/60 dark:bg-black/20"
                    >
                      <Zap className="h-2.5 w-2.5 mr-1 fill-current" />
                      Current
                    </Badge>
                  ) : null}
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
