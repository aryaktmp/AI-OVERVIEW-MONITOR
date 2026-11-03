"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderTree,
  Key,
  Loader2,
  Plus,
  Trash2,
  Power,
  Upload,
} from "lucide-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { HeatmapCellState, KeywordWeeklyRow } from "@/lib/analytics";
import type {
  BatchWithKeywordsCount,
  BatchScheduleSlotWithBatch,
  BatchScheduleSettingsRecord,
  BatchAuditLogRecord,
} from "@/lib/keyword-batches";
import {
  CSV_TEMPLATE_CONTENT,
  MAX_CSV_IMPORT_ROWS,
  parseKeywordCsvPreview,
} from "@/lib/csv-import";
import {
  addKeywordAction,
  addKeywordGroupAction,
  deleteKeywordAction,
  deleteKeywordGroupAction,
  importKeywordsCsvAction,
  toggleKeywordActiveAction,
} from "@/app/(dashboard)/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExportCsvButton } from "@/components/export-csv-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchScheduleCalendar } from "@/components/batch-schedule-calendar";
import { SimpleTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<HeatmapCellState, string> = {
  0: "No AI Overview",
  1: "Not detected",
  2: "Detected",
};

function miniCellClass(state: HeatmapCellState): string {
  if (state === 2) {
    return "h-4 w-3 rounded-[3px] bg-[var(--cite)]";
  }
  if (state === 1) {
    return "h-4 w-3 rounded-[3px] bg-[var(--seen-bg)] inset-ring inset-ring-[var(--seen)]";
  }
  return "h-4 w-3 rounded-[3px] bg-[var(--none)]";
}

const columnHelper = createColumnHelper<KeywordWeeklyRow>();

export function KeywordManagerClient({
  rows,
  groups,
  batches = [],
  slots = [],
  scheduleSettings,
  monthlyRunCount = 0,
  auditLogs = [],
}: {
  rows: KeywordWeeklyRow[];
  groups: Array<{ id: string; name: string }>;
  batches?: BatchWithKeywordsCount[];
  slots?: BatchScheduleSlotWithBatch[];
  scheduleSettings?: BatchScheduleSettingsRecord;
  monthlyRunCount?: number;
  auditLogs?: BatchAuditLogRecord[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get("tab");
  const initialTab = useMemo(() => {
    if (tabParam === "schedule") return "schedule";
    if (tabParam === "groups") return "groups";
    return "keywords";
  }, [tabParam]);

  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedStatus, setSelectedStatus] = useState(() => {
    if (tabParam === "active") return "2";
    if (tabParam === "archived") return "0";
    return searchParams.get("status") ?? "";
  });
  const [selectedBatch, setSelectedBatch] = useState("");
  const [showCsvPanel, setShowCsvPanel] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  useEffect(() => {
    if (tabParam === "schedule" || tabParam === "groups") {
      setActiveTab(tabParam);
    } else {
      setActiveTab("keywords");
    }
  }, [tabParam]);

  const handleTabChange = useCallback(
    (newTab: string) => {
      setActiveTab(newTab);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", newTab);
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const existingKeywords = useMemo(
    () => rows.map((r) => r.keyword),
    [rows]
  );
  const existingGroupNames = useMemo(
    () => groups.map((g) => g.name),
    [groups]
  );

  const csvPreview = useMemo(() => {
    if (!csvText.trim()) return null;
    return parseKeywordCsvPreview(
      csvText,
      existingKeywords,
      existingGroupNames
    );
  }, [csvText, existingKeywords, existingGroupNames]);

  function handleDownloadCsvTemplate() {
    const blob = new Blob([CSV_TEMPLATE_CONTENT], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "template-keyword-linovhr.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file, "utf-8");
  }

  function handleConfirmCsvImport() {
    if (!csvPreview || csvPreview.validRows.length === 0) return;
    setFeedback(null);
    const fd = new FormData();
    fd.set("csvText", csvText);

    setPendingActionId("import-csv");
    startTransition(async () => {
      try {
        const res = await importKeywordsCsvAction(fd);
        setFeedback({
          type: res.ok ? "success" : "error",
          text: res.message,
        });
        if (res.ok) {
          setCsvText("");
          setCsvFileName("");
          setShowCsvPanel(false);
        }
      } finally {
        setPendingActionId(null);
      }
    });
  }

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.keyword.toLowerCase().includes(q)) return false;
      if (selectedGroup && r.groupName !== selectedGroup) return false;
      if (
        selectedStatus !== "" &&
        String(r.currentState) !== selectedStatus
      ) {
        return false;
      }
      if (selectedBatch) {
        if (selectedBatch === "unassigned") {
          if (r.batchId) return false;
        } else if (r.batchId !== selectedBatch) {
          return false;
        }
      }
      return true;
    });
  }, [rows, searchQuery, selectedGroup, selectedStatus, selectedBatch]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("keyword", {
        header: "Keyword",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-2">
              <Link
                href={`/keywords/${row.id}`}
                className="font-semibold text-[var(--ink)] hover:underline"
              >
                {row.keyword}
              </Link>
              {!row.active && <Badge variant="none">Inactive</Badge>}
            </div>
          );
        },
      }),
      columnHelper.accessor("groupName", {
        header: "Group",
        cell: (info) => info.getValue() || "No group",
      }),
      columnHelper.accessor("batchName", {
        header: "Batch",
        cell: (info) => {
          const row = info.row.original;
          const batch = batches?.find((b) => b.id === row.batchId);
          return (
            <div className="flex items-center gap-1.5">
              {batch ? (
                <Badge
                  variant="outline"
                  className={
                    batch.is_active
                      ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium"
                      : "border-[var(--line)] bg-[var(--none)] text-[var(--muted)]"
                  }
                >
                  {batch.name}
                  {batch.is_active && " (Active)"}
                </Badge>
              ) : (
                <span className="text-[12px] text-[var(--muted)]">Unassigned</span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("currentState", {
        header: "This week",
        cell: (info) => {
          const st = info.getValue();
          const variant =
            st === 2 ? "cited" : st === 1 ? "notDetected" : "none";
          return <Badge variant={variant}>{STATUS_LABELS[st]}</Badge>;
        },
      }),
      columnHelper.accessor("detectionTypeLabel", {
        header: "Detection type",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("weeklyStates", {
        header: "8 weeks",
        cell: (info) => (
          <div className="flex gap-[2px]">
            {info.getValue().map((st, idx) => (
              <div key={idx} className={miniCellClass(st)} />
            ))}
          </div>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only sm:not-sr-only">Actions</span>,
        cell: (info) => {
          const row = info.row.original;
          const isToggling = pendingActionId === `toggle-${row.id}`;
          const isDeleting = pendingActionId === `delete-${row.id}`;
          return (
            <div className="flex items-center justify-end sm:justify-center gap-1">
              <SimpleTooltip content={row.active ? "Deactivate keyword" : "Activate keyword"}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={row.active ? "Deactivate keyword" : "Activate keyword"}
                  disabled={isPending || isToggling}
                  onClick={() => {
                    setPendingActionId(`toggle-${row.id}`);
                    startTransition(async () => {
                      try {
                        const res = await toggleKeywordActiveAction(
                          row.id,
                          !row.active
                        );
                        if (!res.ok) {
                          setFeedback({
                            type: "error",
                            text: res.message ?? "Failed to update keyword status.",
                          });
                        }
                      } finally {
                        setPendingActionId(null);
                      }
                    });
                  }}
                  className={cn(
                    "h-7 w-7 p-0 inline-flex items-center justify-center rounded-md cursor-pointer transition-colors",
                    row.active
                      ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                      : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--none)]"
                  )}
                >
                  {isToggling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                </Button>
              </SimpleTooltip>

              <SimpleTooltip content="View keyword details & citations">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0 inline-flex items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--none)] cursor-pointer"
                >
                  <Link href={`/keywords/${row.id}`} aria-label="View keyword details">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </SimpleTooltip>

              <SimpleTooltip content="Delete keyword">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  aria-label="Delete keyword"
                  disabled={isPending || isDeleting}
                  onClick={() => {
                    setPendingActionId(`delete-${row.id}`);
                    startTransition(async () => {
                      try {
                        const res = await deleteKeywordAction(row.id);
                        if (!res.ok) {
                          setFeedback({
                            type: "error",
                            text: res.message ?? "Failed to delete keyword.",
                          });
                        }
                      } finally {
                        setPendingActionId(null);
                      }
                    });
                  }}
                  className="h-7 w-7 p-0 inline-flex items-center justify-center rounded-md cursor-pointer hover:bg-red-600/90 text-white"
                >
                  {isDeleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </SimpleTooltip>
            </div>
          );
        },
      }),
    ],
    [isPending, pendingActionId, batches]
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const allGroupNames = useMemo(() => {
    const names = new Set<string>(groups.map((g) => g.name));
    for (const r of rows) {
      if (r.groupName) names.add(r.groupName);
    }
    return Array.from(names).sort();
  }, [groups, rows]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5">
        {feedback && (
          <Alert variant={feedback.type === "success" ? "success" : "destructive"}>
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        )}

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="space-y-4"
        >
        <div className="sticky top-[var(--top-nav-height,100px)] z-30 -mx-4 px-4 py-3 bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--line)] mb-4 transition-all flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[18px] sm:text-[20px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                Keyword &amp; Batch Hub
              </h1>
              <Badge
                variant="outline"
                className="text-[11px] font-mono text-[var(--cite)] border-[var(--cite)]/30 bg-[var(--cite)]/5 transition-all duration-300"
              >
                {activeTab === "keywords" && `${rows.length} Keywords`}
                {activeTab === "schedule" && `${batches.length} Batches`}
                {activeTab === "groups" && `${groups.length} Groups`}
              </Badge>
            </div>
            <p className="mt-0.5 text-[12px] sm:text-[13px] text-[var(--muted)] transition-opacity duration-200">
              {activeTab === "keywords" && "Manage monitored search keywords, active states, and assignment to rotation batches."}
              {activeTab === "schedule" && "Explore multi-month schedule, automated Monday rotations, and batch calendar slots."}
              {activeTab === "groups" && "Organize keywords into LinovHR product modules and business department groupings."}
            </p>
          </div>

          <TabsList className="h-auto p-1 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-xs gap-1">
            <TabsTrigger
              value="keywords"
              className="gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold data-[state=active]:bg-[var(--cite)] data-[state=active]:text-white transition-all duration-200 group cursor-pointer"
            >
              <Key className="h-3.5 w-3.5 text-[var(--cite)] group-data-[state=active]:text-white transition-colors" />
              <span>Keywords</span>
              <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-[var(--line)]/60 px-1.5 py-0.2 text-[10px] font-mono text-[var(--muted)] group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white transition-colors">
                {rows.length}
              </span>
            </TabsTrigger>

            <TabsTrigger
              value="schedule"
              className="gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold data-[state=active]:bg-[var(--cite)] data-[state=active]:text-white transition-all duration-200 group cursor-pointer"
            >
              <CalendarIcon className="h-3.5 w-3.5 text-[var(--cite)] group-data-[state=active]:text-white transition-colors" />
              <span>Schedule &amp; Batches</span>
              <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-[var(--line)]/60 px-1.5 py-0.2 text-[10px] font-mono text-[var(--muted)] group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white transition-colors">
                {batches.length}
              </span>
            </TabsTrigger>

            <TabsTrigger
              value="groups"
              className="gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold data-[state=active]:bg-[var(--cite)] data-[state=active]:text-white transition-all duration-200 group cursor-pointer"
            >
              <FolderTree className="h-3.5 w-3.5 text-[var(--cite)] group-data-[state=active]:text-white transition-colors" />
              <span>Groups</span>
              <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-[var(--line)]/60 px-1.5 py-0.2 text-[10px] font-mono text-[var(--muted)] group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white transition-colors">
                {groups.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Keywords Management */}
        <TabsContent value="keywords" className="space-y-4 pt-1 animate-tab-fade-in">
          <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Add new keyword</CardTitle>
                <CardDescription>
                  Add an individual keyword or import a list via CSV.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ExportCsvButton />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCsvTemplate}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV template
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowCsvPanel((prev) => !prev)}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {showCsvPanel ? "Close CSV import" : "Import CSV"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              action={(formData) => {
                setPendingActionId("add-keyword");
                startTransition(async () => {
                  try {
                    const res = await addKeywordAction(formData);
                    setFeedback({
                      type: res.ok ? "success" : "error",
                      text: res.message,
                    });
                  } finally {
                    setPendingActionId(null);
                  }
                });
              }}
              className="flex flex-wrap items-end gap-2.5"
            >
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label htmlFor="kw-text">Keyword</Label>
                <Input
                  id="kw-text"
                  name="text"
                  placeholder="e.g. best payroll software"
                  required
                  disabled={isPending || pendingActionId === "add-keyword"}
                />
              </div>

              <div className="min-w-[160px] space-y-1.5">
                <Label htmlFor="kw-group">Select group</Label>
                <select
                  id="kw-group"
                  name="groupId"
                  disabled={isPending || pendingActionId === "add-keyword"}
                  className="flex h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--cite)] cursor-pointer disabled:opacity-50"
                >
                  <option value="">No group</option>
                  {groups.map((grp) => (
                    <option key={grp.id} value={grp.id}>
                      {grp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[150px] space-y-1.5">
                <Label htmlFor="kw-batch">Select batch</Label>
                <select
                  id="kw-batch"
                  name="batchId"
                  disabled={isPending || pendingActionId === "add-keyword"}
                  defaultValue={batches?.find((b) => b.is_active)?.id ?? ""}
                  className="flex h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--cite)] cursor-pointer disabled:opacity-50"
                >
                  <option value="">No batch</option>
                  {batches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.is_active ? "(Active)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[160px] space-y-1.5">
                <Label htmlFor="kw-new-group">Or create new group</Label>
                <Input
                  id="kw-new-group"
                  name="newGroupName"
                  placeholder="New group name"
                  disabled={isPending || pendingActionId === "add-keyword"}
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                disabled={isPending || pendingActionId === "add-keyword"}
              >
                {pendingActionId === "add-keyword" ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Saving keyword...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" />
                    Save keyword
                  </>
                )}
              </Button>
            </form>

            {showCsvPanel && (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--ink)]">
                      Import Keywords from CSV (maximum {MAX_CSV_IMPORT_ROWS} rows)
                    </h3>
                    <p className="text-xs text-[var(--muted)]">
                      Column format: <code>keyword,group</code>. Groups that do not
                      exist yet will be created automatically.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--none)] transition-colors shadow-xs">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--cite)]" />
                    Choose .csv file
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleCsvFileChange}
                      className="hidden"
                    />
                  </label>
                </div>

                {csvFileName && (
                  <p className="text-xs text-[var(--muted)]">
                    Selected file: <strong className="font-mono">{csvFileName}</strong>
                  </p>
                )}

                <Textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={4}
                  placeholder={CSV_TEMPLATE_CONTENT}
                  className="font-mono text-xs bg-[var(--surface)]"
                />

                {csvPreview && (
                  <div className="space-y-2.5 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 shadow-xs">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-[var(--ink)]">
                        Import Preview:
                      </span>
                      <Badge variant="detected">
                        {csvPreview.validRows.length} new
                      </Badge>
                      <Badge variant="notDetected">
                        {csvPreview.duplicateRows.length} duplicates
                      </Badge>
                      <Badge variant="none">
                        {csvPreview.invalidRows.length} invalid
                      </Badge>
                      {csvPreview.newGroupsToCreate.length > 0 && (
                        <Badge variant="brand">
                          {csvPreview.newGroupsToCreate.length} new groups:{" "}
                          {csvPreview.newGroupsToCreate.join(", ")}
                        </Badge>
                      )}
                    </div>

                    {csvPreview.exceededMaxRows && (
                      <p className="rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-bg)] px-3 py-2 text-xs font-semibold text-[var(--destructive-text)]">
                        Row count exceeds maximum limit of {MAX_CSV_IMPORT_ROWS}{" "}
                        rows per import. Reduce row count before saving.
                      </p>
                    )}

                    {csvPreview.duplicateRows.length > 0 && (
                      <div className="max-h-28 overflow-y-auto rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] p-2.5 text-xs">
                        <div className="mb-1 font-semibold text-[var(--warning-text)]">
                          Duplicate Rows ({csvPreview.duplicateRows.length} skipped):
                        </div>
                        <ul className="space-y-0.5 text-[var(--warning-text)]">
                          {csvPreview.duplicateRows.slice(0, 15).map((d) => (
                            <li key={`${d.lineNumber}-${d.keyword}`}>
                              Line {d.lineNumber}:{" "}
                              <strong className="font-mono">{d.keyword}</strong> —{" "}
                              {d.reason}
                            </li>
                          ))}
                          {csvPreview.duplicateRows.length > 15 && (
                            <li>
                              ...and {csvPreview.duplicateRows.length - 15} more
                              duplicate rows.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {csvPreview.invalidRows.length > 0 && (
                      <div className="max-h-28 overflow-y-auto rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-bg)] p-2.5 text-xs">
                        <div className="mb-1 font-semibold text-[var(--destructive-text)]">
                          Invalid Rows ({csvPreview.invalidRows.length}):
                        </div>
                        <ul className="space-y-0.5 text-[var(--destructive-text)]">
                          {csvPreview.invalidRows.slice(0, 15).map((inv, i) => (
                            <li key={`${inv.lineNumber}-${i}`}>
                              Line {inv.lineNumber}:{" "}
                              <strong className="font-mono">
                                {inv.rawKeyword || "(empty)"}
                              </strong>{" "}
                              — {inv.reason}
                            </li>
                          ))}
                          {csvPreview.invalidRows.length > 15 && (
                            <li>
                              ...and {csvPreview.invalidRows.length - 15} more
                              invalid rows.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={
                          isPending ||
                          pendingActionId === "import-csv" ||
                          csvPreview.validRows.length === 0 ||
                          csvPreview.exceededMaxRows
                        }
                        onClick={handleConfirmCsvImport}
                      >
                        {pendingActionId === "import-csv" ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            Importing {csvPreview.validRows.length} keywords...
                          </>
                        ) : (
                          `Save ${csvPreview.validRows.length} new keywords`
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending || pendingActionId === "import-csv"}
                        onClick={() => {
                          setCsvText("");
                          setCsvFileName("");
                        }}
                      >
                        Clear preview
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keywords"
              aria-label="Search keywords"
              className="min-w-[160px] flex-1"
            />
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              aria-label="Filter by group"
              className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)]"
            >
              <option value="">All groups</option>
              {allGroupNames.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label="Filter by status"
              className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)]"
            >
              <option value="">All statuses</option>
              <option value="2">Detected</option>
              <option value="1">Not detected</option>
              <option value="0">No AI Overview</option>
            </select>
            <select
              value={selectedBatch}
              onChange={(e) => setSelectedBatch(e.target.value)}
              aria-label="Filter by batch"
              className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)]"
            >
              <option value="">All batches</option>
              {batches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.is_active ? "(Active)" : ""}
                </option>
              ))}
              <option value="unassigned">Unassigned</option>
            </select>
          </div>

          <div className="relative w-full overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-xs">
            <Table className="min-w-[920px] border-separate border-spacing-0">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const isWeeklyStates = header.column.id === "weeklyStates";
                      const isActions = header.column.id === "actions";
                      return (
                        <TableHead
                          key={header.id}
                          className={cn(
                            "whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-[var(--muted)] bg-[var(--surface)] border-b border-[var(--line)]",
                            isWeeklyStates &&
                              "sticky right-[104px] z-20 w-[116px] min-w-[116px] border-l border-[var(--line)] shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]",
                            isActions &&
                              "sticky right-0 z-20 w-[104px] min-w-[104px] text-center shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.04)]",
                            !isWeeklyStates &&
                              !isActions &&
                              (header.column.id === "keyword"
                                ? "min-w-[220px]"
                                : header.column.id === "groupName"
                                ? "min-w-[130px]"
                                : header.column.id === "batchName"
                                ? "min-w-[140px]"
                                : header.column.id === "currentState"
                                ? "min-w-[120px]"
                                : "min-w-[130px]")
                          )}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="py-8 text-center text-sm text-[var(--muted)]"
                    >
                      {rows.length === 0
                        ? "No keywords saved yet. Use the form above to add your first keyword."
                        : "No matching keywords found. Adjust your search or filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="group border-b border-[var(--line)] hover:bg-[var(--none)]/30 transition-colors"
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isWeeklyStates = cell.column.id === "weeklyStates";
                        const isActions = cell.column.id === "actions";
                        return (
                          <TableCell
                            key={cell.id}
                            className={cn(
                              "whitespace-nowrap px-3 py-2 text-sm border-b border-[var(--line)]",
                              isWeeklyStates &&
                                "sticky right-[104px] z-10 w-[116px] min-w-[116px] bg-[var(--surface)] group-hover:bg-[var(--surface)] border-l border-[var(--line)] shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]",
                              isActions &&
                                "sticky right-0 z-10 w-[104px] min-w-[104px] bg-[var(--surface)] group-hover:bg-[var(--surface)] shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.04)]",
                              !isWeeklyStates &&
                                !isActions &&
                                (cell.column.id === "keyword"
                                  ? "min-w-[220px]"
                                  : cell.column.id === "groupName"
                                  ? "min-w-[130px]"
                                  : cell.column.id === "batchName"
                                  ? "min-w-[140px]"
                                  : cell.column.id === "currentState"
                                  ? "min-w-[120px]"
                                  : "min-w-[130px]")
                            )}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    {/* Tab 2: Batches & 4-Week Schedule Calendar */}
    <TabsContent value="schedule" className="space-y-4 pt-1 animate-tab-fade-in">
      <BatchScheduleCalendar
        initialBatches={batches}
        initialSlots={slots}
        initialSettings={
          scheduleSettings ?? {
            id: 1,
            mode: "auto",
            max_runs_per_month: 4,
            override_until: null,
            updated_at: "",
          }
        }
        monthlyRunCount={monthlyRunCount}
        initialAuditLogs={auditLogs}
        availableKeywords={rows.map((r) => ({
          id: r.id,
          text: r.keyword,
          batch_id: r.batchId ?? null,
          batch_name: r.batchName ?? null,
          active: r.active,
        }))}
      />
    </TabsContent>

    {/* Tab 3: Keyword Product Groups */}
    <TabsContent value="groups" className="space-y-4 pt-1 animate-tab-fade-in">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-[var(--ink)]">
                Keyword Product Groups ({groups.length})
              </CardTitle>
              <CardDescription className="text-xs text-[var(--muted)]">
                Organize search keywords by LinovHR products or business departments.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            action={(formData) => {
              setPendingActionId("add-group");
              startTransition(async () => {
                try {
                  const res = await addKeywordGroupAction(formData);
                  setFeedback({
                    type: res.ok ? "success" : "error",
                    text: res.message,
                  });
                } finally {
                  setPendingActionId(null);
                }
              });
            }}
            className="flex max-w-md gap-2"
          >
            <Input
              name="name"
              placeholder="New group name (e.g. Payroll System)"
              required
              disabled={isPending || pendingActionId === "add-group"}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={isPending || pendingActionId === "add-group"}
            >
              {pendingActionId === "add-group" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Saving group...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Save group
                </>
              )}
            </Button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
            {groups.length === 0 ? (
              <p className="text-xs text-[var(--muted)] col-span-full">
                No groups created yet. Use the form above to add a group.
              </p>
            ) : (
              groups.map((grp) => {
                const countInGroup = rows.filter((r) => r.groupName === grp.name).length;
                const isDeletingThisGroup = pendingActionId === `delete-group-${grp.id}`;
                return (
                  <div
                    key={grp.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-xs"
                  >
                    <div>
                      <div className="font-semibold text-sm text-[var(--ink)]">{grp.name}</div>
                      <div className="text-xs text-[var(--muted)] font-mono">{countInGroup} keywords</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending || isDeletingThisGroup}
                      onClick={() => {
                        setPendingActionId(`delete-group-${grp.id}`);
                        startTransition(async () => {
                          try {
                            await deleteKeywordGroupAction(grp.id);
                          } finally {
                            setPendingActionId(null);
                          }
                        });
                      }}
                      className="h-8 w-8 p-0 text-[var(--muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 cursor-pointer"
                      title="Delete group"
                    >
                      {isDeletingThisGroup ? (
                        <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</div>
</TooltipProvider>
);
}
