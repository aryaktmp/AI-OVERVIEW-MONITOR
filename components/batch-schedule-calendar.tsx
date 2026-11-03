"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sliders,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  rotateBatchNowAction,
  overrideActiveBatchAction,
  updateBatchScheduleModeAction,
  toggleBatchEnabledAction,
  createBatchAction,
  assignBatchToSlotAction,
  resetSlotsToDefaultAction,
  getSelectableKeywordsAction,
} from "@/app/(dashboard)/actions";
import {
  KeywordMultiSelectDropdown,
  type SelectableKeyword,
} from "@/components/keyword-multi-select-dropdown";
import {
  getActiveWeekOfMonth,
  getSlotWeekNumber,
  getMondaysInMonth,
  getMondayOccurrenceOfMonth,
  type BatchWithKeywordsCount,
  type BatchScheduleSettingsRecord,
  type BatchScheduleSlotWithBatch,
  type BatchAuditLogRecord,
} from "@/lib/keyword-batches";

interface BatchScheduleCalendarProps {
  initialBatches: BatchWithKeywordsCount[];
  initialSlots: BatchScheduleSlotWithBatch[];
  initialSettings: BatchScheduleSettingsRecord;
  monthlyRunCount: number;
  initialAuditLogs: BatchAuditLogRecord[];
  availableKeywords?: SelectableKeyword[];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PRESET_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#6366f1", // Indigo
];

export function BatchScheduleCalendar({
  initialBatches,
  initialSlots,
  initialSettings,
  monthlyRunCount,
  initialAuditLogs,
  availableKeywords = [],
}: BatchScheduleCalendarProps) {
  const [batches, setBatches] = useState<BatchWithKeywordsCount[]>(initialBatches);
  const [slots, setSlots] = useState<BatchScheduleSlotWithBatch[]>(initialSlots);
  const [settings, setSettings] = useState<BatchScheduleSettingsRecord>(initialSettings);
  const [auditLogs] = useState<BatchAuditLogRecord[]>(initialAuditLogs);

  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // Dialog states
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [selectedOverrideBatchId, setSelectedOverrideBatchId] = useState("");
  const [overrideFreezeMode, setOverrideFreezeMode] = useState(false);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [newBatchDescription, setNewBatchDescription] = useState("");
  const [newBatchColor, setNewBatchColor] = useState(PRESET_COLORS[0]);
  const [newBatchKeywords, setNewBatchKeywords] = useState("");

  // Keywords for multi-select dropdown
  const [allKeywords, setAllKeywords] = useState<SelectableKeyword[]>(availableKeywords);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<string[]>([]);
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false);

  useEffect(() => {
    if (availableKeywords && availableKeywords.length > 0) {
      setAllKeywords(availableKeywords);
    }
  }, [availableKeywords]);

  useEffect(() => {
    if (showCreateDialog && allKeywords.length === 0 && !isLoadingKeywords) {
      setIsLoadingKeywords(true);
      getSelectableKeywordsAction()
        .then((kws) => setAllKeywords(kws))
        .catch((err) => console.error("Failed to load selectable keywords:", err))
        .finally(() => setIsLoadingKeywords(false));
    }
  }, [showCreateDialog, allKeywords.length, isLoadingKeywords]);

  const parsedKeywordCount = useMemo(() => {
    if (!newBatchKeywords.trim()) return 0;
    const items = newBatchKeywords
      .split(/[\r\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2 && k.length <= 200);
    return new Set(items.map((k) => k.toLowerCase())).size;
  }, [newBatchKeywords]);

  // Audit trail accordion
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  const [now] = useState(() => new Date());
  const [viewDate, setViewDate] = useState(() => new Date());

  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth();
  const currentDay = now.getDate();

  const viewYear = viewDate.getFullYear();
  const viewMonthIdx = viewDate.getMonth();
  const isViewingCurrentMonth =
    viewYear === currentYear && viewMonthIdx === currentMonthIdx;

  const currentActiveWeek = getSlotWeekNumber(now);
  const mondayInfo = useMemo(() => getMondayOccurrenceOfMonth(now), [now]);

  const activeBatch = batches.find((b) => b.is_active) ?? null;
  const hasEmptyActiveBatch = Boolean(activeBatch && activeBatch.activeKeywords === 0);

  // Month navigation handlers
  function handlePrevMonth() {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function handleNextMonth() {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  function handleToday() {
    setViewDate(new Date());
  }

  function handleSelectMonth(monthIdx: number) {
    setViewDate((prev) => new Date(prev.getFullYear(), monthIdx, 1));
  }

  function handleSelectYear(year: number) {
    setViewDate((prev) => new Date(year, prev.getMonth(), 1));
  }

  // Generate calendar days for viewed month & year
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(viewYear, viewMonthIdx + 1, 0).getDate();
    const firstDayIndex = new Date(viewYear, viewMonthIdx, 1).getDay(); // 0 is Sun, 1 is Mon
    // Shift so Mon is 0, Sun is 6
    const startOffset = (firstDayIndex + 6) % 7;

    const days: Array<{
      dayNumber: number;
      weekNumber: number;
      isToday: boolean;
      isMonday: boolean;
      slot: BatchScheduleSlotWithBatch | undefined;
      batchColor: string;
      batchName: string;
    }> = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(viewYear, viewMonthIdx, d);
      const dayOfWeek = (dateObj.getDay() + 6) % 7; // 0 = Mon
      const weekNum = getActiveWeekOfMonth(dateObj);

      let slot: BatchScheduleSlotWithBatch | undefined;
      let batchColor: string;
      let batchName: string;

      if (weekNum === 0) {
        // Pra-siklus sebelum hari Senin pertama
        slot = undefined;
        batchColor = "var(--line)";
        batchName = "Prior Cycle";
      } else {
        const slotWeek = weekNum > 4 ? ((weekNum - 1) % 4) + 1 : weekNum;
        slot = slots.find((s) => s.week_number === slotWeek);
        batchColor = slot?.batch?.color || "#6366f1";
        batchName = slot?.batch?.name || "Unassigned";
      }

      const isToday = isViewingCurrentMonth && d === currentDay;

      days.push({
        dayNumber: d,
        weekNumber: weekNum,
        isToday,
        isMonday: dayOfWeek === 0,
        slot,
        batchColor,
        batchName,
      });
    }

    return { days, startOffset, daysInMonth };
  }, [viewYear, viewMonthIdx, isViewingCurrentMonth, currentDay, slots]);

  // Action handlers
  function handleRotateNow() {
    setFeedback(null);
    setPendingAction("rotate");
    startTransition(async () => {
      try {
        const res = await rotateBatchNowAction();
        if (res.status === "rotated") {
          setFeedback({
            type: "success",
            text: `Rotated active batch to ${res.newBatch?.name ?? "next batch"}. ${res.message}`,
          });
          if (res.newBatch) {
            setBatches((prev) =>
              prev.map((b) => ({
                ...b,
                is_active: b.id === res.newBatch?.id,
              }))
            );
          }
        } else {
          setFeedback({
            type: "error",
            text: res.message,
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to rotate active batch.",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleModeToggle(checked: boolean) {
    const nextMode = checked ? "auto" : "manual_frozen";
    setFeedback(null);
    setPendingAction("mode");
    startTransition(async () => {
      try {
        const res = await updateBatchScheduleModeAction(nextMode);
        if (res.ok) {
          setSettings(res.settings);
          setFeedback({
            type: "success",
            text: `Schedule mode updated to '${nextMode === "auto" ? "Automatic Rotation" : "Manual Frozen"}'.`,
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to update schedule mode.",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleSlotAssignment(weekNumber: number, batchId: string | null) {
    setFeedback(null);
    setPendingAction(`slot-${weekNumber}`);
    startTransition(async () => {
      try {
        const res = await assignBatchToSlotAction(weekNumber, batchId, true);
        if (res.ok) {
          setFeedback({ type: "success", text: res.message });
          // Update local state
          const targetBatch = batches.find((b) => b.id === batchId) ?? null;
          setSlots((prev) =>
            prev.map((s) =>
              s.week_number === weekNumber
                ? {
                    ...s,
                    batch_id: batchId,
                    is_override: true,
                    batch: targetBatch,
                  }
                : s
            )
          );
          // If current week, reflect active batch
          if (weekNumber === currentActiveWeek && targetBatch && settings.mode !== "manual_frozen") {
            setBatches((prev) =>
              prev.map((b) => ({
                ...b,
                is_active: b.id === targetBatch.id,
              }))
            );
          }
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to assign batch to slot.",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleResetSlots() {
    setFeedback(null);
    setPendingAction("reset");
    startTransition(async () => {
      try {
        const res = await resetSlotsToDefaultAction();
        if (res.ok) {
          setFeedback({
            type: "success",
            text: res.message,
          });
          // Update slots local state to non-override
          setSlots((prev) =>
            prev.map((s) => ({
              ...s,
              is_override: false,
            }))
          );
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to reset slots.",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleToggleEnabled(batch: BatchWithKeywordsCount) {
    const nextVal = !batch.is_enabled;
    setFeedback(null);
    setPendingAction(`batch-toggle-${batch.id}`);
    startTransition(async () => {
      try {
        const res = await toggleBatchEnabledAction(batch.id, nextVal);
        if (res.ok) {
          setBatches((prev) =>
            prev.map((b) => (b.id === batch.id ? { ...b, is_enabled: nextVal } : b))
          );
          setFeedback({
            type: "success",
            text: `Batch ${batch.name} is now ${nextVal ? "enabled for rotation" : "disabled from rotation"}.`,
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to toggle batch status.",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleCreateBatch() {
    if (!newBatchName.trim()) return;
    setFeedback(null);
    setPendingAction("create");
    startTransition(async () => {
      try {
        const res = await createBatchAction(
          newBatchName.trim(),
          newBatchDescription.trim() || undefined,
          newBatchColor,
          selectedKeywordIds,
          newBatchKeywords.trim() || undefined
        );
        if (res.ok && res.batch) {
          const addedCount = res.keywordsCount ?? 0;
          const newBatchItem: BatchWithKeywordsCount = {
            ...res.batch,
            color: newBatchColor,
            totalKeywords: addedCount,
            activeKeywords: addedCount,
          };
          setBatches((prev) => [...prev, newBatchItem]);

          // Update local keywords to mark selected ones as assigned to this new batch
          if (selectedKeywordIds.length > 0) {
            setAllKeywords((prev) =>
              prev.map((k) =>
                selectedKeywordIds.includes(k.id)
                  ? { ...k, batch_id: res.batch.id, batch_name: res.batch.name }
                  : k
              )
            );
          }

          setShowCreateDialog(false);
          setNewBatchName("");
          setNewBatchDescription("");
          setSelectedKeywordIds([]);
          setNewBatchKeywords("");
          const countInfo = addedCount > 0 ? ` with ${addedCount} keyword(s)` : "";
          setFeedback({
            type: "success",
            text: `Batch '${newBatchItem.name}' created successfully${countInfo}.`,
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to create batch.",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleApplyOverride() {
    if (!selectedOverrideBatchId) return;
    setFeedback(null);
    setPendingAction("override");
    startTransition(async () => {
      try {
        const res = await overrideActiveBatchAction(selectedOverrideBatchId, overrideFreezeMode);
        if (res.ok) {
          setBatches((prev) =>
            prev.map((b) => ({
              ...b,
              is_active: b.id === selectedOverrideBatchId,
            }))
          );
          if (overrideFreezeMode) {
            setSettings((prev) => ({ ...prev, mode: "manual_frozen" }));
          }
          setShowOverrideDialog(false);
          setFeedback({
            type: "success",
            text: res.message,
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to override active batch.",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  // Week date range helper: dihitung dari hari Senin s/d Minggu untuk bulan yang sedang dilihat
  function getWeekDateRange(weekNum: number, yr = viewYear, mo = viewMonthIdx): string {
    const month = MONTH_NAMES[mo];
    const mondays = getMondaysInMonth(yr, mo);
    if (weekNum < 1 || weekNum > mondays.length) {
      return `${month} Week ${weekNum}`;
    }
    const startMon = mondays[weekNum - 1]!;
    const endSun = startMon + 6;
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();

    if (endSun <= daysInMonth) {
      return `${month} ${startMon} – ${endSun}`;
    }
    return `${month} ${startMon} – ${daysInMonth}`;
  }

  return (
    <div className="space-y-6">
      {/* Feedback Alert */}
      {feedback && (
        <Alert
          className={
            feedback.type === "success"
              ? "border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300"
              : "border-red-500/20 bg-red-50/60 dark:bg-red-950/20 text-red-800 dark:text-red-300"
          }
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          )}
          <AlertDescription className="text-xs font-medium">{feedback.text}</AlertDescription>
        </Alert>
      )}

      {/* Empty Active Batch Warning Alert */}
      {hasEmptyActiveBatch && (
        <Alert className="border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-xs font-medium">
            <strong>Warning:</strong> Active batch <strong>{activeBatch?.name}</strong> currently has 0 active keywords. Keyword checks on SerpApi will scan 0 queries until keywords are assigned to this batch.
          </AlertDescription>
        </Alert>
      )}

      {/* Top Status & Controls Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: Active Batch */}
        <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              Active Batch on Search
            </CardDescription>
            <CardTitle className="text-base font-bold flex items-center justify-between">
              <span className="flex items-center gap-2 truncate">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: activeBatch?.color || "#3b82f6" }}
                />
                <span className="truncate">{activeBatch?.name ?? "No Batch Active"}</span>
              </span>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xs text-[var(--muted)] flex items-center justify-between">
              <span>{activeBatch?.activeKeywords ?? 0} active keywords</span>
              <Badge variant="outline" className="text-[10px] font-medium border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10">
                Live on SerpApi
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Current Calendar Week & Monday Detection */}
        <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
              <span>Current Calendar Week</span>
              {mondayInfo.isMonday && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[9px] font-bold px-1.5 py-0">
                  Monday Cron Day
                </Badge>
              )}
            </CardDescription>
            <CardTitle className="text-base font-bold flex items-center gap-1.5 text-[var(--ink)]">
              <CalendarIcon className="h-4 w-4 text-[var(--cite)]" />
              Week {currentActiveWeek} of {mondayInfo.totalMondays}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xs text-[var(--muted)] flex items-center justify-between">
              <span className="truncate font-medium">{mondayInfo.label}</span>
              <span className="text-[11px] font-semibold text-[var(--cite)] shrink-0 ml-1">
                Day {currentDay}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Monthly Executions (Unlimited Cap) */}
        <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
              <span>Monthly Executions</span>
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Unlimited Cap</span>
            </CardDescription>
            <CardTitle className="text-base font-bold flex items-center justify-between text-[var(--ink)]">
              <span>{monthlyRunCount} Runs Completed</span>
              <span className="text-xs font-semibold text-[var(--muted)]">
                Every Monday
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            <div className="text-xs text-[var(--muted)] flex items-center justify-between">
              <span>Trigger: Monday 00:00 UTC</span>
              <span className="font-medium text-[var(--ink)]">{MONTH_NAMES[currentMonthIdx]}</span>
            </div>
            <div className="text-[10px] text-[var(--muted)] truncate">
              Sequential rotation runs without monthly limits
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Mode Control */}
        <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              Schedule Rotation Mode
            </CardDescription>
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="truncate">
                {settings.mode === "auto" ? "Automatic Rotation" : "Manual Frozen"}
              </span>
              <Switch
                checked={settings.mode === "auto"}
                onCheckedChange={handleModeToggle}
                disabled={isPending}
                aria-label="Toggle auto schedule mode"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-[11px] text-[var(--muted)] truncate">
              {settings.mode === "auto"
                ? "Rotates every Monday according to slot schedule"
                : "Automatic rotation is frozen until toggled on"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRotateNow}
            disabled={isPending}
            className="cursor-pointer font-semibold shadow-xs"
          >
            {pendingAction === "rotate" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin text-[var(--cite)]" />
                Rotating...
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Rotate Next Now
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSelectedOverrideBatchId(activeBatch?.id ?? batches[0]?.id ?? "");
              setOverrideFreezeMode(settings.mode === "manual_frozen");
              setShowOverrideDialog(true);
            }}
            disabled={isPending}
            className="cursor-pointer text-xs shadow-xs"
          >
            <Sliders className="h-3.5 w-3.5 mr-1.5 text-[var(--cite)]" />
            Manual Override
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetSlots}
            disabled={isPending}
            className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            title="Reset custom slot assignments to automatic sequence"
          >
            {pendingAction === "reset" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin text-[var(--cite)]" />
                Resetting...
              </>
            ) : (
              <>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reset Slots to Default
              </>
            )}
          </Button>
        </div>

        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setShowCreateDialog(true)}
          disabled={isPending}
          className="cursor-pointer font-semibold shadow-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create New Batch
        </Button>
      </div>

      {/* Visual Monthly Calendar Grid (Kalender Monitoring Semua Bulan & Tahun) */}
      <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
        <CardHeader className="pb-3 border-b border-[var(--line)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex flex-wrap items-center gap-2 text-[var(--ink)]">
                <CalendarIcon className="h-4 w-4 text-[var(--cite)]" />
                <span>
                  {MONTH_NAMES[viewMonthIdx]} {viewYear} Rotation Calendar
                </span>
                {!isViewingCurrentMonth && (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-[var(--muted)] border-[var(--line)]"
                  >
                    Viewing {viewYear > currentYear || (viewYear === currentYear && viewMonthIdx > currentMonthIdx) ? "Future" : "Past"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs text-[var(--muted)]">
                Interactive schedule map. Every Monday represents a weekly run execution. Cycles run Monday through Sunday.
              </CardDescription>
            </div>

            {/* Navigation Toolbar (Prev / Today / Next & Month / Year Selectors) */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-md border border-[var(--line)] bg-[var(--surface)] p-0.5 shadow-2xs">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handlePrevMonth}
                  disabled={isPending}
                  className="h-7 w-7 p-0 cursor-pointer text-[var(--ink)] hover:text-[var(--cite)]"
                  title="Previous Month"
                  aria-label="Previous Month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleToday}
                  disabled={isPending || isViewingCurrentMonth}
                  className={`h-7 px-2.5 text-xs font-semibold cursor-pointer ${
                    isViewingCurrentMonth
                      ? "text-[var(--cite)] font-bold bg-[var(--cite)]/10"
                      : "text-[var(--ink)] hover:text-[var(--cite)]"
                  }`}
                  title="Jump to Current Month"
                >
                  Today
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleNextMonth}
                  disabled={isPending}
                  className="h-7 w-7 p-0 cursor-pointer text-[var(--ink)] hover:text-[var(--cite)]"
                  title="Next Month"
                  aria-label="Next Month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Month Dropdown */}
              <select
                value={viewMonthIdx}
                onChange={(e) => handleSelectMonth(Number(e.target.value))}
                disabled={isPending}
                aria-label="Select calendar month"
                className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-semibold text-[var(--ink)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--cite)]"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>

              {/* Year Dropdown */}
              <select
                value={viewYear}
                onChange={(e) => handleSelectYear(Number(e.target.value))}
                disabled={isPending}
                aria-label="Select calendar year"
                className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-semibold text-[var(--ink)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--cite)]"
              >
                {Array.from({ length: 9 }, (_, i) => currentYear - 2 + i).map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Color Legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-3 mt-1 border-t border-[var(--line)]/50">
            <div className="flex flex-wrap items-center gap-3">
              {slots.map((s) => (
                <div key={s.week_number} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: s.batch?.color || "#94a3b8" }}
                  />
                  <span className="font-medium text-[var(--ink)]">
                    W{s.week_number}: {s.batch?.name ?? "Unassigned"}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[var(--muted)]">
              <span className="h-2.5 w-2.5 rounded-xs border border-dashed border-[var(--muted)]" />
              <span>Prior: Days before 1st Monday</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-1.5 text-center">
            {WEEKDAY_NAMES.map((name, i) => (
              <div
                key={name}
                className={`py-1 text-[11px] font-bold uppercase tracking-wider ${
                  i === 0 ? "text-[var(--cite)]" : "text-[var(--muted)]"
                }`}
              >
                {name}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {/* Blank offset days */}
            {Array.from({ length: calendarDays.startOffset }).map((_, idx) => (
              <div
                key={`offset-${idx}`}
                className="h-16 rounded-md bg-[var(--none)]/40 border border-transparent"
              />
            ))}

            {/* Days in Month */}
            {calendarDays.days.map((item) => {
              const isCurrentWeek = item.weekNumber === currentActiveWeek;
              const isPreCycle = item.weekNumber === 0;

              return (
                <div
                  key={`day-${item.dayNumber}`}
                  className={`relative h-16 rounded-md p-1.5 border transition-all flex flex-col justify-between ${
                    item.isToday
                      ? "border-[var(--cite)] ring-2 ring-[var(--cite)]/30 bg-[var(--surface)] shadow-xs"
                      : isPreCycle
                      ? "border-dashed border-[var(--line)] bg-[var(--surface)]/40 opacity-75"
                      : "border-[var(--line)] bg-[var(--surface)]/70 hover:border-[var(--muted)]"
                  }`}
                  style={{
                    borderLeftWidth: "4px",
                    borderLeftColor: isPreCycle ? "var(--line)" : item.batchColor,
                  }}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`text-xs font-semibold leading-none ${
                        item.isToday
                          ? "bg-[var(--cite)] text-white px-1.5 py-0.5 rounded-full font-bold"
                          : isPreCycle
                          ? "text-[var(--muted)]"
                          : "text-[var(--ink)]"
                      }`}
                    >
                      {item.dayNumber}
                    </span>

                    {item.isMonday && (
                      <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.2 text-[9px] font-bold bg-[var(--cite)]/15 text-[var(--cite)]">
                        Run
                      </span>
                    )}

                    {isPreCycle && (
                      <span className="inline-flex items-center rounded px-1 py-0.2 text-[8px] font-medium text-[var(--muted)] border border-[var(--line)]">
                        Prior
                      </span>
                    )}
                  </div>

                  <div className="truncate text-[10px]">
                    <span
                      className="inline-block truncate max-w-full font-medium"
                      style={{ color: isPreCycle ? "var(--muted)" : item.batchColor }}
                      title={isPreCycle ? "Prior Cycle before 1st Monday" : `Week ${item.weekNumber}: ${item.batchName}`}
                    >
                      {item.batchName}
                    </span>
                  </div>

                  {isCurrentWeek && !isPreCycle && (
                    <span className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full bg-emerald-500 m-1" />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 4 Weekly Schedule Slot Cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold tracking-tight text-[var(--ink)] flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-[var(--cite)]" />
              4-Week Schedule Slot Assignments ({MONTH_NAMES[viewMonthIdx]} {viewYear})
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Customize which batch runs each week of the month. Slot changes apply automatically.
            </p>
          </div>
          <span className="text-xs font-medium text-[var(--muted)]">
            Cycle: Week 1 &rarr; Week 2 &rarr; Week 3 &rarr; Week 4
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {slots.map((slot) => {
            const isCurrent =
              isViewingCurrentMonth && slot.week_number === currentActiveWeek;
            const isPast =
              viewYear < currentYear ||
              (viewYear === currentYear && viewMonthIdx < currentMonthIdx) ||
              (isViewingCurrentMonth && slot.week_number < currentActiveWeek);
            const assignedBatch = batches.find((b) => b.id === slot.batch_id);

            return (
              <Card
                key={slot.week_number}
                className={`relative border transition-all shadow-xs ${
                  isCurrent
                    ? "border-[var(--cite)] ring-2 ring-[var(--cite)]/20 bg-[var(--surface)]"
                    : "border-[var(--line)] bg-[var(--surface)]"
                }`}
              >
                <div
                  className="h-1.5 w-full rounded-t-md"
                  style={{ backgroundColor: assignedBatch?.color || "#94a3b8" }}
                />

                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                      Week {slot.week_number}
                    </span>
                    {isCurrent ? (
                      <Badge className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0">
                        Active Now
                      </Badge>
                    ) : isPast ? (
                      <Badge variant="none" className="text-[10px]">
                        Past
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-[var(--muted)]">
                        Upcoming
                      </Badge>
                    )}
                  </div>

                  <CardTitle className="text-sm font-bold text-[var(--ink)] mt-1">
                    {getWeekDateRange(slot.week_number, viewYear, viewMonthIdx)}
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-4 pt-1 space-y-3">
                  {/* Select Batch Dropdown */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-[var(--muted)] font-medium">
                        Assigned Batch
                      </Label>
                      {pendingAction === `slot-${slot.week_number}` && (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--cite)] font-mono">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Saving...
                        </span>
                      )}
                    </div>
                    <select
                      value={slot.batch_id ?? ""}
                      onChange={(e) =>
                        handleSlotAssignment(
                          slot.week_number,
                          e.target.value ? e.target.value : null
                        )
                      }
                      disabled={isPending}
                      aria-label={`Assign batch for Week ${slot.week_number}`}
                      className="w-full h-8.5 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-xs font-medium text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--cite)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">(Unassigned)</option>
                      {batches
                        .filter((b) => b.is_enabled)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.activeKeywords} kw)
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Batch Details */}
                  {assignedBatch ? (
                    <div className="rounded-md border border-[var(--line)] bg-[var(--bg)]/50 p-2 space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium text-[var(--ink)]">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: assignedBatch.color || "#3b82f6" }}
                          />
                          <span className="font-semibold truncate max-w-[110px]">
                            {assignedBatch.name}
                          </span>
                        </span>
                        <span className="text-[11px] text-[var(--muted)] font-mono">
                          {assignedBatch.activeKeywords}/{assignedBatch.totalKeywords} kw
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-[var(--line)] p-2 text-center text-xs text-[var(--muted)]">
                      No batch assigned
                    </div>
                  )}

                  {/* Override Indicator */}
                  {slot.is_override && (
                    <div className="flex items-center justify-between pt-1">
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10"
                      >
                        Custom Override
                      </Badge>
                      <button
                        type="button"
                        onClick={() => handleSlotAssignment(slot.week_number, null)}
                        disabled={isPending}
                        className="text-[10px] text-[var(--muted)] hover:text-[var(--ink)] underline cursor-pointer inline-flex items-center gap-1"
                      >
                        {pendingAction === `slot-${slot.week_number}` && (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        )}
                        Reset Slot
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Batch Entities Management Table */}
      <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
        <CardHeader className="pb-3 border-b border-[var(--line)] flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-[var(--ink)]">
              All Batches ({batches.length})
            </CardTitle>
            <CardDescription className="text-xs text-[var(--muted)]">
              Manage batches, toggle their inclusion in automatic rotation, or manually activate a batch instantly.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCreateDialog(true)}
            disabled={isPending}
            className="cursor-pointer font-semibold text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Batch
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Batch Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Keywords</TableHead>
                <TableHead>Assigned Slot(s)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[120px]">Auto Rotation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => {
                const assignedWeeks = slots
                  .filter((s) => s.batch_id === batch.id)
                  .map((s) => `Week ${s.week_number}`);

                return (
                  <TableRow key={batch.id}>
                    <TableCell>
                      <span
                        className="h-3 w-3 rounded-full inline-block"
                        style={{ backgroundColor: batch.color || "#6366f1" }}
                      />
                    </TableCell>
                    <TableCell className="font-semibold text-[var(--ink)]">
                      {batch.name}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--muted)] max-w-[200px] truncate">
                      {batch.description || "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      <span className="font-semibold text-[var(--ink)]">{batch.activeKeywords}</span>
                      <span className="text-[var(--muted)]"> / {batch.totalKeywords} active</span>
                      {batch.activeKeywords === 0 && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10 text-[9px] font-semibold py-0 px-1"
                        >
                          Empty
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {assignedWeeks.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {assignedWeeks.map((w) => (
                            <Badge
                              key={w}
                              variant="outline"
                              className="text-[10px] font-medium border-[var(--line)]"
                            >
                              {w}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {batch.is_active ? (
                        <Badge className="bg-emerald-500 text-white font-bold text-[10px]">
                          Active Now
                        </Badge>
                      ) : batch.is_enabled ? (
                        <Badge variant="outline" className="text-[10px] text-[var(--muted)]">
                          Scheduled
                        </Badge>
                      ) : (
                        <Badge variant="none" className="text-[10px]">
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={batch.is_enabled}
                          onCheckedChange={() => handleToggleEnabled(batch)}
                          disabled={isPending || batch.is_active}
                          aria-label={`Toggle auto-rotation for ${batch.name}`}
                        />
                        {pendingAction === `batch-toggle-${batch.id}` && (
                          <Loader2 className="h-3 w-3 animate-spin text-[var(--cite)]" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {!batch.is_active && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedOverrideBatchId(batch.id);
                            setOverrideFreezeMode(false);
                            setShowOverrideDialog(true);
                          }}
                          disabled={isPending}
                          className="cursor-pointer text-xs h-7 px-2.5 font-medium"
                        >
                          <Sparkles className="h-3 w-3 mr-1 text-[var(--cite)]" />
                          Activate Now
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Audit Trail Log Accordion */}
      <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
        <CardHeader
          className="py-3 px-4 cursor-pointer hover:bg-[var(--bg)]/40 transition-colors"
          onClick={() => setShowAuditLogs((prev) => !prev)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--muted)]" />
              <CardTitle className="text-sm font-semibold text-[var(--ink)]">
                Rotation & Slot Assignment Audit Trail ({auditLogs.length} events)
              </CardTitle>
            </div>
            {showAuditLogs ? (
              <ChevronDown className="h-4 w-4 text-[var(--muted)]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
            )}
          </div>
        </CardHeader>

        {showAuditLogs && (
          <CardContent className="p-0 border-t border-[var(--line)]">
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[170px]">Timestamp (WIB)</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Details / Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-xs text-[var(--muted)] py-6">
                        No audit events recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs.map((log) => {
                      const dateStr = new Date(log.created_at).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      });

                      return (
                        <TableRow key={log.id} className="text-xs">
                          <TableCell className="font-mono text-[var(--muted)]">{dateStr}</TableCell>
                          <TableCell>
                            {log.trigger_type === "empty_batch_warning" ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold"
                              >
                                Empty Batch Warning
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] font-mono">
                                {log.trigger_type}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-medium text-[var(--ink)]">
                            {log.actor_id}
                          </TableCell>
                          <TableCell className="text-[var(--ink)]">{log.notes || "—"}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Manual Override Modal Dialog */}
      <Dialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[var(--cite)]" />
              Manual Batch Override
            </DialogTitle>
            <DialogDescription className="text-xs">
              Directly activate a specific keyword batch. Only keywords from the active batch will be checked during the next run.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="override-batch-select" className="text-xs font-semibold">
                Select Target Batch
              </Label>
              <select
                id="override-batch-select"
                value={selectedOverrideBatchId}
                onChange={(e) => setSelectedOverrideBatchId(e.target.value)}
                className="w-full h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--cite)] cursor-pointer"
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.activeKeywords} active keywords) {b.is_active ? "(Active)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="freeze-mode-switch" className="text-xs font-semibold text-[var(--ink)]">
                    Freeze Automatic Schedule
                  </Label>
                  <p className="text-[11px] text-[var(--muted)]">
                    Switch mode to <strong>manual_frozen</strong> to prevent automatic Monday rotations until toggled back.
                  </p>
                </div>
                <Switch
                  id="freeze-mode-switch"
                  checked={overrideFreezeMode}
                  onCheckedChange={setOverrideFreezeMode}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowOverrideDialog(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleApplyOverride}
              disabled={isPending || !selectedOverrideBatchId}
            >
              {pendingAction === "override" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Applying Override...
                </>
              ) : (
                "Apply Override"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create New Batch Dialog */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) {
            setNewBatchName("");
            setNewBatchDescription("");
            setSelectedKeywordIds([]);
            setNewBatchKeywords("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-[var(--cite)]" />
              Create New Keyword Batch
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add a new batch to group keywords and schedule their rotation in the monthly 4-week cycle.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-batch-name" className="text-xs font-semibold">
                Batch Name
              </Label>
              <Input
                id="new-batch-name"
                value={newBatchName}
                onChange={(e) => setNewBatchName(e.target.value)}
                placeholder="e.g. Batch 4 - Core Recruitment"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-batch-desc" className="text-xs font-semibold">
                Description (Optional)
              </Label>
              <Input
                id="new-batch-desc"
                value={newBatchDescription}
                onChange={(e) => setNewBatchDescription(e.target.value)}
                placeholder="Brief purpose or category notes"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Badge Color</Label>
              <div className="flex items-center gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewBatchColor(c)}
                    className={`h-6 w-6 rounded-full cursor-pointer transition-transform ${
                      newBatchColor === c ? "scale-125 ring-2 ring-[var(--ink)] ring-offset-2" : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Multi-Select Dropdown for Existing Keywords */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Select Existing Keywords
                </Label>
                <span className="text-[11px] text-[var(--muted)]">
                  Only unassigned keywords can be selected
                </span>
              </div>
              <KeywordMultiSelectDropdown
                keywords={allKeywords}
                selectedIds={selectedKeywordIds}
                onChange={setSelectedKeywordIds}
                disabled={isPending}
                isLoading={isLoadingKeywords}
                placeholder="Choose unassigned keywords..."
              />
              <p className="text-[11px] text-[var(--muted)]">
                Keywords already assigned to another batch are locked and cannot be selected.
              </p>
            </div>

            {/* Optional: Add Brand New Keywords */}
            <div className="space-y-1.5 pt-2 border-t border-[var(--line)]/50">
              <div className="flex items-center justify-between">
                <Label htmlFor="new-batch-keywords" className="text-xs font-semibold">
                  Or Add Brand New Keywords (Optional)
                </Label>
                {parsedKeywordCount > 0 && (
                  <Badge variant="outline" className="text-[10px] font-mono text-[var(--cite)] border-[var(--cite)]/30">
                    {parsedKeywordCount} new keyword{parsedKeywordCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <Textarea
                id="new-batch-keywords"
                value={newBatchKeywords}
                onChange={(e) => setNewBatchKeywords(e.target.value)}
                placeholder={"software hris terbaik\naplikasi payroll online\nsistem manajemen sdm"}
                rows={3}
                className="font-mono text-xs leading-relaxed"
              />
              <p className="text-[11px] text-[var(--muted)]">
                Add new keywords that are not yet in the database. Separate with new lines or commas.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCreateDialog(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleCreateBatch}
              disabled={isPending || !newBatchName.trim()}
            >
              {pendingAction === "create" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Creating Batch...
                </>
              ) : (
                "Create Batch"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
