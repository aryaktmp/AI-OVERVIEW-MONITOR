"use client";

import type { Table } from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination";
import { cn } from "@/lib/utils";

export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  totalItems?: number;
  selectedCount?: number;
  pageSizeOptions?: readonly number[] | number[];
  itemLabel?: string;
  className?: string;
}

/**
 * Komponen Standar Pagination untuk TanStack Table (AI Overview Citation Monitor).
 * 
 * Menampilkan:
 * - Status rentang item (Showing X-Y of Z) & indikator jumlah seleksi aktif.
 * - Pemilih jumlah baris per halaman (Rows per page dropdown).
 * - Indikator halaman aktif (Page X of Y).
 * - Tombol navigasi (First, Previous, Next, Last) yang responsif dan aksesibel.
 */
export function DataTablePagination<TData>({
  table,
  totalItems,
  selectedCount,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  itemLabel = "items",
  className,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();

  const total = totalItems !== undefined ? totalItems : table.getFilteredRowModel().rows.length;
  const startItem = total === 0 ? 0 : pageIndex * pageSize + 1;
  const endItem = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-2 py-3 text-xs text-[var(--muted)] border-t border-[var(--line)]",
        className
      )}
    >
      {/* Sisi Kiri: Status Item & Seleksi */}
      <div className="flex items-center gap-2 text-center sm:text-left">
        {selectedCount !== undefined && selectedCount > 0 ? (
          <span>
            <span className="font-semibold text-[var(--cite)] font-mono">
              {selectedCount}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-[var(--ink)] font-mono">
              {total}
            </span>{" "}
            selected
            <span className="mx-1.5 text-[var(--line)]">·</span>
          </span>
        ) : null}
        <span>
          Showing{" "}
          <span className="font-semibold text-[var(--ink)] font-mono">
            {startItem}
          </span>
          –
          <span className="font-semibold text-[var(--ink)] font-mono">
            {endItem}
          </span>{" "}
          of{" "}
          <span className="font-semibold text-[var(--ink)] font-mono">
            {total}
          </span>{" "}
          {itemLabel}
        </span>
      </div>

      {/* Sisi Kanan: Kontrol Rows per Page, Indikator Halaman, & Tombol Navigasi */}
      <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3 sm:gap-4">
        {/* Rows per page selector */}
        <div className="flex items-center gap-1.5">
          <label
            htmlFor="data-table-page-size"
            className="text-xs font-medium text-[var(--muted)] whitespace-nowrap"
          >
            Rows per page:
          </label>
          <select
            id="data-table-page-size"
            value={pageSize}
            onChange={(e) => {
              table.setPageSize(Number(e.target.value));
            }}
            aria-label="Select number of rows per page"
            className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-semibold text-[var(--ink)] cursor-pointer focus:border-[var(--cite)] focus:outline-none shadow-xs"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* Page indicator */}
        <div className="flex items-center justify-center text-xs font-medium text-[var(--ink)] whitespace-nowrap">
          Page{" "}
          <span className="mx-1 font-semibold font-mono">
            {total === 0 ? 0 : pageIndex + 1}
          </span>{" "}
          of{" "}
          <span className="ml-1 font-semibold font-mono">
            {Math.max(1, pageCount)}
          </span>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to first page"
            className="h-8 w-8 p-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to previous page"
            className="h-8 w-8 p-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Go to next page"
            className="h-8 w-8 p-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Go to last page"
            className="h-8 w-8 p-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
