"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
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
}: {
  rows: KeywordWeeklyRow[];
  groups: Array<{ id: string; name: string }>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [showCsvPanel, setShowCsvPanel] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

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

    startTransition(async () => {
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
      return true;
    });
  }, [rows, searchQuery, selectedGroup, selectedStatus]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("keyword", {
        header: "Keyword",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-2">
              <Link
                href={`/keyword/${row.id}`}
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
        header: "Actions",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
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
                  });
                }}
              >
                <Power className="h-3.5 w-3.5" />
                {row.active ? "Deactivate keyword" : "Activate keyword"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await deleteKeywordAction(row.id);
                    if (!res.ok) {
                      setFeedback({
                        type: "error",
                        text: res.message ?? "Failed to delete keyword.",
                      });
                    }
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete keyword
              </Button>
            </div>
          );
        },
      }),
    ],
    [isPending]
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
                startTransition(async () => {
                  const res = await addKeywordAction(formData);
                  setFeedback({
                    type: res.ok ? "success" : "error",
                    text: res.message,
                  });
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
                  disabled={isPending}
                />
              </div>

              <div className="min-w-[160px] space-y-1.5">
                <Label htmlFor="kw-group">Select group</Label>
                <select
                  id="kw-group"
                  name="groupId"
                  disabled={isPending}
                  className="flex h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--cite)] cursor-pointer"
                >
                  <option value="">No group</option>
                  {groups.map((grp) => (
                    <option key={grp.id} value={grp.id}>
                      {grp.name}
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
                  disabled={isPending}
                />
              </div>

              <Button type="submit" variant="primary" disabled={isPending}>
                <Plus className="h-4 w-4" />
                Save keyword
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
                  <div className="space-y-2.5 rounded-md border border-[var(--line)] bg-white p-3">
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
                      <p className="text-xs font-medium text-[#C0392B]">
                        Row count exceeds maximum limit of {MAX_CSV_IMPORT_ROWS}{" "}
                        rows per import. Reduce row count before saving.
                      </p>
                    )}

                    {csvPreview.duplicateRows.length > 0 && (
                      <div className="max-h-28 overflow-y-auto rounded border border-[var(--line)] bg-[#FFFBEB] p-2 text-xs">
                        <div className="mb-1 font-semibold text-[#92400E]">
                          Duplicate Rows ({csvPreview.duplicateRows.length} skipped):
                        </div>
                        <ul className="space-y-0.5 text-[#B45309]">
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
                      <div className="max-h-28 overflow-y-auto rounded border border-[#FECACA] bg-[#FEF2F2] p-2 text-xs">
                        <div className="mb-1 font-semibold text-[#991B1B]">
                          Invalid Rows ({csvPreview.invalidRows.length}):
                        </div>
                        <ul className="space-y-0.5 text-[#B91C1C]">
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
                          csvPreview.validRows.length === 0 ||
                          csvPreview.exceededMaxRows
                        }
                        onClick={handleConfirmCsvImport}
                      >
                        {isPending
                          ? "Saving..."
                          : `Save ${csvPreview.validRows.length} new keywords`}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
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
          <CardHeader>
            <CardTitle>Manage keyword groups</CardTitle>
            <CardDescription>
              Organize keywords by topic.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              action={(formData) => {
                startTransition(async () => {
                  const res = await addKeywordGroupAction(formData);
                  setFeedback({
                    type: res.ok ? "success" : "error",
                    text: res.message,
                  });
                });
              }}
              className="flex gap-2"
            >
              <Input
                name="name"
                placeholder="New group name"
                required
                disabled={isPending}
              />
              <Button type="submit" variant="outline" disabled={isPending}>
                Save group
              </Button>
            </form>

            {groups.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                No groups created yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {groups.map((grp) => (
                  <span
                    key={grp.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--none)] px-2.5 py-1 text-xs font-medium"
                  >
                    {grp.name}
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          await deleteKeywordGroupAction(grp.id);
                        });
                      }}
                      className="ml-0.5 text-[#C0392B] hover:underline cursor-pointer"
                      aria-label={`Delete group ${grp.name}`}
                    >
                      Delete
                    </button>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
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
          </div>

          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
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
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
