"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Play,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  addBrandTermAction,
  addCompetitorAction,
  clearDemoDataAction,
  deleteBrandTermAction,
  deleteCompetitorAction,
  processRunBatchAction,
  runCheckNowAction,
  saveSearchSettingsAction,
  toggleBrandTermAction,
} from "@/app/(dashboard)/actions";
import type {
  DatabaseStorageStats,
  RunHistoryRow,
  SearchSettingsConfig,
} from "@/lib/dashboard-data";

interface LiveRunProgressState {
  runId: string;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  pending: number;
  errors: number;
  serpApiCallsUsed: number;
  stoppedReason?: string;
}

interface SettingsClientProps {
  brandTerms: Array<{ id: string; term: string; enabled: boolean }>;
  competitors: Array<{ id: string; name: string; domain: string }>;
  searchSettings: SearchSettingsConfig;
  recentRuns: RunHistoryRow[];
  activeKeywordsCount: number;
  estimatedCallsForNextRun: number;
  hourlyCallsUsed: number;
  maxPerHour: number;
  isDryRunEnv: boolean;
  hasDemoData: boolean;
  brandDomain: string;
  databaseStorage: DatabaseStorageStats;
  initialRunningRun: RunHistoryRow | null;
}

export function SettingsClient({
  brandTerms,
  competitors,
  searchSettings,
  recentRuns,
  activeKeywordsCount,
  estimatedCallsForNextRun,
  hourlyCallsUsed,
  maxPerHour,
  isDryRunEnv,
  hasDemoData,
  brandDomain,
  databaseStorage,
  initialRunningRun,
}: SettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [showClearDemoConfirm, setShowClearDemoConfirm] = useState(false);

  const [liveRun, setLiveRun] = useState<LiveRunProgressState | null>(() => {
    if (!initialRunningRun) return null;
    return {
      runId: initialRunningRun.id,
      status: "running",
      total: initialRunningRun.total,
      done: initialRunningRun.done,
      pending: Math.max(0, initialRunningRun.total - initialRunningRun.done),
      errors: 0,
      serpApiCallsUsed: initialRunningRun.serpapi_calls,
    };
  });
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  const [termInput, setTermInput] = useState("");
  const [compNameInput, setCompNameInput] = useState("");
  const [compDomainInput, setCompDomainInput] = useState("");

  const [locationInput, setLocationInput] = useState(searchSettings.location);
  const [googleDomainInput, setGoogleDomainInput] = useState(
    searchSettings.google_domain
  );
  const [glInput, setGlInput] = useState(searchSettings.gl);
  const [hlInput, setHlInput] = useState(searchSettings.hl);
  const [thirdPartyEnabled, setThirdPartyEnabled] = useState(
    searchSettings.enable_third_party_check
  );

  const remainingHourlyQuota = Math.max(0, maxPerHour - hourlyCallsUsed);

  // Continue batch processing periodically while page is open and items are pending
  useEffect(() => {
    if (!liveRun) return;
    if (liveRun.status !== "running") return;
    if (liveRun.stoppedReason === "rate_limit") return;
    if (isBatchProcessing) return;

    const timer = setTimeout(async () => {
      setIsBatchProcessing(true);
      try {
        const res = await processRunBatchAction(liveRun.runId);
        if (!res.runId) {
          setLiveRun((prev) =>
            prev
              ? {
                  ...prev,
                  status: "done",
                  done: prev.total,
                  pending: 0,
                }
              : null
          );
          setFeedback({
            ok: true,
            message: "All check queue items have finished processing.",
          });
          return;
        }

        setLiveRun({
          runId: res.runId,
          status: res.status,
          total: res.total,
          done: res.done,
          pending: res.pending,
          errors: res.errors,
          serpApiCallsUsed: res.serpApiCallsUsed,
          stoppedReason: res.stoppedReason,
        });

        if (res.status !== "running") {
          setFeedback({
            ok: res.status === "done",
            message:
              res.status === "done"
                ? `Check completed (${res.done}/${res.total} keywords completed, ${res.serpApiCallsUsed} SerpApi calls used).`
                : `Check ended with status ${res.status}.`,
          });
        } else if (res.stoppedReason === "rate_limit") {
          setFeedback({
            ok: false,
            message:
              "Hourly SerpApi call limit reached. Remaining items will resume in the next hour.",
          });
        }
      } catch (err) {
        setFeedback({
          ok: false,
          message:
            err instanceof Error
              ? err.message
              : "Failed to continue queue batch processing.",
        });
      } finally {
        setIsBatchProcessing(false);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [liveRun, isBatchProcessing]);

  function handleRunCheckConfirm() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await runCheckNowAction();
        setShowRunConfirm(false);
        setLiveRun({
          runId: res.runId,
          status: res.status,
          total: res.total,
          done: res.done,
          pending: res.pending,
          errors: res.errors,
          serpApiCallsUsed: res.serpApiCallsUsed,
          stoppedReason: res.stoppedReason,
        });

        if (res.status === "done") {
          setFeedback({
            ok: true,
            message: `Check completed (${res.done}/${res.total} items completed, ${res.serpApiCallsUsed} SerpApi calls used).`,
          });
        } else {
          setFeedback({
            ok: true,
            message: `First batch completed (${res.done}/${res.total} items). Automatically processing remaining queue...`,
          });
        }
      } catch (err) {
        setShowRunConfirm(false);
        setFeedback({
          ok: false,
          message:
            err instanceof Error
              ? err.message
              : "Failed to run checks now.",
        });
      }
    });
  }

  function handleClearDemoConfirm() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await clearDemoDataAction();
        setShowClearDemoConfirm(false);
        setLiveRun(null);
        setFeedback(res);
      } catch (err) {
        setShowClearDemoConfirm(false);
        setFeedback({
          ok: false,
          message:
            err instanceof Error ? err.message : "Failed to delete demo data.",
        });
      }
    });
  }

  function handleAddBrandTerm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("term", termInput);

    startTransition(async () => {
      const res = await addBrandTermAction(fd);
      setFeedback(res);
      if (res.ok) setTermInput("");
    });
  }

  function handleToggleBrandTerm(id: string, nextEnabled: boolean) {
    setFeedback(null);
    startTransition(async () => {
      const res = await toggleBrandTermAction(id, nextEnabled);
      if (!res.ok && res.message) {
        setFeedback({ ok: false, message: res.message });
      }
    });
  }

  function handleDeleteBrandTerm(id: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteBrandTermAction(id);
      if (!res.ok && res.message) {
        setFeedback({ ok: false, message: res.message });
      }
    });
  }

  function handleAddCompetitor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("name", compNameInput);
    fd.set("domain", compDomainInput);

    startTransition(async () => {
      const res = await addCompetitorAction(fd);
      setFeedback(res);
      if (res.ok) {
        setCompNameInput("");
        setCompDomainInput("");
      }
    });
  }

  function handleDeleteCompetitor(id: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteCompetitorAction(id);
      if (!res.ok && res.message) {
        setFeedback({ ok: false, message: res.message });
      }
    });
  }

  function handleSaveSearchSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("location", locationInput);
    fd.set("google_domain", googleDomainInput);
    fd.set("gl", glInput);
    fd.set("hl", hlInput);
    fd.set("enable_third_party_check", thirdPartyEnabled ? "true" : "false");

    startTransition(async () => {
      const res = await saveSearchSettingsAction(fd);
      setFeedback(res);
    });
  }

  const progressPercentage =
    liveRun && liveRun.total > 0
      ? Math.min(100, Math.round((liveRun.done / liveRun.total) * 100))
      : 0;

  return (
    <div className="space-y-4">
      {feedback && (
        <Alert variant={feedback.ok ? "success" : "destructive"}>
          {feedback.ok ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      {/* Dialog Confirmation: Run Checks Now */}
      <Dialog open={showRunConfirm} onOpenChange={setShowRunConfirm}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Confirm Run Checks Now</DialogTitle>
            <DialogDescription>
              You are about to start a check run for{" "}
              <strong>{activeKeywordsCount} active keywords</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2 text-xs text-[var(--muted)]">
            <div className="rounded-md border border-[var(--line)] bg-[var(--bg)] p-3 space-y-1.5 text-xs">
              <div>
                • Estimated SerpApi calls:{" "}
                <strong className="font-mono text-[var(--ink)]">
                  ~{estimatedCallsForNextRun} calls
                </strong>{" "}
                (1–2 calls per keyword)
              </div>
              <div>
                • Current hourly quota remaining:{" "}
                <strong className="font-mono text-[var(--ink)]">
                  {remainingHourlyQuota} of {maxPerHour} calls/hour
                </strong>{" "}
                ({hourlyCallsUsed} used in the last 60 minutes)
              </div>
              <div>
                • Current mode:{" "}
                <strong className="text-[var(--ink)]">
                  {isDryRunEnv
                    ? "Simulation / Dry Run (SERPAPI_DRY_RUN=true)"
                    : "SerpApi Live Search"}
                </strong>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setShowRunConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isPending || activeKeywordsCount === 0}
              onClick={handleRunCheckConfirm}
            >
              {isPending ? "Starting queue..." : "Yes, run checks now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Confirmation: Clear Demo Data */}
      <Dialog open={showClearDemoConfirm} onOpenChange={setShowClearDemoConfirm}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Confirm Clear Demo Data</DialogTitle>
            <DialogDescription>
              All demo data (<code>is_demo = true</code>) in <code>check_runs</code>,{" "}
              <code>keywords</code>, <code>keyword_groups</code>, and{" "}
              <code>competitors</code> tables will be permanently deleted. Your
              real data will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setShowClearDemoConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={handleClearDemoConfirm}
            >
              {isPending ? "Deleting..." : "Yes, clear demo data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Live Run Progress Card */}
      {liveRun && (
        <Card className="border-[#BFDBFE] bg-[#EFF6FF] dark:border-[#1E3A8A]/50 dark:bg-[#1E3A8A]/20">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold text-[#1E3A8A] dark:text-[#93C5FD]">
                  Check Progress
                </CardTitle>
                <Badge
                  variant={
                    liveRun.status === "done"
                      ? "detected"
                      : liveRun.status === "running"
                        ? "notDetected"
                        : "none"
                  }
                >
                  {liveRun.status === "done"
                    ? "Completed"
                    : liveRun.status === "running"
                      ? "Processing..."
                      : "Failed"}
                </Badge>
              </div>
              <span className="font-mono text-xs font-semibold text-[#1E3A8A] dark:text-[#93C5FD]">
                {liveRun.done} / {liveRun.total} keywords ({progressPercentage}%)
              </span>
            </div>
          </CardHeader>

          <CardContent className="space-y-2">
            <Progress
              value={liveRun.done}
              max={Math.max(1, liveRun.total)}
              className="bg-[#DBEAFE] dark:bg-[#1E3A8A]/40"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#1E40AF] dark:text-[#BFDBFE]">
              <span>
                Remaining: <strong>{liveRun.pending}</strong> keywords • Errors:{" "}
                <strong>{liveRun.errors}</strong> • SerpApi calls:{" "}
                <strong className="font-mono">{liveRun.serpApiCallsUsed}</strong>
              </span>
              {liveRun.status === "running" && (
                <span className="italic">
                  Processing next batch automatically while page remains open...
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Execution & Quota Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Check Execution &amp; Demo Data</CardTitle>
              <CardDescription>
                Automatic schedule runs every Monday at 07:00 WIB. You can also
                trigger a manual check anytime.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasDemoData && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending || isBatchProcessing}
                  onClick={() => {
                    setShowRunConfirm(false);
                    setShowClearDemoConfirm(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear demo data
                </Button>
              )}
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isPending || isBatchProcessing}
                onClick={() => {
                  setShowClearDemoConfirm(false);
                  setShowRunConfirm(true);
                }}
              >
                <Play className="h-3.5 w-3.5" />
                Run checks now
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-1 gap-2.5 border-t border-[var(--line)] pt-3 text-xs sm:grid-cols-3">
            <div>
              <span className="text-[var(--muted)]">Active keywords: </span>
              <strong className="font-mono text-[var(--ink)]">
                {activeKeywordsCount} keywords
              </strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">Last 60 minutes usage: </span>
              <strong className="font-mono text-[var(--ink)]">
                {hourlyCallsUsed} / {maxPerHour} calls
              </strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">SerpApi mode: </span>
              <Badge variant={isDryRunEnv ? "notDetected" : "detected"}>
                {isDryRunEnv ? "Dry Run (Demo)" : "Production (Live)"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Database Storage Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4 text-[var(--cite)]" />
                Database Storage
              </CardTitle>
              <CardDescription>
                Only <code>ai_overview</code> blocks and call metadata are
                stored in <code>checks.raw</code>. Raw data older than 90
                days is purged automatically each week.
              </CardDescription>
            </div>
            <div className="text-right font-mono text-xs font-semibold text-[var(--ink)]">
              {databaseStorage.usedMb.toFixed(2)} MB / {databaseStorage.quotaMb} MB (
              {databaseStorage.percentUsed}%)
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <Progress
            value={databaseStorage.usedMb}
            max={databaseStorage.quotaMb}
            indicatorClassName={
              databaseStorage.percentUsed > 80
                ? "bg-[#DC2626]"
                : databaseStorage.percentUsed > 50
                  ? "bg-[var(--seen)]"
                  : "bg-[var(--cite)]"
            }
          />
        </CardContent>
      </Card>

      {/* Brand Identity & Location Settings */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {/* Brand Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Brand Identity</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="text-xs">
              <Label className="text-[var(--muted)]">Primary domain</Label>
              <div className="mt-1 font-mono font-medium text-[var(--ink)]">
                {brandDomain}
              </div>
            </div>

            <div className="text-xs space-y-2">
              <Label className="text-[var(--muted)]">
                Brand name variations in answer text
              </Label>
              {brandTerms.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  No brand terms registered yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {brandTerms.map((bt) => (
                    <div
                      key={bt.id}
                      className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium text-[var(--ink)]">
                          {bt.term}
                        </span>
                        <Badge variant={bt.enabled ? "detected" : "none"}>
                          {bt.enabled ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            handleToggleBrandTerm(bt.id, !bt.enabled)
                          }
                          className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                        >
                          {bt.enabled ? "Disable" : "Enable"}
                        </button>
                        <span className="text-[var(--line)]">|</span>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleDeleteBrandTerm(bt.id)}
                          className="text-xs font-medium text-[#DC2626] hover:underline cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={handleAddBrandTerm} className="flex gap-2">
              <Input
                type="text"
                value={termInput}
                onChange={(e) => setTermInput(e.target.value)}
                placeholder="Add term (e.g. LinovHR)"
                className="flex-1"
                required
              />
              <Button type="submit" size="sm" disabled={isPending}>
                Add term
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Search Parameters */}
        <Card>
          <CardHeader>
            <CardTitle>Search Parameters</CardTitle>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSaveSearchSettings} className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <Label htmlFor="loc-input">Search location</Label>
                  <Input
                    id="loc-input"
                    type="text"
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gdomain-input">Google domain</Label>
                  <Input
                    id="gdomain-input"
                    type="text"
                    value={googleDomainInput}
                    onChange={(e) => setGoogleDomainInput(e.target.value)}
                    className="font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <Label htmlFor="gl-input">Country code (gl)</Label>
                  <Input
                    id="gl-input"
                    type="text"
                    maxLength={2}
                    value={glInput}
                    onChange={(e) => setGlInput(e.target.value)}
                    className="font-mono"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hl-input">Language code (hl)</Label>
                  <Input
                    id="hl-input"
                    type="text"
                    value={hlInput}
                    onChange={(e) => setHlInput(e.target.value)}
                    className="font-mono"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Switch
                  id="third-party-toggle"
                  checked={thirdPartyEnabled}
                  onCheckedChange={setThirdPartyEnabled}
                />
                <Label
                  htmlFor="third-party-toggle"
                  className="cursor-pointer font-medium"
                >
                  Check third-party sources
                </Label>
              </div>

              <div className="pt-1">
                <Button type="submit" size="sm" disabled={isPending}>
                  Save settings
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Competitor List */}
      <Card>
        <CardHeader>
          <CardTitle>Competitor List</CardTitle>
          <CardDescription>
            Competitor domains will be tagged automatically in AI Overview
            sources and on the Competitors page.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3.5">
          <form
            onSubmit={handleAddCompetitor}
            className="flex flex-wrap gap-2"
          >
            <Input
              type="text"
              value={compNameInput}
              onChange={(e) => setCompNameInput(e.target.value)}
              placeholder="Competitor name (e.g. Mekari Talenta)"
              className="min-w-[200px] flex-1"
              required
            />
            <Input
              type="text"
              value={compDomainInput}
              onChange={(e) => setCompDomainInput(e.target.value)}
              placeholder="Domain (e.g. talenta.co)"
              className="min-w-[180px] flex-1 font-mono"
              required
            />
            <Button type="submit" size="sm" disabled={isPending}>
              Save competitor
            </Button>
          </form>

          {competitors.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              No competitors registered yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
              {competitors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                >
                  <div className="truncate">
                    <div className="font-medium text-[var(--ink)]">{c.name}</div>
                    <div className="font-mono text-[11px] text-[var(--muted)]">
                      {c.domain}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDeleteCompetitor(c.id)}
                    className="ml-2 text-xs font-medium text-[#DC2626] hover:underline cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run History & SerpApi Call Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Run History &amp; SerpApi Call Usage</CardTitle>
          <CardDescription>
            Displays the number of SerpApi calls per run (including secondary
            calls for page_token).
          </CardDescription>
        </CardHeader>

        <CardContent>
          {recentRuns.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--muted)]">
              No check history yet. Click &ldquo;Run checks now&rdquo; above to begin.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Start Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Run Type</TableHead>
                  <TableHead>Keywords Done</TableHead>
                  <TableHead className="text-right">SerpApi Calls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs text-[var(--ink)]">
                      {new Date(run.started_at).toLocaleString("en-US", {
                        timeZone: "Asia/Jakarta",
                        dateStyle: "medium",
                        timeStyle: "short",
                      }) + " WIB"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.status === "done"
                            ? "detected"
                            : run.status === "running"
                              ? "notDetected"
                              : "none"
                        }
                      >
                        {run.status === "done"
                          ? "Completed"
                          : run.status === "running"
                            ? "Running"
                            : run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={run.is_demo ? "notDetected" : "brand"}>
                        {run.is_demo ? "Demo Data" : "Live Search"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[var(--muted)]">
                      {run.done} / {run.total}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-[var(--ink)]">
                      {run.serpapi_calls} calls
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
