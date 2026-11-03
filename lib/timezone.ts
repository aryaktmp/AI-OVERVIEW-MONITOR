/**
 * Utilitas penanganan zona waktu Asia/Jakarta (WIB = UTC+7).
 * Seluruh perhitungan minggu, bulan, hari ini, dan batas minggu di aplikasi
 * wajib merujuk secara eksplisit ke zona waktu Asia/Jakarta tanpa bergantung
 * pada waktu lokal mesin runtime serverless / VPS.
 */

export const JAKARTA_TIMEZONE = "Asia/Jakarta";
export const JAKARTA_OFFSET_HOURS = 7;
export const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface JakartaDateParts {
  year: number;
  month: number; // 0 = Januari, 11 = Desember
  date: number; // 1-31
  day: number; // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
  hours: number; // 0-23
  minutes: number; // 0-59
  seconds: number; // 0-59
  milliseconds: number;
}

/**
 * Mengonversi sebuah instance Date ke komponen kalender di Asia/Jakarta (WIB).
 */
export function getJakartaDateParts(date: Date = new Date()): JakartaDateParts {
  const shifted = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
    milliseconds: shifted.getUTCMilliseconds(),
  };
}

/**
 * Membuat sebuah Date UTC instan dari spesifikasi tanggal dan waktu di Asia/Jakarta (WIB).
 */
export function makeJakartaDate(
  year: number,
  month: number, // 0-indexed (0 = Jan)
  date: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0
): Date {
  return new Date(
    Date.UTC(year, month, date, hours, minutes, seconds, ms) - JAKARTA_OFFSET_MS
  );
}

/**
 * Mendapatkan batas awal (00:00:00 WIB) dan akhir (23:59:59.999 WIB) dari
 * bulan kalender Asia/Jakarta berjalan untuk rentang query database & kuota.
 */
export function getJakartaMonthBoundaries(date: Date = new Date()): {
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
  year: number;
  month: number;
} {
  const parts = getJakartaDateParts(date);
  const startDate = makeJakartaDate(parts.year, parts.month, 1, 0, 0, 0, 0);
  const daysInMonth = new Date(
    Date.UTC(parts.year, parts.month + 1, 0)
  ).getUTCDate();
  const endDate = makeJakartaDate(
    parts.year,
    parts.month,
    daysInMonth,
    23,
    59,
    59,
    999
  );

  return {
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    startMs: startDate.getTime(),
    endMs: endDate.getTime(),
    year: parts.year,
    month: parts.month,
  };
}

/**
 * Menghitung tanggal hari Senin di bulan dan tahun kalender Asia/Jakarta.
 */
export function getMondaysInMonth(year: number, month: number): number[] {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const mondays: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const parts = getJakartaDateParts(
      makeJakartaDate(year, month, d, 12, 0, 0)
    );
    if (parts.day === 1) {
      mondays.push(d);
    }
  }
  return mondays;
}
