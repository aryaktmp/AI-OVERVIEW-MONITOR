"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Layers,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ExportDataDialog } from "@/components/export-csv-button";
import { SimpleTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { HeatmapCellState, KeywordWeeklyRow, WeekBucket } from "@/lib/analytics";

export interface OverviewHeatmapCardProps {
  weeks: WeekBucket[];
  keywordRows: KeywordWeeklyRow[];
  totalKeywords: number;
  detectedCount: number;
  detectionRate: number;
}

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50];

function getCellClassName(state: HeatmapCellState): string {
  if (state === 2) {
    return "h-[22px] rounded-[3px] bg-[var(--cite)] transition-opacity hover:opacity-85";
  }
  if (state === 1) {
    return "h-[22px] rounded-[3px] bg-[var(--seen-bg)] inset-ring inset-ring-[var(--seen)] transition-opacity hover:opacity-85";
  }
  return "h-[22px] rounded-[3px] bg-[var(--none)] transition-opacity hover:opacity-85";
}

function getCellStatusLabel(state: HeatmapCellState): string {
  if (state === 2) return "LinovHR Detected";
  if (state === 1) return "AI Overview Present (LinovHR Not Cited)";
  return "AI Overview Not Present";
}

export function OverviewHeatmapCard({
  weeks,
  keywordRows,
  totalKeywords,
  detectedCount,
  detectionRate,
}: OverviewHeatmapCardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "accordion">("table");
  const [pageSize, setPageSize] = useState<number>(15);
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Ekstrak daftar grup unik beserta jumlah keyword
  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    keywordRows.forEach((r) => {
      const g = r.groupName || "No Group";
      counts.set(g, (counts.get(g) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [keywordRows]);

  // Filter baris data berdasarkan pencarian, grup, dan status
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return keywordRows.filter((row) => {
      // 1. Pencarian teks
      if (q && !row.keyword.toLowerCase().includes(q)) {
        return false;
      }

      // 2. Filter grup
      if (selectedGroup !== "all" && row.groupName !== selectedGroup) {
        return false;
      }

      // 3. Filter status
      if (selectedStatus === "detected") {
        // Cek minggu terakhir / state aktif
        if (row.currentState !== 2) return false;
      } else if (selectedStatus === "seen") {
        if (row.currentState !== 1) return false;
      } else if (selectedStatus === "none") {
        if (row.currentState !== 0) return false;
      } else if (selectedStatus === "ever_detected") {
        // Pernah tersitasi di salah satu dari 8 minggu
        if (!row.weeklyStates.includes(2)) return false;
      }

      return true;
    });
  }, [keywordRows, searchQuery, selectedGroup, selectedStatus]);

  // Kalkulasi paginasi
  const totalFiltered = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(pageIndex, totalPages - 1);

  const paginatedRows = useMemo(() => {
    const start = currentPage * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  // Data terkelompok untuk mode accordion
  const rowsByGroup = useMemo(() => {
    const map = new Map<string, KeywordWeeklyRow[]>();
    filteredRows.forEach((row) => {
      const g = row.groupName || "No Group";
      const existing = map.get(g) ?? [];
      existing.push(row);
      map.set(g, existing);
    });
    return map;
  }, [filteredRows]);

  // Reset page index saat filter berubah
  function handleFilterChange(updater: () => void) {
    updater();
    setPageIndex(0);
  }

  function toggleGroupAccordion(groupName: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  }

  function expandAllGroups() {
    setExpandedGroups(new Set(Array.from(rowsByGroup.keys())));
  }

  function collapseAllGroups() {
    setExpandedGroups(new Set());
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold text-[var(--ink)]">
                  Keyword status over the last 8 weeks
                </CardTitle>
                <Badge
                  variant="outline"
                  className="font-mono text-[11px] font-medium"
                >
                  {filteredRows.length}{" "}
                  {filteredRows.length !== totalKeywords
                    ? `of ${totalKeywords}`
                    : "keywords"}
                </Badge>
              </div>
              <CardDescription className="text-xs mt-0.5">
                Weekly AI Overview trigger and LinovHR citation matrix. The rightmost
                column is the current week.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Toggle Mode: Paginated Table vs Grouped Accordion */}
              <div className="flex items-center rounded-lg border border-[var(--line)] bg-[var(--surface-hover)] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer",
                    viewMode === "table"
                      ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  )}
                  title="Paginated Table View"
                >
                  <ListFilter className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("accordion");
                    if (expandedGroups.size === 0) {
                      expandAllGroups();
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer",
                    viewMode === "accordion"
                      ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  )}
                  title="Grouped Accordion View"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">By Group</span>
                </button>
              </div>

              {/* Tombol Ekspor Excel / CSV */}
              <ExportDataDialog
                buttonLabel="Export Matrix"
                summaryMetrics={{
                  totalKeywords,
                  detectedCount,
                  detectionRate,
                }}
              />
            </div>
          </div>

          {/* Filter & Search Toolbar */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-12 items-center">
            {/* Input Search */}
            <div className="relative sm:col-span-5">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--muted)]" />
              <Input
                type="text"
                placeholder="Search keyword..."
                value={searchQuery}
                onChange={(e) =>
                  handleFilterChange(() => setSearchQuery(e.target.value))
                }
                className="h-8.5 pl-8 pr-7 text-xs bg-[var(--surface)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => handleFilterChange(() => setSearchQuery(""))}
                  className="absolute right-2 top-2.5 text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter Group Dropdown */}
            <div className="sm:col-span-4">
              <select
                aria-label="Filter keyword group"
                value={selectedGroup}
                onChange={(e) =>
                  handleFilterChange(() => setSelectedGroup(e.target.value))
                }
                className="h-8.5 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--cite)] cursor-pointer"
              >
                <option value="all">All Groups ({totalKeywords})</option>
                {groupOptions.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name} ({g.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Filter Status Dropdown */}
            <div className="sm:col-span-3">
              <select
                aria-label="Filter citation status"
                value={selectedStatus}
                onChange={(e) =>
                  handleFilterChange(() => setSelectedStatus(e.target.value))
                }
                className="h-8.5 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--cite)] cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="detected">LinovHR Cited (Latest)</option>
                <option value="seen">AI Overview (Uncited)</option>
                <option value="none">No AI Overview</option>
                <option value="ever_detected">Ever Cited (8 Weeks)</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-1">
          {/* Skenario: Data Hasil Filter Kosong */}
          {filteredRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--line)] p-8 text-center text-xs text-[var(--muted)]">
              <Filter className="mx-auto h-7 w-7 opacity-40 mb-2" />
              <div className="font-semibold text-[var(--ink)] text-sm">
                No keywords match your filter
              </div>
              <p className="mt-1">
                Try searching for another keyword or reset the group/status filter.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedGroup("all");
                  setSelectedStatus("all");
                  setPageIndex(0);
                }}
                className="mt-3 cursor-pointer"
              >
                Reset All Filters
              </Button>
            </div>
          ) : viewMode === "table" ? (
            /* ========================================================= */
            /* MODE A: PAGINATED TABLE VIEW (Default - Rapi & Compact)  */
            /* ========================================================= */
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
                <div className="min-w-[640px]">
                  {/* Table Header: Keyword Name + 8 Week Buckets */}
                  <div className="grid grid-cols-[minmax(240px,2fr)_repeat(8,minmax(38px,1fr))] items-center gap-[3px] bg-[var(--surface-hover)] border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold text-[var(--muted)]">
                    <div>Keyword & Product Module</div>
                    {weeks.map((w, idx) => {
                      const [day, month] = w.label.split(" ");
                      const isCurrentWeek = idx === weeks.length - 1;
                      return (
                        <div
                          key={w.index}
                          className={cn(
                            "text-center text-[10.5px] leading-tight",
                            isCurrentWeek && "font-bold text-[var(--cite)]"
                          )}
                          title={`${w.label} (Week ${idx + 1})`}
                        >
                          <div>{day}</div>
                          <div>{month}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Rows List */}
                  <div className="divide-y divide-[var(--line)]">
                    {paginatedRows.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[minmax(240px,2fr)_repeat(8,minmax(38px,1fr))] items-center gap-[3px] px-3 py-2 transition-colors hover:bg-[var(--surface-hover)]/70"
                      >
                        {/* Kolom 1: Keyword info */}
                        <div className="pr-3 min-w-0">
                          <Link
                            href={`/keywords/${row.id}`}
                            title={row.keyword}
                            className="block truncate text-xs font-medium text-[var(--ink)] hover:text-[var(--cite)] hover:underline"
                          >
                            {row.keyword}
                          </Link>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10.5px] text-[var(--muted)] truncate max-w-[140px]">
                              {row.groupName}
                            </span>
                            {row.batchName && (
                              <span className="text-[9.5px] font-mono rounded bg-[var(--surface-hover)] px-1 py-0.2 border border-[var(--line)] text-[var(--muted)] shrink-0">
                                {row.batchName}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Kolom 2-9: 8 Cells Heatmap */}
                        {row.weeklyStates.map((st, idx) => {
                          const wLabel = weeks[idx]?.label ?? `Week ${idx + 1}`;
                          const tooltipText = `${row.keyword} (${wLabel}): ${getCellStatusLabel(
                            st
                          )}`;

                          return (
                            <SimpleTooltip
                              key={idx}
                              content={
                                <div className="space-y-0.5 text-center">
                                  <div className="font-bold">{wLabel}</div>
                                  <div className="text-[10px] text-[var(--surface)]/90">
                                    {getCellStatusLabel(st)}
                                  </div>
                                </div>
                              }
                            >
                              <div
                                tabIndex={0}
                                aria-label={tooltipText}
                                className={getCellClassName(st)}
                              />
                            </SimpleTooltip>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Baris Kontrol Paginasi Standar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--muted)] px-1">
                <div className="flex items-center gap-2">
                  <span>
                    Showing{" "}
                    <strong className="text-[var(--ink)] font-mono">
                      {Math.min(currentPage * pageSize + 1, totalFiltered)}
                    </strong>
                    {" "}-{" "}
                    <strong className="text-[var(--ink)] font-mono">
                      {Math.min((currentPage + 1) * pageSize, totalFiltered)}
                    </strong>
                    {" "}of{" "}
                    <strong className="text-[var(--ink)] font-mono">
                      {totalFiltered}
                    </strong>{" "}
                    keywords
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Selector Rows per Page */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">Rows:</span>
                    <select
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPageIndex(0);
                      }}
                      className="h-7 rounded border border-[var(--line)] bg-[var(--surface)] px-1.5 text-xs text-[var(--ink)] cursor-pointer"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Indikator Halaman & Navigasi */}
                  <span className="text-[11px] font-mono">
                    Page {currentPage + 1} of {totalPages}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={() => setPageIndex(0)}
                      disabled={currentPage === 0}
                      title="First page"
                    >
                      <ChevronsLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                      title="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={() =>
                        setPageIndex((p) => Math.min(totalPages - 1, p + 1))
                      }
                      disabled={currentPage >= totalPages - 1}
                      title="Next page"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={() => setPageIndex(totalPages - 1)}
                      disabled={currentPage >= totalPages - 1}
                      title="Last page"
                    >
                      <ChevronsRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ========================================================= */
            /* MODE B: GROUPED ACCORDION VIEW (Collapsible per Modul)    */
            /* ========================================================= */
            <div className="space-y-2.5">
              <div className="flex justify-end gap-2 pb-1 text-xs">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={expandAllGroups}
                  className="h-7 text-xs text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                >
                  Expand all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={collapseAllGroups}
                  className="h-7 text-xs text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                >
                  Collapse all
                </Button>
              </div>

              {Array.from(rowsByGroup.entries()).map(([groupName, rows]) => {
                const isExpanded = expandedGroups.has(groupName);
                const citedThisWeek = rows.filter(
                  (r) => r.currentState === 2
                ).length;
                const aioThisWeek = rows.filter(
                  (r) => r.currentState >= 1
                ).length;

                return (
                  <div
                    key={groupName}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface)] overflow-hidden transition-all"
                  >
                    {/* Accordion Header */}
                    <button
                      type="button"
                      onClick={() => toggleGroupAccordion(groupName)}
                      className="w-full flex items-center justify-between p-3 bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-[var(--muted)] transition-transform duration-200",
                            isExpanded ? "rotate-180" : ""
                          )}
                        />
                        <span className="font-bold text-xs text-[var(--ink)]">
                          {groupName}
                        </span>
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          {rows.length} keywords
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-[11px] text-[var(--muted)]">
                          <strong className="text-[var(--cite)] font-mono">
                            {citedThisWeek}
                          </strong>
                          /{aioThisWeek} cited this week
                        </span>
                      </div>
                    </button>

                    {/* Accordion Content */}
                    {isExpanded && (
                      <div className="border-t border-[var(--line)] p-3 overflow-x-auto bg-[var(--surface)]">
                        <div className="grid min-w-[540px] grid-cols-[minmax(200px,2fr)_repeat(8,minmax(34px,1fr))] items-center gap-[3px]">
                          <div className="text-[11px] font-semibold text-[var(--muted)] pb-1">
                            Keyword
                          </div>
                          {weeks.map((w) => {
                            const [day, month] = w.label.split(" ");
                            return (
                              <div
                                key={w.index}
                                className="text-center text-[10.5px] leading-tight text-[var(--muted)] pb-1"
                              >
                                {day}
                                <br />
                                {month}
                              </div>
                            );
                          })}

                          {rows.map((row) => (
                            <div key={row.id} className="contents">
                              <Link
                                href={`/keywords/${row.id}`}
                                title={row.keyword}
                                className="truncate text-xs hover:underline text-[var(--ink)] py-1"
                              >
                                {row.keyword}
                              </Link>
                              {row.weeklyStates.map((st, idx) => (
                                <SimpleTooltip
                                  key={idx}
                                  content={
                                    <div className="space-y-0.5 text-center">
                                      <div className="font-bold">
                                        {weeks[idx]?.label}
                                      </div>
                                      <div className="text-[10px]">
                                        {getCellStatusLabel(st)}
                                      </div>
                                    </div>
                                  }
                                >
                                  <div className={getCellClassName(st)} />
                                </SimpleTooltip>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Legend / Keterangan Warna */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-[var(--muted)] border-t border-[var(--line)] pt-3">
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
    </TooltipProvider>
  );
}
