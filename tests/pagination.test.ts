import { describe, expect, it } from "vitest";
import {
  calculatePaginationMetadata,
  getPaginationRange,
  paginateArray,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from "@/lib/pagination";

describe("Standar Modul Pagination (lib/pagination.ts)", () => {
  it("menyediakan konstanta default page size dan opsi page size standar", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 25, 50, 100]);
  });

  describe("getPaginationRange (Supabase .range mapping)", () => {
    it("menghitung indeks from & to dengan benar untuk halaman 1", () => {
      const range = getPaginationRange(1, 25);
      expect(range).toEqual({ from: 0, to: 24 });
    });

    it("menghitung indeks from & to dengan benar untuk halaman 2", () => {
      const range = getPaginationRange(2, 25);
      expect(range).toEqual({ from: 25, to: 49 });
    });

    it("menghitung indeks from & to dengan benar untuk ukuran halaman 10", () => {
      const range = getPaginationRange(3, 10);
      expect(range).toEqual({ from: 20, to: 29 });
    });

    it("menangani nilai halaman tidak valid dengan membatasinya ke minimal 1", () => {
      const range = getPaginationRange(0, 25);
      expect(range).toEqual({ from: 0, to: 24 });

      const rangeNeg = getPaginationRange(-5, 25);
      expect(rangeNeg).toEqual({ from: 0, to: 24 });
    });
  });

  describe("calculatePaginationMetadata", () => {
    it("menangani data kosong (totalItems = 0)", () => {
      const meta = calculatePaginationMetadata(0, 1, 25);
      expect(meta).toEqual({
        page: 1,
        pageSize: 25,
        totalItems: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        startIndex: 0,
        endIndex: 0,
      });
    });

    it("menghitung metadata halaman pertama saat ada beberapa halaman", () => {
      const meta = calculatePaginationMetadata(120, 1, 25);
      expect(meta).toEqual({
        page: 1,
        pageSize: 25,
        totalItems: 120,
        totalPages: 5, // ceil(120 / 25) = 5
        hasNextPage: true,
        hasPreviousPage: false,
        startIndex: 1,
        endIndex: 25,
      });
    });

    it("menghitung metadata halaman tengah", () => {
      const meta = calculatePaginationMetadata(120, 3, 25);
      expect(meta).toEqual({
        page: 3,
        pageSize: 25,
        totalItems: 120,
        totalPages: 5,
        hasNextPage: true,
        hasPreviousPage: true,
        startIndex: 51,
        endIndex: 75,
      });
    });

    it("menghitung metadata halaman terakhir dengan item sisa", () => {
      const meta = calculatePaginationMetadata(120, 5, 25);
      expect(meta).toEqual({
        page: 5,
        pageSize: 25,
        totalItems: 120,
        totalPages: 5,
        hasNextPage: false,
        hasPreviousPage: true,
        startIndex: 101,
        endIndex: 120,
      });
    });

    it("membatasi nomor halaman yang melebihi totalPages", () => {
      const meta = calculatePaginationMetadata(50, 99, 25);
      expect(meta.page).toBe(2);
      expect(meta.totalPages).toBe(2);
      expect(meta.startIndex).toBe(26);
      expect(meta.endIndex).toBe(50);
    });
  });

  describe("paginateArray", () => {
    const sampleItems = Array.from({ length: 55 }, (_, i) => `item-${i + 1}`);

    it("memotong item untuk halaman 1", () => {
      const result = paginateArray(sampleItems, 1, 25);
      expect(result.data).toHaveLength(25);
      expect(result.data[0]).toBe("item-1");
      expect(result.data[24]).toBe("item-25");
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(3);
    });

    it("memotong item untuk halaman terakhir", () => {
      const result = paginateArray(sampleItems, 3, 25);
      expect(result.data).toHaveLength(5);
      expect(result.data[0]).toBe("item-51");
      expect(result.data[4]).toBe("item-55");
      expect(result.meta.page).toBe(3);
    });

    it("menangani array kosong", () => {
      const result = paginateArray([], 1, 25);
      expect(result.data).toEqual([]);
      expect(result.meta.totalItems).toBe(0);
      expect(result.meta.startIndex).toBe(0);
      expect(result.meta.endIndex).toBe(0);
    });
  });
});
