"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ExportDataDialogProps {
  buttonLabel?: string;
  variant?: "outline" | "primary" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  summaryMetrics?: {
    totalKeywords?: number;
    detectedCount?: number;
    detectionRate?: number;
  };
}

export function ExportDataDialog({
  buttonLabel = "Export Data",
  variant = "outline",
  size = "sm",
  className,
  summaryMetrics,
}: ExportDataDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"latest" | "history">("latest");
  const [format, setFormat] = useState<"csv" | "excel">("csv");

  const defaultToDate = new Date().toISOString().slice(0, 10);
  const defaultFromDate = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);

  function buildExportUrl(): string {
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("format", format);
    if (mode === "history") {
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
    }
    return `/api/export?${params.toString()}`;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={cn("gap-1.5 cursor-pointer", className)}
        >
          <Download className="h-3.5 w-3.5" />
          <span>{buttonLabel}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[var(--ink)]">
            Export AI Overview Monitoring Data
          </DialogTitle>
          <DialogDescription className="text-xs">
            Export search keywords, SERP citation results, and AI Overview trigger data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1 text-xs">
          {/* Summary Preview if available */}
          {summaryMetrics && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-hover)] p-2.5 text-center">
              <div>
                <div className="text-[10px] text-[var(--muted)] uppercase font-semibold">
                  Keywords
                </div>
                <div className="font-bold text-sm text-[var(--ink)] font-mono">
                  {summaryMetrics.totalKeywords ?? "-"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--muted)] uppercase font-semibold">
                  Detected
                </div>
                <div className="font-bold text-sm text-[var(--cite)] font-mono">
                  {summaryMetrics.detectedCount ?? "-"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--muted)] uppercase font-semibold">
                  Rate
                </div>
                <div className="font-bold text-sm text-[var(--cite)] font-mono">
                  {summaryMetrics.detectionRate !== undefined
                    ? `${summaryMetrics.detectionRate}%`
                    : "-"}
                </div>
              </div>
            </div>
          )}

          {/* Format Selector */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[var(--ink)]">
              File Format
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormat("csv")}
                className={cn(
                  "flex items-center gap-2 p-2.5 rounded-lg border text-left cursor-pointer transition-all",
                  format === "csv"
                    ? "border-[var(--cite)] bg-[var(--cite-bg)]/25 text-[var(--ink)] ring-1 ring-[var(--cite)]"
                    : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                )}
              >
                <FileText className="h-4 w-4 shrink-0 text-[var(--cite)]" />
                <div>
                  <div className="font-bold text-xs text-[var(--ink)]">CSV (.csv)</div>
                  <div className="text-[10px] text-[var(--muted)]">Universal delimiter</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat("excel")}
                className={cn(
                  "flex items-center gap-2 p-2.5 rounded-lg border text-left cursor-pointer transition-all",
                  format === "excel"
                    ? "border-[var(--cite)] bg-[var(--cite-bg)]/25 text-[var(--ink)] ring-1 ring-[var(--cite)]"
                    : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                )}
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <div className="font-bold text-xs text-[var(--ink)]">Excel (.csv / BOM)</div>
                  <div className="text-[10px] text-[var(--muted)]">UTF-8 spreadsheet</div>
                </div>
              </button>
            </div>
          </div>

          {/* Data Scope Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[var(--ink)]">
              Data Scope
            </Label>
            <div className="space-y-2">
              <label className={cn(
                "flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors",
                mode === "latest" ? "border-[var(--cite)] bg-[var(--cite-bg)]/15" : "border-[var(--line)] hover:bg-[var(--none)]/30"
              )}>
                <input
                  type="radio"
                  name="export-dialog-mode"
                  value="latest"
                  checked={mode === "latest"}
                  onChange={() => setMode("latest")}
                  className="mt-0.5 accent-[var(--cite)]"
                />
                <div className="space-y-0.5">
                  <div className="font-semibold text-[var(--ink)]">
                    Latest result per keyword
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    One most recent check for every active monitored keyword.
                  </div>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors",
                mode === "history" ? "border-[var(--cite)] bg-[var(--cite-bg)]/15" : "border-[var(--line)] hover:bg-[var(--none)]/30"
              )}>
                <input
                  type="radio"
                  name="export-dialog-mode"
                  value="history"
                  checked={mode === "history"}
                  onChange={() => setMode("history")}
                  className="mt-0.5 accent-[var(--cite)]"
                />
                <div className="space-y-0.5">
                  <div className="font-semibold text-[var(--ink)]">
                    Full history within date range
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    All check records recorded within the selected period.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Date range picker for history mode */}
          {mode === "history" && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-hover)] p-2.5">
              <div className="space-y-1">
                <Label htmlFor="export-from-date" className="text-[11px] text-[var(--muted)]">
                  From date
                </Label>
                <Input
                  id="export-from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 text-xs bg-[var(--surface)]"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="export-to-date" className="text-[11px] text-[var(--muted)]">
                  To date
                </Label>
                <Input
                  id="export-to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 text-xs bg-[var(--surface)]"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            asChild
            variant="primary"
            size="sm"
            onClick={() => setOpen(false)}
            className="gap-1.5"
          >
            <a href={buildExportUrl()} download>
              <Download className="h-3.5 w-3.5" />
              Download {format === "excel" ? "Excel" : "CSV"}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Alias untuk backward compatibility */
export const ExportCsvButton = ExportDataDialog;
