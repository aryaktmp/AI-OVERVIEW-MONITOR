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
  Pencil,
  Plus,
  RefreshCw,
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
import { cn } from "@/lib/utils";
import {
  rotateBatchNowAction,
  overrideActiveBatchAction,
  updateBatchScheduleModeAction,
  toggleBatchEnabledAction,
  createBatchAction,
  updateBatchWithKeywordsAction,
  getSelectableKeywordsAction,
} from "@/app/(dashboard)/actions";
import {
  KeywordMultiSelectDropdown,
  type SelectableKeyword,
} from "@/components/keyword-multi-select-dropdown";
import {
  getMondaysInMonth,
  getMondayOccurrenceOfMonth,
  getJakartaDateParts,
  makeJakartaDate,
  getScheduledBatchForDate,
  getJakartaWeekBoundaries,
  type BatchWithKeywordsCount,
  type BatchScheduleSettingsRecord,
  type BatchScheduleSlotWithBatch,
  type BatchAuditLogRecord,
} from "@/lib/keyword-batches";

interface BatchScheduleCalendarProps {
  initialBatches: BatchWithKeywordsCount[];
  initialSlots?: BatchScheduleSlotWithBatch[];
  initialSettings: BatchScheduleSettingsRecord;
  monthlyRunCount: number;
  initialAuditLogs: BatchAuditLogRecord[];
  availableKeywords?: SelectableKeyword[];
  recentCheckRuns?: Array<{
    id: string;
    started_at: string;
    status: string;
    total: number;
    done: number;
  }>;
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
  initialSettings,
  monthlyRunCount,
  initialAuditLogs,
  availableKeywords = [],
  recentCheckRuns = [],
}: BatchScheduleCalendarProps) {
  const [batches, setBatches] = useState<BatchWithKeywordsCount[]>(initialBatches);
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
  const [overrideDuration, setOverrideDuration] = useState<"1_week" | "2_weeks" | "permanent">("1_week");

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [newBatchDescription, setNewBatchDescription] = useState("");
  const [newBatchColor, setNewBatchColor] = useState(PRESET_COLORS[0]);
  const [newBatchKeywords, setNewBatchKeywords] = useState("");

  // Edit Batch Dialog states
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingBatch, setEditingBatch] = useState<BatchWithKeywordsCount | null>(null);
  const [editBatchName, setEditBatchName] = useState("");
  const [editBatchDescription, setEditBatchDescription] = useState("");
  const [editBatchColor, setEditBatchColor] = useState(PRESET_COLORS[0]);
  const [editSelectedKeywordIds, setEditSelectedKeywordIds] = useState<string[]>([]);
  const [editNewKeywordsText, setEditNewKeywordsText] = useState("");

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
    if ((showCreateDialog || showEditDialog) && allKeywords.length === 0 && !isLoadingKeywords) {
      setIsLoadingKeywords(true);
      getSelectableKeywordsAction()
        .then((kws) => setAllKeywords(kws))
        .catch((err) => console.error("Failed to load selectable keywords:", err))
        .finally(() => setIsLoadingKeywords(false));
    }
  }, [showCreateDialog, showEditDialog, allKeywords.length, isLoadingKeywords]);

  const parsedKeywordCount = useMemo(() => {
    if (!newBatchKeywords.trim()) return 0;
    const items = newBatchKeywords
      .split(/[\r\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2 && k.length <= 200);
    return new Set(items.map((k) => k.toLowerCase())).size;
  }, [newBatchKeywords]);

  const parsedEditKeywordCount = useMemo(() => {
    if (!editNewKeywordsText.trim()) return 0;
    const items = editNewKeywordsText
      .split(/[\r\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2 && k.length <= 200);
    return new Set(items.map((k) => k.toLowerCase())).size;
  }, [editNewKeywordsText]);

  // Audit trail accordion
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  const [now] = useState(() => new Date());
  const nowParts = useMemo(() => getJakartaDateParts(now), [now]);
  const [viewYear, setViewYear] = useState(() => nowParts.year);
  const [viewMonthIdx, setViewMonthIdx] = useState(() => nowParts.month);

  const currentYear = nowParts.year;
  const currentMonthIdx = nowParts.month;
  const currentDay = nowParts.date;

  const isViewingCurrentMonth =
    viewYear === currentYear && viewMonthIdx === currentMonthIdx;

  const mondayInfo = useMemo(() => getMondayOccurrenceOfMonth(now), [now]);
  const currentActiveWeek = mondayInfo.occurrence;

  const activeBatch = batches.find((b) => b.is_active) ?? null;
  const hasEmptyActiveBatch = Boolean(activeBatch && activeBatch.activeKeywords === 0);

  // Month navigation handlers
  function handlePrevMonth() {
    if (viewMonthIdx === 0) {
      setViewYear((y) => y - 1);
      setViewMonthIdx(11);
    } else {
      setViewMonthIdx((m) => m - 1);
    }
  }

  function handleNextMonth() {
    if (viewMonthIdx === 11) {
      setViewYear((y) => y + 1);
      setViewMonthIdx(0);
    } else {
      setViewMonthIdx((m) => m + 1);
    }
  }

  function handleToday() {
    const todayParts = getJakartaDateParts(new Date());
    setViewYear(todayParts.year);
    setViewMonthIdx(todayParts.month);
  }

  function handleSelectMonth(monthIdx: number) {
    setViewMonthIdx(monthIdx);
  }

  function handleSelectYear(year: number) {
    setViewYear(year);
  }

  // Generate calendar days for viewed month & year (Asia/Jakarta timezone)
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonthIdx + 1, 0)).getUTCDate();
    const firstDayPart = getJakartaDateParts(
      makeJakartaDate(viewYear, viewMonthIdx, 1, 12, 0, 0)
    );
    // Shift so Mon is 0, Sun is 6
    const startOffset = (firstDayPart.day + 6) % 7;

    const days: Array<{
      dayNumber: number;
      isToday: boolean;
      isMonday: boolean;
      batchColor: string;
      batchName: string;
      targetWeekMonday: string;
      isOverride: boolean;
    }> = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = makeJakartaDate(viewYear, viewMonthIdx, d, 12, 0, 0);
      const dayPart = getJakartaDateParts(dateObj);
      const dayOfWeek = (dayPart.day + 6) % 7; // 0 = Mon
      const scheduled = getScheduledBatchForDate(dateObj, batches, settings);

      const batchColor = scheduled.batch?.color || "var(--line)";
      const batchName = scheduled.batch?.name || "Unassigned";
      const isToday = isViewingCurrentMonth && d === currentDay;

      days.push({
        dayNumber: d,
        isToday,
        isMonday: dayOfWeek === 0,
        batchColor,
        batchName,
        targetWeekMonday: scheduled.targetWeekMonday,
        isOverride: scheduled.isOverride,
      });
    }

    return { days, startOffset, daysInMonth };
  }, [viewYear, viewMonthIdx, isViewingCurrentMonth, currentDay, batches, settings]);

  // Mondays in viewed month
  const monthMondays = useMemo(
    () => getMondaysInMonth(viewYear, viewMonthIdx),
    [viewYear, viewMonthIdx]
  );

  // Cards per Monday for viewed month
  const monthMondayCards = useMemo(() => {
    const nowMs = now.getTime();
    return monthMondays.map((m, idx) => {
      const mondayDate = makeJakartaDate(viewYear, viewMonthIdx, m, 12, 0, 0);
      const bounds = getJakartaWeekBoundaries(mondayDate);
      const scheduled = getScheduledBatchForDate(mondayDate, batches, settings);
      const sundayDate = new Date(bounds.endMs);
      const isCurrent = nowMs >= bounds.startMs && nowMs <= bounds.endMs;
      const isPast = nowMs > bounds.endMs;

      const runInWeek = (recentCheckRuns ?? []).find(
        (r) => r.started_at >= bounds.startIso && r.started_at <= bounds.endIso
      );

      let statusLabel = "Upcoming";
      let statusVariant: "default" | "outline" | "detected" | "notDetected" | "none" = "outline";
      let checksCountText: string | null = null;

      if (runInWeek) {
        if (runInWeek.status === "done") {
          statusLabel = "Run completed";
          statusVariant = "detected";
          checksCountText = `${runInWeek.done} checks`;
        } else if (runInWeek.status === "running") {
          statusLabel = "Running";
          statusVariant = "notDetected";
          checksCountText = `${runInWeek.done}/${runInWeek.total} checks`;
        } else {
          statusLabel = "Failed";
          statusVariant = "none";
          checksCountText = `${runInWeek.done}/${runInWeek.total} checks`;
        }
      } else if (isPast) {
        statusLabel = "Skipped";
        statusVariant = "none";
      } else if (isCurrent) {
        statusLabel = "Not yet run";
        statusVariant = "outline";
      }

      return {
        weekIndex: idx + 1,
        mondayDay: m,
        mondayDateString: bounds.mondayDateString,
        dateRangeLabel: `${bounds.mondayDate.getDate()} ${MONTH_NAMES[bounds.mondayDate.getMonth()].slice(0, 3)} – ${sundayDate.getDate()} ${MONTH_NAMES[sundayDate.getMonth()].slice(0, 3)} ${sundayDate.getFullYear()}`,
        batch: scheduled.batch,
        isCurrent,
        isPast,
        isOverride: scheduled.isOverride,
        statusLabel,
        statusVariant,
        checksCountText,
        runInWeek,
      };
    });
  }, [monthMondays, viewYear, viewMonthIdx, batches, settings, now, recentCheckRuns]);

  // Upcoming 8 Weeks Schedule
  const upcoming8Weeks = useMemo(() => {
    const currentBounds = getJakartaWeekBoundaries(now);
    const nowMs = now.getTime();
    return Array.from({ length: 8 }, (_, i) => {
      const mondayMs = currentBounds.startMs + i * 7 * 24 * 60 * 60 * 1000;
      const mondayDate = new Date(mondayMs);
      const bounds = getJakartaWeekBoundaries(mondayDate);
      const scheduled = getScheduledBatchForDate(mondayDate, batches, settings);
      const sundayDate = new Date(bounds.endMs);
      const isCurrent = i === 0;
      const isPast = nowMs > bounds.endMs;

      const runInWeek = (recentCheckRuns ?? []).find(
        (r) => r.started_at >= bounds.startIso && r.started_at <= bounds.endIso
      );

      let statusLabel = "Upcoming";
      let statusVariant: "default" | "outline" | "detected" | "notDetected" | "none" = "outline";
      let checksCountText: string | null = null;

      if (runInWeek) {
        if (runInWeek.status === "done") {
          statusLabel = "Run completed";
          statusVariant = "detected";
          checksCountText = `${runInWeek.done} checks`;
        } else if (runInWeek.status === "running") {
          statusLabel = "Running";
          statusVariant = "notDetected";
          checksCountText = `${runInWeek.done}/${runInWeek.total} checks`;
        } else {
          statusLabel = "Failed";
          statusVariant = "none";
          checksCountText = `${runInWeek.done}/${runInWeek.total} checks`;
        }
      } else if (isPast) {
        statusLabel = "Skipped";
        statusVariant = "none";
      } else if (isCurrent) {
        statusLabel = "Not yet run";
        statusVariant = "outline";
      }

      return {
        offset: i,
        mondayDateString: bounds.mondayDateString,
        dateRangeLabel: `${bounds.mondayDate.getDate()} ${MONTH_NAMES[bounds.mondayDate.getMonth()].slice(0, 3)} – ${sundayDate.getDate()} ${MONTH_NAMES[sundayDate.getMonth()].slice(0, 3)}`,
        batch: scheduled.batch,
        isCurrent,
        isOverride: scheduled.isOverride,
        statusLabel,
        statusVariant,
        checksCountText,
      };
    });
  }, [now, batches, settings, recentCheckRuns]);

  // Action handlers
  function handleRotateNow() {
    setFeedback(null);
    setPendingAction("rotate");
    startTransition(async () => {
      try {
        const res = await rotateBatchNowAction();
        if (res.status === "synchronized" || res.status === "unchanged") {
          setFeedback({
            type: "success",
            text: res.message,
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

  function handleOpenEditBatch(batch: BatchWithKeywordsCount) {
    setEditingBatch(batch);
    setEditBatchName(batch.name);
    setEditBatchDescription(batch.description ?? "");
    setEditBatchColor(batch.color ?? PRESET_COLORS[0]);
    setEditNewKeywordsText("");

    // Find all keywords currently assigned to this batch
    const inThisBatch = allKeywords
      .filter((k) => k.batch_id === batch.id)
      .map((k) => k.id);
    setEditSelectedKeywordIds(inThisBatch);

    // If keywords list not yet loaded, load it
    if (allKeywords.length === 0 && !isLoadingKeywords) {
      setIsLoadingKeywords(true);
      getSelectableKeywordsAction()
        .then((kws) => {
          setAllKeywords(kws);
          const currentInBatch = kws
            .filter((k) => k.batch_id === batch.id)
            .map((k) => k.id);
          setEditSelectedKeywordIds(currentInBatch);
        })
        .catch((err) => console.error("Failed to load selectable keywords:", err))
        .finally(() => setIsLoadingKeywords(false));
    }

    setShowEditDialog(true);
  }

  function handleSaveEditBatch() {
    if (!editingBatch || !editBatchName.trim()) return;
    setFeedback(null);
    setPendingAction(`edit-${editingBatch.id}`);
    startTransition(async () => {
      try {
        const res = await updateBatchWithKeywordsAction(
          editingBatch.id,
          editBatchName.trim(),
          editBatchDescription.trim() || undefined,
          editBatchColor,
          editSelectedKeywordIds,
          editNewKeywordsText.trim() || undefined
        );

        if (res.ok && res.batch) {
          const finalCount = res.keywordsCount ?? 0;
          setBatches((prev) =>
            prev.map((b) =>
              b.id === editingBatch.id
                ? {
                    ...b,
                    name: res.batch.name,
                    description: res.batch.description,
                    color: editBatchColor,
                    totalKeywords: finalCount,
                    activeKeywords: finalCount,
                  }
                : b
            )
          );

          // Update local keywords membership
          const selectedSet = new Set(editSelectedKeywordIds);
          setAllKeywords((prev) =>
            prev.map((k) => {
              if (selectedSet.has(k.id)) {
                return { ...k, batch_id: editingBatch.id, batch_name: editBatchName.trim() };
              }
              if (k.batch_id === editingBatch.id && !selectedSet.has(k.id)) {
                return { ...k, batch_id: null, batch_name: null };
              }
              return k;
            })
          );

          setShowEditDialog(false);
          setFeedback({
            type: "success",
            text: `Batch "${editBatchName.trim()}" updated successfully (${finalCount} keyword(s)).`,
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to update batch.",
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
        let overrideUntil: string | null = null;
        let freeze = overrideFreezeMode;

        if (overrideDuration === "1_week") {
          const bounds = getJakartaWeekBoundaries(new Date());
          overrideUntil = new Date(bounds.endMs + 1000).toISOString();
        } else if (overrideDuration === "2_weeks") {
          const bounds = getJakartaWeekBoundaries(new Date());
          overrideUntil = new Date(
            bounds.endMs + 1000 + 7 * 24 * 60 * 60 * 1000
          ).toISOString();
        } else {
          freeze = true;
          overrideUntil = null;
        }

        const res = await overrideActiveBatchAction(
          selectedOverrideBatchId,
          freeze,
          overrideUntil
        );
        if (res.ok) {
          setBatches((prev) =>
            prev.map((b) => ({
              ...b,
              is_active: b.id === selectedOverrideBatchId,
            }))
          );
          setSettings((prev) => ({
            ...prev,
            mode: freeze ? "manual_frozen" : "auto",
            override_until: overrideUntil,
          }));
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
                Sync Scheduled Batch
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
              {batches
                .filter((b) => b.is_enabled)
                .map((b) => (
                  <div key={b.id} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: b.color || "var(--cite)" }}
                    />
                    <span className="font-medium text-[var(--ink)]">
                      {b.name} ({b.activeKeywords} kw)
                    </span>
                  </div>
                ))}
            </div>

            <div className="flex items-center gap-2 text-[var(--muted)]">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[var(--cite)]" />
                <span>Run day: Monday 00:00 WIB</span>
              </span>
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
              return (
                <div
                  key={`day-${item.dayNumber}`}
                  className={`relative h-16 rounded-md p-1.5 border transition-all flex flex-col justify-between ${
                    item.isToday
                      ? "border-[var(--cite)] ring-2 ring-[var(--cite)]/30 bg-[var(--surface)] shadow-xs"
                      : "border-[var(--line)] bg-[var(--surface)]/70 hover:border-[var(--muted)]"
                  }`}
                  style={{
                    borderLeftWidth: "4px",
                    borderLeftColor: item.batchColor,
                  }}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`text-xs font-semibold leading-none ${
                        item.isToday
                          ? "bg-[var(--cite)] text-white px-1.5 py-0.5 rounded-full font-bold"
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

                    {item.isOverride && (
                      <span className="inline-flex items-center rounded px-1 py-0.2 text-[8px] font-medium text-amber-700 dark:text-amber-300 bg-amber-500/10">
                        Ovr
                      </span>
                    )}
                  </div>

                  <div className="truncate text-[10px]">
                    <span
                      className="inline-block truncate max-w-full font-medium"
                      style={{ color: item.batchColor }}
                      title={`${item.targetWeekMonday}: ${item.batchName}`}
                    >
                      {item.batchName}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Weekly Schedule & Execution Status Cards for the Viewed Month */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold tracking-tight text-[var(--ink)] flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-[var(--cite)]" />
              Weekly Schedule &amp; Execution Status ({MONTH_NAMES[viewMonthIdx]} {viewYear})
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Scheduled batch and run execution status for every Monday in the selected month.
            </p>
          </div>
          <span className="text-xs font-medium text-[var(--muted)]">
            Run day: Monday 00:00 WIB
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {monthMondayCards.map((week) => (
            <Card
              key={week.mondayDateString}
              className={`relative border transition-all shadow-xs ${
                week.isCurrent
                  ? "border-[var(--cite)] ring-2 ring-[var(--cite)]/20 bg-[var(--surface)]"
                  : "border-[var(--line)] bg-[var(--surface)]"
              }`}
            >
              <div
                className="h-1.5 w-full rounded-t-md"
                style={{ backgroundColor: week.batch?.color || "#94a3b8" }}
              />

              <CardHeader className="p-3.5 pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] font-mono">
                    Mon, {week.mondayDateString.slice(5)}
                  </span>
                  <Badge
                    variant={week.statusVariant}
                    className="text-[10px] font-semibold"
                  >
                    {week.statusLabel}
                  </Badge>
                </div>

                <CardTitle className="text-xs font-bold text-[var(--ink)] mt-1 truncate">
                  {week.dateRangeLabel}
                </CardTitle>
              </CardHeader>

              <CardContent className="p-3.5 pt-1 space-y-2">
                {week.batch ? (
                  <div className="rounded-md border border-[var(--line)] bg-[var(--bg)]/50 p-2 space-y-1">
                    <div className="flex items-center justify-between text-xs font-medium text-[var(--ink)]">
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: week.batch.color || "#3b82f6" }}
                        />
                        <span className="font-semibold truncate">
                          {week.batch.name}
                        </span>
                      </span>
                      <span className="text-[11px] text-[var(--muted)] font-mono shrink-0">
                        {week.batch.activeKeywords} kw
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-[var(--line)] p-2 text-center text-xs text-[var(--muted)]">
                    No batch scheduled
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-[var(--muted)] pt-0.5">
                  <span>
                    {week.checksCountText
                      ? week.checksCountText
                      : week.isCurrent
                      ? "In progress / scheduled"
                      : week.isPast
                      ? "No checks executed"
                      : "Scheduled"}
                  </span>
                  {week.isOverride && (
                    <Badge variant="outline" className="text-[9px] text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10">
                      Override
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Upcoming 8 Weeks Schedule */}
      <Card className="border-[var(--line)] bg-[var(--surface)] shadow-xs">
        <CardHeader className="pb-3 border-b border-[var(--line)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-1.5 text-[var(--ink)]">
                <Clock className="h-4 w-4 text-[var(--cite)]" />
                <span>Upcoming 8-Week Schedule (Daftar 8 Minggu ke Depan)</span>
              </CardTitle>
              <CardDescription className="text-xs text-[var(--muted)]">
                Continuous deterministic schedule projected for the next 8 weeks in Asia/Jakarta timezone.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Timeline</TableHead>
                <TableHead>Monday Run Date</TableHead>
                <TableHead>Scheduled Batch</TableHead>
                <TableHead className="text-right">Keywords</TableHead>
                <TableHead>Execution Status</TableHead>
                <TableHead className="text-right">Schedule Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcoming8Weeks.map((item) => (
                <TableRow
                  key={item.mondayDateString}
                  className={item.isCurrent ? "bg-[var(--cite-bg)]/15" : undefined}
                >
                  <TableCell className="font-semibold text-xs">
                    {item.isCurrent ? (
                      <span className="text-[var(--cite)] font-bold">This Week</span>
                    ) : (
                      <span className="text-[var(--muted)] font-mono">+{item.offset} W</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    <span className="font-semibold text-[var(--ink)]">{item.mondayDateString}</span>
                    <span className="text-[var(--muted)] block text-[11px]">{item.dateRangeLabel}</span>
                  </TableCell>
                  <TableCell>
                    {item.batch ? (
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.batch.color || "var(--cite)" }}
                        />
                        <span className="font-semibold text-xs text-[var(--ink)]">
                          {item.batch.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--muted)] italic">No batch</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-[var(--muted)]">
                    {item.batch ? item.batch.activeKeywords : 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.statusVariant} className="text-[10px]">
                        {item.statusLabel}
                      </Badge>
                      {item.checksCountText && (
                        <span className="text-[11px] text-[var(--muted)] font-mono">
                          {item.checksCountText}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {item.isOverride ? (
                      <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10">
                        Manual Override
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-[var(--muted)]">Derived</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                <TableHead>Schedule Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[120px]">Auto Rotation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => {
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
                    <TableCell className="text-xs font-mono">
                      <Badge variant="outline" className="text-[10px] font-semibold">
                        Order #{batch.order_index}
                      </Badge>
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
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenEditBatch(batch)}
                          disabled={isPending}
                          className="cursor-pointer text-xs h-7 px-2.5 font-medium hover:bg-[var(--line)]/50"
                        >
                          <Pencil className="h-3 w-3 mr-1 text-[var(--muted)]" />
                          Edit
                        </Button>
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
                      </div>
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

            <div className="space-y-1.5">
              <Label htmlFor="override-duration-select" className="text-xs font-semibold">
                Override Duration (Masa Berlaku)
              </Label>
              <select
                id="override-duration-select"
                value={overrideDuration}
                onChange={(e) =>
                  setOverrideDuration(
                    e.target.value as "1_week" | "2_weeks" | "permanent"
                  )
                }
                className="w-full h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--cite)] cursor-pointer"
              >
                <option value="1_week">Until next Monday 00:00 WIB (1 Week)</option>
                <option value="2_weeks">Until 2 Mondays 00:00 WIB (2 Weeks)</option>
                <option value="permanent">Indefinite freeze (Manual Frozen Mode)</option>
              </select>
              <p className="text-[11px] text-[var(--muted)]">
                {overrideDuration === "permanent"
                  ? "Automatic rotation is frozen until toggled back on."
                  : "After expiration, system automatically returns to derived schedule."}
              </p>
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

      {/* Dialog: Edit Keyword Batch */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-[var(--cite)]" />
              Edit Keyword Batch
            </DialogTitle>
            <DialogDescription>
              Update batch name, color, and manage keywords included in this rotation batch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Batch Name */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-batch-name" className="text-xs font-semibold">
                Batch Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-batch-name"
                value={editBatchName}
                onChange={(e) => setEditBatchName(e.target.value)}
                placeholder="e.g. Batch 1 - Core HR"
                className="text-xs"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-batch-desc" className="text-xs font-semibold">
                Description (Optional)
              </Label>
              <Input
                id="edit-batch-desc"
                value={editBatchDescription}
                onChange={(e) => setEditBatchDescription(e.target.value)}
                placeholder="e.g. Focus on employee data and attendance keywords"
                className="text-xs"
              />
            </div>

            {/* Color Picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Batch Color</Label>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {PRESET_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setEditBatchColor(col)}
                    className={cn(
                      "h-6 w-6 rounded-full transition-transform cursor-pointer",
                      editBatchColor === col
                        ? "scale-125 ring-2 ring-offset-2 ring-[var(--ink)]"
                        : "hover:scale-110 opacity-80"
                    )}
                    style={{ backgroundColor: col }}
                    aria-label={`Select color ${col}`}
                  />
                ))}
              </div>
            </div>

            {/* Select & Manage Keywords */}
            <div className="space-y-1.5 pt-2 border-t border-[var(--line)]/50">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Keywords in this Batch
                </Label>
                <span className="text-[11px] font-mono text-[var(--muted)]">
                  {editSelectedKeywordIds.length} keyword{editSelectedKeywordIds.length === 1 ? "" : "s"} selected
                </span>
              </div>
              <KeywordMultiSelectDropdown
                keywords={allKeywords}
                selectedIds={editSelectedKeywordIds}
                onChange={setEditSelectedKeywordIds}
                disabled={isPending}
                isLoading={isLoadingKeywords}
                placeholder="Select keywords for this batch..."
                currentBatchId={editingBatch?.id}
              />
              <p className="text-[11px] text-[var(--muted)]">
                Uncheck to remove keywords from this batch. Keywords in other batches are locked.
              </p>
            </div>

            {/* Optional: Add Brand New Keywords */}
            <div className="space-y-1.5 pt-2 border-t border-[var(--line)]/50">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-batch-keywords" className="text-xs font-semibold">
                  Or Add Brand New Keywords (Optional)
                </Label>
                {parsedEditKeywordCount > 0 && (
                  <Badge variant="outline" className="text-[10px] font-mono text-[var(--cite)] border-[var(--cite)]/30">
                    {parsedEditKeywordCount} new keyword{parsedEditKeywordCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <Textarea
                id="edit-batch-keywords"
                value={editNewKeywordsText}
                onChange={(e) => setEditNewKeywordsText(e.target.value)}
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
              onClick={() => setShowEditDialog(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSaveEditBatch}
              disabled={isPending || !editBatchName.trim()}
            >
              {pendingAction?.startsWith("edit-") ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Saving Changes...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
