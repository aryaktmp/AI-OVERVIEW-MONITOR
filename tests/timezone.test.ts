import { describe, expect, it } from "vitest";
import {
  getJakartaDateParts,
  makeJakartaDate,
  getJakartaMonthBoundaries,
  getMondaysInMonth,
} from "../lib/timezone.ts";
import {
  getActiveWeekOfMonth,
  getSlotWeekNumber,
  getMondayOccurrenceOfMonth,
} from "../lib/keyword-batches.ts";
import {
  buildEightWeekBuckets,
  formatShortDate,
} from "../lib/analytics.ts";

describe("Timezone Asia/Jakarta (WIB) Calculations", () => {
  describe("Mandatory Case: Minggu 23:59 WIB vs Senin 00:00 WIB", () => {
    it("correctly identifies Minggu 23:59 WIB and does not roll into Monday early", () => {
      // 8 November 2026 adalah hari Minggu di WIB
      // 23:59:59 WIB = 16:59:59 UTC
      const sundayNight = makeJakartaDate(2026, 10, 8, 23, 59, 59); // 10 = Nov
      const parts = getJakartaDateParts(sundayNight);

      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(10); // November
      expect(parts.date).toBe(8);
      expect(parts.day).toBe(0); // 0 = Minggu
      expect(parts.hours).toBe(23);
      expect(parts.minutes).toBe(59);

      // Pada Minggu malam tgl 8 Nov 2026, masih berada dalam Week 1 (Senin 2 Nov - Minggu 8 Nov)
      expect(getActiveWeekOfMonth(sundayNight)).toBe(1);
      expect(getSlotWeekNumber(sundayNight)).toBe(1);

      const occurrence = getMondayOccurrenceOfMonth(sundayNight);
      expect(occurrence.isMonday).toBe(false);
      expect(occurrence.occurrence).toBe(1);
    });

    it("correctly identifies Senin 00:00 WIB even though UTC is still Sunday", () => {
      // 9 November 2026 00:00:00 WIB = 8 November 2026 17:00:00 UTC
      const mondayMidnight = makeJakartaDate(2026, 10, 9, 0, 0, 0); // 10 = Nov
      const parts = getJakartaDateParts(mondayMidnight);

      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(10); // November
      expect(parts.date).toBe(9);
      expect(parts.day).toBe(1); // 1 = Senin
      expect(parts.hours).toBe(0);
      expect(parts.minutes).toBe(0);

      // Pada Senin 9 Nov 00:00 WIB, sudah masuk Week 2
      expect(getActiveWeekOfMonth(mondayMidnight)).toBe(2);
      expect(getSlotWeekNumber(mondayMidnight)).toBe(2);

      const occurrence = getMondayOccurrenceOfMonth(mondayMidnight);
      expect(occurrence.isMonday).toBe(true);
      expect(occurrence.occurrence).toBe(2);
      expect(occurrence.label).toBe("Monday #2 of November 2026");
      expect(occurrence.formattedWib).toBe("Senin ke-2 (November 2026)");
    });

    it("shifts analytics 8-week buckets cleanly at Monday 00:00 WIB", () => {
      const sundayNight = makeJakartaDate(2026, 10, 8, 23, 59, 59);
      const mondayMidnight = makeJakartaDate(2026, 10, 9, 0, 0, 0);

      const sundayBuckets = buildEightWeekBuckets(sundayNight);
      const mondayBuckets = buildEightWeekBuckets(mondayMidnight);

      // Di Minggu 23:59 WIB, minggu aktif (kolom terakhir index 7) dimulai dari Senin 2 Nov
      expect(sundayBuckets[7]?.label).toBe("2 Nov");

      // Di Senin 00:00 WIB, minggu aktif (kolom terakhir index 7) bergeser ke Senin 9 Nov
      expect(mondayBuckets[7]?.label).toBe("9 Nov");
      // Dan kolom index 6 adalah Senin 2 Nov
      expect(mondayBuckets[6]?.label).toBe("2 Nov");
    });
  });

  describe("Mandatory Case: Tanggal 1 dan 31", () => {
    it("handles tanggal 1 that falls on Sunday (pre-cycle) cleanly", () => {
      // 1 November 2026 adalah hari Minggu
      const novFirst = makeJakartaDate(2026, 10, 1, 10, 0, 0);
      const parts = getJakartaDateParts(novFirst);

      expect(parts.date).toBe(1);
      expect(parts.day).toBe(0); // Minggu

      // Hari sebelum Senin pertama di bulan November 2026 adalah pra-siklus (Week 0 -> Slot 4)
      expect(getActiveWeekOfMonth(novFirst)).toBe(0);
      expect(getSlotWeekNumber(novFirst)).toBe(4);
    });

    it("handles tanggal 1 that falls on Monday (Week 1 first day)", () => {
      // 1 Juni 2026 adalah hari Senin
      const juneFirst = makeJakartaDate(2026, 5, 1, 0, 0, 0); // 5 = Juni
      const parts = getJakartaDateParts(juneFirst);

      expect(parts.date).toBe(1);
      expect(parts.day).toBe(1); // Senin

      expect(getActiveWeekOfMonth(juneFirst)).toBe(1);
      expect(getSlotWeekNumber(juneFirst)).toBe(1);

      const occ = getMondayOccurrenceOfMonth(juneFirst);
      expect(occ.isMonday).toBe(true);
      expect(occ.occurrence).toBe(1);
    });

    it("handles tanggal 31 and month boundaries without month bleed", () => {
      // 31 Oktober 2026 (Sabtu)
      const oct31 = makeJakartaDate(2026, 9, 31, 23, 59, 59); // 9 = Okt
      const parts = getJakartaDateParts(oct31);

      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(9);
      expect(parts.date).toBe(31);
      expect(formatShortDate(oct31)).toBe("31 Oct");

      // Batas bulan Oktober
      const bounds = getJakartaMonthBoundaries(oct31);
      expect(bounds.year).toBe(2026);
      expect(bounds.month).toBe(9);
      // startIso WIB 2026-10-01 00:00:00 WIB = 2026-09-30 17:00:00 UTC
      expect(bounds.startIso).toBe("2026-09-30T17:00:00.000Z");
      // endIso WIB 2026-10-31 23:59:59.999 WIB = 2026-10-31 16:59:59.999 UTC
      expect(bounds.endIso).toBe("2026-10-31T16:59:59.999Z");
    });
  });

  describe("Mandatory Case: Bulan dengan 5 Senin", () => {
    it("correctly identifies all 5 Mondays in November 2026 and wraps Week 5 to Slot 1", () => {
      // November 2026 memiliki 5 Senin: 2, 9, 16, 23, 30
      const mondays = getMondaysInMonth(2026, 10);
      expect(mondays).toEqual([2, 9, 16, 23, 30]);

      // Uji Senin ke-5: 30 November 2026
      const monday5 = makeJakartaDate(2026, 10, 30, 9, 0, 0);
      expect(getActiveWeekOfMonth(monday5)).toBe(5);
      // Sesuai aturan spesifikasi: Week 5 membungkus kembali ke Slot 1
      expect(getSlotWeekNumber(monday5)).toBe(1);

      const occ = getMondayOccurrenceOfMonth(monday5);
      expect(occ.totalMondays).toBe(5);
      expect(occ.occurrence).toBe(5);
      expect(occ.isMonday).toBe(true);
      expect(occ.label).toBe("Monday #5 of November 2026");
      expect(occ.formattedWib).toBe("Senin ke-5 (November 2026)");
    });

    it("correctly identifies all 5 Mondays in March 2026", () => {
      // Maret 2026 memiliki 5 Senin: 2, 9, 16, 23, 30
      const mondays = getMondaysInMonth(2026, 2); // 2 = Maret
      expect(mondays).toEqual([2, 9, 16, 23, 30]);

      const midWeek5 = makeJakartaDate(2026, 2, 31, 15, 0, 0); // Selasa tgl 31 Maret
      expect(getActiveWeekOfMonth(midWeek5)).toBe(5);
      expect(getSlotWeekNumber(midWeek5)).toBe(1);
    });
  });
});
