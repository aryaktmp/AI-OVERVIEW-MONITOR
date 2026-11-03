/**
 * Modul Standar Pagination (lib/pagination.ts)
 * 
 * Standar pagination untuk data dalam jumlah banyak di AI Overview Citation Monitor.
 * Digunakan baik untuk pagination in-memory / tabel TanStack maupun query database Supabase (.range).
 */

export interface PaginationParams {
  page: number; // 1-indexed (halaman 1, 2, 3...)
  pageSize: number;
}

export interface PaginationMetadata {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startIndex: number; // 1-indexed untuk label tampilan UI (mis. "Showing 1–25 of 100")
  endIndex: number;   // 1-indexed untuk label tampilan UI
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMetadata;
}

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/**
 * Menghitung rentang indeks { from, to } untuk query Supabase `.range(from, to)`.
 * Halaman berbasis 1 (halaman 1 dimulai dari from: 0).
 */
export function getPaginationRange(
  page: number,
  pageSize: number
): { from: number; to: number } {
  const safePage = Math.max(1, Math.floor(page || 1));
  const safePageSize = Math.max(1, Math.floor(pageSize || DEFAULT_PAGE_SIZE));
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  return { from, to };
}

/**
 * Menghitung metadata pagination (totalPages, hasNextPage, startIndex, endIndex, dsb).
 */
export function calculatePaginationMetadata(
  totalItems: number,
  page: number,
  pageSize: number
): PaginationMetadata {
  const safeTotal = Math.max(0, Math.floor(totalItems || 0));
  const safePageSize = Math.max(1, Math.floor(pageSize || DEFAULT_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page || 1)), totalPages);

  const startIndex = safeTotal === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const endIndex = Math.min(safeTotal, safePage * safePageSize);

  return {
    page: safePage,
    pageSize: safePageSize,
    totalItems: safeTotal,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1,
    startIndex,
    endIndex,
  };
}

/**
 * Memotong array data in-memory berdasarkan parameter halaman dan pageSize.
 */
export function paginateArray<T>(
  items: T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE
): PaginatedResult<T> {
  const meta = calculatePaginationMetadata(items.length, page, pageSize);
  const data = items.slice(
    meta.startIndex > 0 ? meta.startIndex - 1 : 0,
    meta.endIndex
  );
  return { data, meta };
}
