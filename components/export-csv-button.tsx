"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <div className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
      >
        Ekspor CSV
      </Button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-80 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-lg">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-extrabold text-[var(--ink)]">
              Ekspor Data Pemeriksaan (CSV)
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
            >
              Tutup
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="export-csv-mode"
                value="latest"
                checked={mode === "latest"}
                onChange={() => setMode("latest")}
                className="mt-0.5 accent-[var(--brand)]"
              />
              <div>
                <div className="font-semibold text-[var(--ink)]">
                  Hasil terbaru per keyword
                </div>
                <div className="text-[11px] text-[var(--muted)]">
                  Satu baris pemeriksaan paling mutakhir untuk setiap keyword aktif.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="export-csv-mode"
                value="history"
                checked={mode === "history"}
                onChange={() => setMode("history")}
                className="mt-0.5 accent-[var(--brand)]"
              />
              <div>
                <div className="font-semibold text-[var(--ink)]">
                  Seluruh riwayat dalam rentang tanggal
                </div>
                <div className="text-[11px] text-[var(--muted)]">
                  Semua baris pemeriksaan dalam periode tanggal yang dipilih.
                </div>
              </div>
            </label>

            {mode === "history" && (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-[var(--line)] bg-[var(--bg)] p-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">
                    Dari tanggal
                  </label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="h-8 px-2 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">
                    Sampai tanggal
                  </label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-8 px-2 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="pt-1 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Batal
              </Button>
              <Button
                asChild
                variant="primary"
                size="sm"
                onClick={() => setOpen(false)}
              >
                <a href={buildExportUrl()} download>
                  Unduh CSV
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
