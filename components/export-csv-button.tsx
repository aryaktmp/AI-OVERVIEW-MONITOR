"use client";

import { useState } from "react";
import { Download } from "lucide-react";
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

export function ExportCsvButton() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"latest" | "history">("latest");

  const defaultToDate = new Date().toISOString().slice(0, 10);
  const defaultFromDate = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);

  function buildExportUrl(): string {
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (mode === "history") {
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
    }
    return `/api/export?${params.toString()}`;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Monitoring Data</DialogTitle>
          <DialogDescription>
            Download Google AI Overview citation monitoring data in CSV format.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <label className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] p-3 cursor-pointer hover:bg-[var(--none)]/30 transition-colors">
            <input
              type="radio"
              name="export-csv-mode"
              value="latest"
              checked={mode === "latest"}
              onChange={() => setMode("latest")}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <div className="space-y-0.5">
              <div className="font-semibold text-[var(--ink)]">
                Latest result per keyword
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                One most recent check for every active keyword.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] p-3 cursor-pointer hover:bg-[var(--none)]/30 transition-colors">
            <input
              type="radio"
              name="export-csv-mode"
              value="history"
              checked={mode === "history"}
              onChange={() => setMode("history")}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <div className="space-y-0.5">
              <div className="font-semibold text-[var(--ink)]">
                Full history within date range
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                All check records within the selected date period.
              </div>
            </div>
          </label>

          {mode === "history" && (
            <div className="grid grid-cols-2 gap-3 rounded-md border border-[var(--line)] bg-[var(--bg)] p-3">
              <div className="space-y-1.5">
                <Label htmlFor="from-date">From date</Label>
                <Input
                  id="from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to-date">To date</Label>
                <Input
                  id="to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
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
          >
            <a href={buildExportUrl()} download>
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
