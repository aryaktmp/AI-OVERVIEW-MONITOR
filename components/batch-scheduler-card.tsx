"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Layers,
  Plus,
  RefreshCw,
  Sliders,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/app/(dashboard)/actions";
import type {
  BatchWithKeywordsCount,
  BatchScheduleSettingsRecord,
  BatchAuditLogRecord,
  BatchScheduleMode,
} from "@/lib/keyword-batches";

interface BatchSchedulerCardProps {
  initialBatches: BatchWithKeywordsCount[];
  initialSettings: BatchScheduleSettingsRecord;
  initialAuditLogs: BatchAuditLogRecord[];
}

export function BatchSchedulerCard({
  initialBatches,
  initialSettings,
  initialAuditLogs,
}: BatchSchedulerCardProps) {
  const [batches, setBatches] = useState<BatchWithKeywordsCount[]>(initialBatches);
  const [settings, setSettings] = useState<BatchScheduleSettingsRecord>(initialSettings);
  const [auditLogs] = useState<BatchAuditLogRecord[]>(initialAuditLogs);

  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  // Dialog states
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [selectedOverrideBatchId, setSelectedOverrideBatchId] = useState("");
  const [overrideFreezeMode, setOverrideFreezeMode] = useState(false);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [newBatchDescription, setNewBatchDescription] = useState("");

  const activeBatch = batches.find((b) => b.is_active) ?? null;

  function handleRotateNow() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await rotateBatchNowAction();
        if (res.status === "rotated") {
          setFeedback({
            type: "success",
            text: `Successfully rotated to ${res.newBatch?.name ?? "next batch"}. ${res.message}`,
          });
          // Update local state
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
            text: `Rotation skipped: ${res.message}`,
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to rotate batch.",
        });
      }
    });
  }

  function handleModeToggle(checked: boolean) {
    const nextMode: BatchScheduleMode = checked ? "auto" : "manual_frozen";
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await updateBatchScheduleModeAction(nextMode);
        setSettings(res.settings);
        setFeedback({
          type: "success",
          text: `Schedule mode switched to ${nextMode === "auto" ? "Automatic Rotation" : "Manual Frozen"}.`,
        });
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to change schedule mode.",
        });
      }
    });
  }

  function handleExecuteOverride() {
    if (!selectedOverrideBatchId) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await overrideActiveBatchAction(
          selectedOverrideBatchId,
          overrideFreezeMode
        );
        setShowOverrideDialog(false);
        setBatches((prev) =>
          prev.map((b) => ({
            ...b,
            is_active: b.id === selectedOverrideBatchId,
          }))
        );
        setSettings((prev) => ({
          ...prev,
          mode: res.mode,
        }));
        setFeedback({
          type: "success",
          text: `Active batch manually set to ${res.newBatch.name}. (Mode: ${res.mode})`,
        });
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to override active batch.",
        });
      }
    });
  }

  function handleToggleEnabled(batchId: string, currentEnabled: boolean) {
    setFeedback(null);
    startTransition(async () => {
      try {
        await toggleBatchEnabledAction(batchId, !currentEnabled);
        setBatches((prev) =>
          prev.map((b) => (b.id === batchId ? { ...b, is_enabled: !currentEnabled } : b))
        );
        setFeedback({
          type: "success",
          text: `Batch rotation eligibility updated.`,
        });
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to update batch.",
        });
      }
    });
  }

  function handleCreateBatch() {
    if (!newBatchName.trim()) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await createBatchAction(newBatchName, newBatchDescription);
        setShowCreateDialog(false);
        setNewBatchName("");
        setNewBatchDescription("");
        setBatches((prev) => [
          ...prev,
          {
            ...res.batch,
            totalKeywords: 0,
            activeKeywords: 0,
          },
        ]);
        setFeedback({
          type: "success",
          text: `Batch "${res.batch.name}" created successfully.`,
        });
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to create batch.",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card className="border-[var(--line)] bg-[var(--surface)]">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-[var(--accent)]" />
                <CardTitle className="text-[16px] font-semibold text-[var(--ink)]">
                  Weekly Keyword Batch Scheduling
                </CardTitle>
              </div>
              <CardDescription className="mt-1 text-[13px] text-[var(--muted)]">
                Organize keywords into sequential weekly rotation batches. The active batch resets
                automatically every Monday at 00:00 UTC.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOverrideDialog(true)}
                disabled={isPending}
                className="text-[12px]"
              >
                <Sliders className="mr-1.5 h-3.5 w-3.5" />
                Manual Override
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleRotateNow}
                disabled={isPending}
                className="bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 text-[12px]"
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
                Rotate Next Now
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {feedback && (
            <Alert
              className={`text-[13px] ${
                feedback.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              )}
              <AlertDescription>{feedback.text}</AlertDescription>
            </Alert>
          )}

          {/* Current Status Highlights */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-4">
              <div className="text-[12px] font-medium text-[var(--muted)]">Currently Active Batch</div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[18px] font-bold text-[var(--ink)]">
                  {activeBatch ? activeBatch.name : "None Active"}
                </span>
                {activeBatch && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400">
                    Active (Order #{activeBatch.order_index})
                  </Badge>
                )}
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                {activeBatch ? `${activeBatch.activeKeywords} active keywords being checked` : "No batch active"}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-4">
              <div className="text-[12px] font-medium text-[var(--muted)]">Rotation Schedule Mode</div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[16px] font-semibold text-[var(--ink)]">
                  {settings.mode === "auto" ? "Automatic (Weekly)" : "Manual Frozen"}
                </span>
                <Switch
                  checked={settings.mode === "auto"}
                  onCheckedChange={handleModeToggle}
                  disabled={isPending}
                />
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                {settings.mode === "auto"
                  ? "Rotates automatically every Monday"
                  : "Paused on current batch until resumed"}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-4">
              <div className="text-[12px] font-medium text-[var(--muted)]">Next Schedule Reset</div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[15px] font-semibold text-[var(--ink)]">
                <Calendar className="h-4 w-4 text-[var(--accent)]" />
                <span>Every Monday</span>
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                Reset interval: 00:00 UTC (07:00 WIB)
              </div>
            </div>
          </div>

          {/* Batches Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[var(--ink)]">Configured Batches</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCreateDialog(true)}
                disabled={isPending}
                className="text-[12px]"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add New Batch
              </Button>
            </div>

            <div className="rounded-md border border-[var(--line)] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[var(--bg)] hover:bg-[var(--bg)]">
                    <TableHead className="w-[100px] text-[12px]">Order</TableHead>
                    <TableHead className="text-[12px]">Batch Name</TableHead>
                    <TableHead className="text-[12px]">Keywords (Active / Total)</TableHead>
                    <TableHead className="w-[160px] text-[12px]">Include in Auto</TableHead>
                    <TableHead className="w-[140px] text-right text-[12px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id} className="text-[13px]">
                      <TableCell className="font-mono text-[12px] text-[var(--muted)]">
                        #{b.order_index}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--ink)]">{b.name}</span>
                          {b.is_active && (
                            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              Active
                            </Badge>
                          )}
                        </div>
                        {b.description && (
                          <div className="text-[12px] text-[var(--muted)]">{b.description}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-[var(--ink)]">{b.activeKeywords}</span>
                        <span className="text-[var(--muted)]"> / {b.totalKeywords}</span>
                        {b.activeKeywords === 0 && (
                          <Badge variant="outline" className="ml-2 border-amber-300 text-amber-600 dark:text-amber-400 text-[11px]">
                            Empty (Will be skipped)
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={b.is_enabled}
                            onCheckedChange={() => handleToggleEnabled(b.id, b.is_enabled)}
                            disabled={isPending}
                          />
                          <span className="text-[12px] text-[var(--muted)]">
                            {b.is_enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {b.is_active ? (
                          <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                            Current Active
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedOverrideBatchId(b.id);
                              setShowOverrideDialog(true);
                            }}
                            disabled={isPending}
                            className="text-[12px] hover:text-[var(--accent)]"
                          >
                            Switch to this
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Audit Trail Log */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--muted)]" />
              <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                Rotation & Override Audit Trail
              </h3>
            </div>
            <div className="rounded-md border border-[var(--line)] overflow-hidden max-h-[260px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[var(--bg)] hover:bg-[var(--bg)]">
                    <TableHead className="w-[170px] text-[12px]">Timestamp</TableHead>
                    <TableHead className="w-[140px] text-[12px]">Type</TableHead>
                    <TableHead className="w-[140px] text-[12px]">Actor</TableHead>
                    <TableHead className="text-[12px]">Details / Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-4 text-center text-[13px] text-[var(--muted)]">
                        No batch audit logs recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs.map((log) => (
                      <TableRow key={log.id} className="text-[12px]">
                        <TableCell className="text-[var(--muted)] font-mono">
                          {new Date(log.created_at).toLocaleString("en-US", {
                            timeZone: "Asia/Jakarta",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          WIB
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              log.trigger_type === "admin_override"
                                ? "border-indigo-300 text-indigo-600 dark:text-indigo-400"
                                : log.trigger_type === "auto_schedule"
                                ? "border-emerald-300 text-emerald-600 dark:text-emerald-400"
                                : "border-zinc-300 text-zinc-600 dark:text-zinc-400"
                            }
                          >
                            {log.trigger_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-[var(--ink)] truncate max-w-[140px]">
                          {log.actor_id}
                        </TableCell>
                        <TableCell className="text-[var(--muted)] truncate max-w-[320px]">
                          {log.notes ?? "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manual Override Dialog */}
      <Dialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Batch Override</DialogTitle>
            <DialogDescription>
              Switch the active monitoring batch immediately without waiting for Monday rotation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="batch-select">Target Batch</Label>
              <Select
                value={selectedOverrideBatchId}
                onValueChange={setSelectedOverrideBatchId}
              >
                <SelectTrigger id="batch-select">
                  <SelectValue placeholder="Select target batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} (Order #{b.order_index} • {b.activeKeywords} keywords)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="freeze-mode"
                checked={overrideFreezeMode}
                onCheckedChange={setOverrideFreezeMode}
              />
              <Label htmlFor="freeze-mode" className="text-[13px] text-[var(--ink)] cursor-pointer">
                Freeze automatic schedule (stay on this batch until resumed)
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowOverrideDialog(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleExecuteOverride}
              disabled={!selectedOverrideBatchId || isPending}
              className="bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90"
            >
              {isPending ? "Switching..." : "Set as Active Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Batch Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Batch</DialogTitle>
            <DialogDescription>
              Add a new keyword grouping batch into the sequential rotation order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-batch-name">Batch Name</Label>
              <Input
                id="new-batch-name"
                placeholder="e.g. Batch 4 - Enterprise HR"
                value={newBatchName}
                onChange={(e) => setNewBatchName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-batch-desc">Description (Optional)</Label>
              <Input
                id="new-batch-desc"
                placeholder="e.g. Targeted enterprise & talent keywords"
                value={newBatchDescription}
                onChange={(e) => setNewBatchDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleCreateBatch}
              disabled={!newBatchName.trim() || isPending}
              className="bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90"
            >
              {isPending ? "Creating..." : "Create Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
