import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_BRAND_TERMS,
  detectBrandMentionInText,
  isMatchingDomain,
  type AnnotatedCheckSource,
  type BrandTermConfig,
  type CheckStatus,
} from "./detect.ts";

export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 8_000; // 8 detik per sumber sesuai SPEC.md
export const KEYWORD_THIRD_PARTY_TIMEOUT_MS = 15_000; // 15 detik total per keyword
export const MAX_HTML_BYTES = 500 * 1024; // 500 KB setelah dekompresi sesuai SPEC.md
export const MAX_SOURCES_PER_KEYWORD = 10;
export const MAX_CONCURRENCY = 3;
export const SUCCESS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari
export const FAILURE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

export interface DnsResolvedAddress {
  address: string;
  family: number;
}

export type DnsLookupFn = (hostname: string) => Promise<DnsResolvedAddress[]>;

export interface PageCacheEntry {
  url: string;
  fetched_at: string;
  mentions_brand: boolean;
  status: number | null;
}

export interface PageCacheStore {
  get(url: string): Promise<PageCacheEntry | null>;
  upsert(entry: PageCacheEntry): Promise<void>;
}

export function createSupabasePageCacheStore(
  supabase: SupabaseClient
): PageCacheStore {
  return {
    async get(url: string): Promise<PageCacheEntry | null> {
      const { data, error } = await supabase
        .from("page_cache")
        .select("url, fetched_at, mentions_brand, status")
        .eq("url", url)
        .maybeSingle();

      if (error || !data) return null;
      return data as PageCacheEntry;
    },

    async upsert(entry: PageCacheEntry): Promise<void> {
      await supabase
        .from("page_cache")
        .upsert(entry, { onConflict: "url" });
    },
  };
}

/**
 * Memeriksa apakah entri page_cache masih berlaku:
 * - Hasil berhasil (status 200..299): berlaku 7 hari
 * - Hasil gagal (status 0 atau >= 400): berlaku 24 jam
 */
export function isCacheEntryFresh(
  entry: PageCacheEntry,
  now: Date = new Date()
): boolean {
  const fetchedMs = Date.parse(entry.fetched_at);
  if (Number.isNaN(fetchedMs)) return false;

  const ageMs = now.getTime() - fetchedMs;
  if (ageMs < 0) return true;

  const isSuccess =
    typeof entry.status === "number" &&
    entry.status >= 200 &&
    entry.status < 300;
  const ttlMs = isSuccess ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
  return ageMs < ttlMs;
}

/**
 * Memeriksa apakah alamat IPv4 termasuk loopback, privat, link-local,
 * metadata cloud, CGNAT, multicast, atau reserved.
 */
export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return true;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return true;
    if (part.length > 1 && part.startsWith("0")) return true; // tolak notasi oktal
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return true;
    octets.push(num);
  }

  const [a, b, c] = octets as [number, number, number, number];

  // 0.0.0.0/8 (termasuk 0.0.0.0)
  if (a === 0) return true;
  // 10.0.0.0/8 (privat RFC 1918)
  if (a === 10) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local & cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255 privat RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 & 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  // 192.168.0.0/16 (privat RFC 1918)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)
  if (a >= 224) return true;

  return false;
}

/**
 * Mengurai alamat IPv6 menjadi delapan kata 16-bit (0..65535).
 * Mengembalikan null jika format IPv6 tidak valid.
 */
function parseIpv6Words(rawIp: string): number[] | null {
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!cleaned || cleaned.includes("%")) return null;

  let working = cleaned;

  // Jika diakhiri IPv4 dotted-quad (contoh ::ffff:127.0.0.1 atau ::192.168.1.1)
  const lastColon = working.lastIndexOf(":");
  if (lastColon !== -1 && working.slice(lastColon + 1).includes(".")) {
    const ipv4Part = working.slice(lastColon + 1);
    const parts = ipv4Part.split(".");
    if (parts.length !== 4) return null;
    const nums = parts.map((p) =>
      /^\d{1,3}$/.test(p) ? Number(p) : Number.NaN
    );
    if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    const highWord = ((nums[0]! << 8) | nums[1]!).toString(16);
    const lowWord = ((nums[2]! << 8) | nums[3]!).toString(16);
    working = `${working.slice(0, lastColon)}:${highWord}:${lowWord}`;
  }

  const doubleColonParts = working.split("::");
  if (doubleColonParts.length > 2) return null;

  const parseSegmentList = (segmentStr: string): number[] | null => {
    if (!segmentStr) return [];
    const segs = segmentStr.split(":");
    const out: number[] = [];
    for (const s of segs) {
      if (!/^[0-9a-f]{1,4}$/.test(s)) return null;
      out.push(Number.parseInt(s, 16));
    }
    return out;
  };

  if (doubleColonParts.length === 2) {
    const left = parseSegmentList(doubleColonParts[0]!);
    const right = parseSegmentList(doubleColonParts[1]!);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...Array(missing).fill(0), ...right];
  }

  const full = parseSegmentList(working);
  if (!full || full.length !== 8) return null;
  return full;
}

function checkWordsAsIpv4(highWord: number, lowWord: number): boolean {
  const a = (highWord >> 8) & 0xff;
  const b = highWord & 0xff;
  const c = (lowWord >> 8) & 0xff;
  const d = lowWord & 0xff;
  return isBlockedIpv4(`${a}.${b}.${c}.${d}`);
}

/**
 * Memeriksa apakah alamat IPv6 termasuk loopback (::1), unspecified (::),
 * unique local (fc00::/7), link-local (fe80::/10), multicast, atau IPv4 yang dibungkus IPv6.
 */
export function isBlockedIpv6(ip: string): boolean {
  const words = parseIpv6Words(ip);
  if (!words || words.length !== 8) return true;

  const w0 = words[0]!;
  const w1 = words[1]!;
  const w2 = words[2]!;
  const w3 = words[3]!;
  const w4 = words[4]!;
  const w5 = words[5]!;
  const w6 = words[6]!;
  const w7 = words[7]!;

  // :: (unspecified) atau ::1 (loopback)
  const first6Zero =
    w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0;
  if (first6Zero && w6 === 0 && (w7 === 0 || w7 === 1)) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:xxxx:xxxx, termasuk ::ffff:7f00:1)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0xffff) {
    return checkWordsAsIpv4(w6, w7);
  }

  // IPv4-compatible IPv6 (::a.b.c.d)
  if (first6Zero && (w6 !== 0 || w7 > 1)) {
    return checkWordsAsIpv4(w6, w7);
  }

  // IPv4-translated (::ffff:0:a.b.c.d)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0xffff && w5 === 0) {
    return checkWordsAsIpv4(w6, w7);
  }

  // NAT64 (64:ff9b::/96)
  if (
    w0 === 0x0064 &&
    w1 === 0xff9b &&
    w2 === 0 &&
    w3 === 0 &&
    w4 === 0 &&
    w5 === 0
  ) {
    return checkWordsAsIpv4(w6, w7);
  }

  // 6to4 (2002::/16) -> 32-bit IPv4 ada di w1 dan w2
  if (w0 === 0x2002) {
    return checkWordsAsIpv4(w1, w2);
  }

  // Teredo (2001:0000::/32)
  if (w0 === 0x2001 && w1 === 0x0000) {
    return true;
  }

  // Dokumentasi (2001:db8::/32)
  if (w0 === 0x2001 && w1 === 0x0db8) {
    return true;
  }

  // Unique Local Address fc00::/7 (fc00:: - fdff:ffff:...)
  if ((w0 & 0xfe00) === 0xfc00) {
    return true;
  }

  // Link-Local fe80::/10 (fe80:: - febf:ffff:...)
  if ((w0 & 0xffc0) === 0xfe80) {
    return true;
  }

  // Site-Local deprecated fec0::/10
  if ((w0 & 0xffc0) === 0xfec0) {
    return true;
  }

  // Multicast ff00::/8
  if ((w0 & 0xff00) === 0xff00) {
    return true;
  }

  return false;
}

/**
 * Memeriksa apakah string hostname berupa notasi IPv4 non-standar
 * seperti desimal tunggal (2130706433), heksadesimal (0x7f.0.0.1), atau oktal (0177.0.0.1).
 */
export function isNonStandardIpv4Notation(host: string): boolean {
  const cleaned = host.trim().toLowerCase().replace(/\.+$/, "");
  if (!cleaned) return false;

  // Desimal murni (contoh: 2130706433) atau heksadesimal tunggal (contoh: 0x7f000001)
  if (/^\d+$/.test(cleaned) || /^0x[0-9a-f]+$/i.test(cleaned)) {
    return true;
  }

  const parts = cleaned.split(".");
  if (parts.length >= 2 && parts.length <= 4) {
    const allNumericOrHexOrOctal = parts.every(
      (p) => /^\d+$/.test(p) || /^0x[0-9a-f]+$/i.test(p)
    );
    if (allNumericOrHexOrOctal) {
      // Jika jumlah segmen != 4 (mis. 127.1) atau ada segmen oktal (0177) atau hex (0x7f)
      if (
        parts.length !== 4 ||
        parts.some(
          (p) => /^0x[0-9a-f]+$/i.test(p) || (p.length > 1 && p.startsWith("0"))
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Memeriksa apakah alamat IP (IPv4 maupun IPv6) dilarang untuk SSRF.
 */
export function isBlockedIpAddress(ip: string): boolean {
  const cleaned = ip.trim().replace(/^\[|\]$/g, "");
  if (!cleaned) return true;

  if (isNonStandardIpv4Notation(cleaned)) {
    return true;
  }

  if (cleaned.includes(":")) {
    return isBlockedIpv6(cleaned);
  }
  if (net.isIPv4(cleaned) || /^\d+\.\d+\.\d+\.\d+$/.test(cleaned)) {
    return isBlockedIpv4(cleaned);
  }
  return true;
}

const defaultDnsLookup: DnsLookupFn = async (hostname: string) => {
  const results = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return results.map((r) => ({ address: r.address, family: r.family }));
};

/**
 * Memvalidasi skema URL, port (hanya 80 dan 443), hostname, dan meresolusikan DNS
 * sebelum menyambung. Menolak jika ada hasil resolusi DNS yang mengarah ke IP terlarang.
 */
export async function validateAndResolveTargetUrl(
  rawUrl: string,
  dnsLookup: DnsLookupFn = defaultDnsLookup
): Promise<{
  parsedUrl: URL;
  pinnedIp: string;
  pinnedFamily: number;
}> {
  const trimmedUrl = rawUrl.trim();

  // Tolak kredensial (@) di bagian authority sebelum path
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(trimmedUrl)) {
    throw new Error("URL dengan kredensial pengguna ditolak (SSRF).");
  }

  // Periksa authority mentah sebelum URL parser melakukan kanonikalisasi IP oktal/hex/desimal
  const rawAuthorityMatch = trimmedUrl.match(
    /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i
  );
  if (rawAuthorityMatch?.[1]) {
    const rawAuthorityHost = rawAuthorityMatch[1].toLowerCase();
    if (isNonStandardIpv4Notation(rawAuthorityHost)) {
      throw new Error(
        `Notasi IPv4 non-standar (desimal/heksadesimal/oktal) ditolak (SSRF): ${rawAuthorityHost}`
      );
    }
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error(`URL tidak valid: ${rawUrl}`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `Skema URL ditolak (hanya http dan https yang diizinkan): ${parsedUrl.protocol}`
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("URL dengan kredensial pengguna ditolak (SSRF).");
  }

  if (
    parsedUrl.port !== "" &&
    parsedUrl.port !== "80" &&
    parsedUrl.port !== "443"
  ) {
    throw new Error(
      `Port URL ditolak (hanya port 80 dan 443 yang diizinkan): ${parsedUrl.port}`
    );
  }

  const rawHost = parsedUrl.hostname.trim().toLowerCase();
  const bareHost = rawHost.replace(/^\[|\]$/g, "").replace(/\.+$/, "");

  if (
    !bareHost ||
    bareHost === "localhost" ||
    bareHost.endsWith(".localhost") ||
    bareHost.endsWith(".local") ||
    bareHost.endsWith(".internal")
  ) {
    throw new Error(`Hostname lokal/internal ditolak (SSRF): ${bareHost}`);
  }

  if (isNonStandardIpv4Notation(bareHost)) {
    throw new Error(
      `Notasi IPv4 non-standar ditolak (SSRF): ${bareHost}`
    );
  }

  // Jika hostname berupa literal IPv6
  if (rawHost.startsWith("[") && rawHost.endsWith("]")) {
    if (isBlockedIpv6(bareHost)) {
      throw new Error(`Alamat IPv6 ditolak (SSRF): ${bareHost}`);
    }
    return {
      parsedUrl,
      pinnedIp: bareHost,
      pinnedFamily: 6,
    };
  }

  // Jika hostname berupa literal IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bareHost)) {
    if (isBlockedIpv4(bareHost)) {
      throw new Error(`Alamat IPv4 ditolak (SSRF): ${bareHost}`);
    }
    return {
      parsedUrl,
      pinnedIp: bareHost,
      pinnedFamily: 4,
    };
  }

  const resolvedList = await dnsLookup(bareHost);
  if (!resolvedList || resolvedList.length === 0) {
    throw new Error(`Resolusi DNS kosong untuk hostname: ${bareHost}`);
  }

  for (const item of resolvedList) {
    if (isBlockedIpAddress(item.address)) {
      throw new Error(
        `Hostname ${bareHost} mengarah ke alamat IP terlarang (SSRF): ${item.address}`
      );
    }
  }

  const first = resolvedList[0]!;
  return {
    parsedUrl,
    pinnedIp: first.address,
    pinnedFamily: first.family || (first.address.includes(":") ? 6 : 4),
  };
}

export interface LowLevelHttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  byteLength: number;
  truncatedAtLimit: boolean;
}

function createDecompressionStream(
  res: http.IncomingMessage,
  contentEncoding: string
): Readable {
  const enc = contentEncoding.trim().toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") {
    return res.pipe(zlib.createGunzip());
  }
  if (enc === "deflate") {
    return res.pipe(zlib.createInflate());
  }
  if (enc === "br") {
    return res.pipe(zlib.createBrotliDecompress());
  }
  return res;
}

/**
 * Membaca stream respons dari soket yang terhubung langsung ke pinnedIp (mencegah DNS rebinding)
 * dengan batas waktu 8 detik dan menghentikan pembacaan segera setelah mencapai maxBytes (500 KB setelah dekompresi).
 */
function requestPinnedWithNodeHttp(
  parsedUrl: URL,
  pinnedIp: string,
  pinnedFamily: number,
  timeoutMs: number,
  maxBytes: number
): Promise<LowLevelHttpResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = parsedUrl.protocol === "https:";
    const defaultPort = isHttps ? 443 : 80;
    const port = parsedUrl.port ? Number(parsedUrl.port) : defaultPort;

    const requestOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname.replace(/^\[|\]$/g, ""),
      port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "GET",
      headers: {
        Host: parsedUrl.host,
        "User-Agent": "LinovHR-AIO-Monitor/1.0",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
      },
      lookup: (_hostname, _opts, cb) => {
        cb(null, pinnedIp, pinnedFamily);
      },
      ...(isHttps
        ? {
            servername: parsedUrl.hostname.replace(/^\[|\]$/g, ""),
          }
        : {}),
    };

    const reqFn = isHttps ? https.request : http.request;
    let settled = false;

    const finishWithError = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };

    const req = reqFn(requestOptions, (res) => {
      const status = res.statusCode ?? 0;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === "string") {
          headers[k.toLowerCase()] = v;
        } else if (Array.isArray(v)) {
          headers[k.toLowerCase()] = v.join(", ");
        }
      }

      if (status >= 300 && status < 400 && headers["location"]) {
        settled = true;
        res.destroy();
        resolve({
          status,
          headers,
          bodyText: "",
          byteLength: 0,
          truncatedAtLimit: false,
        });
        return;
      }

      const contentType = headers["content-type"] ?? "";
      if (
        status >= 200 &&
        status < 300 &&
        !contentType.toLowerCase().includes("text/html")
      ) {
        settled = true;
        res.destroy();
        reject(
          new Error(
            `Content-Type ditolak (hanya menerima text/html): ${contentType || "kosong"}`
          )
        );
        return;
      }

      const stream = createDecompressionStream(
        res,
        headers["content-encoding"] ?? ""
      );

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let truncatedAtLimit = false;

      stream.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = maxBytes - totalBytes;

        if (buf.length >= remaining) {
          if (remaining > 0) {
            chunks.push(buf.subarray(0, remaining));
            totalBytes += remaining;
          }
          truncatedAtLimit = true;
          settled = true;
          clearTimeout(timer);
          stream.destroy();
          res.destroy();
          resolve({
            status,
            headers,
            bodyText: Buffer.concat(chunks).toString("utf-8"),
            byteLength: totalBytes,
            truncatedAtLimit,
          });
          return;
        }

        chunks.push(buf);
        totalBytes += buf.length;
      });

      stream.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          status,
          headers,
          bodyText: Buffer.concat(chunks).toString("utf-8"),
          byteLength: totalBytes,
          truncatedAtLimit,
        });
      });

      stream.on("error", (err) => {
        clearTimeout(timer);
        finishWithError(err);
      });
    });

    const timer = setTimeout(() => {
      finishWithError(
        new Error(`Batas waktu pengambilan halaman habis (${timeoutMs} ms)`)
      );
    }, timeoutMs);

    req.on("error", (err) => {
      clearTimeout(timer);
      finishWithError(err);
    });

    req.end();
  });
}

async function decompressBufferBounded(
  compressed: Buffer,
  encoding: string,
  maxBytes: number
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const enc = encoding.trim().toLowerCase();
  const isGzipMagic =
    compressed.length >= 2 &&
    compressed[0] === 0x1f &&
    compressed[1] === 0x8b;

  const createDecompressor = () => {
    if (enc === "gzip" || enc === "x-gzip" || isGzipMagic) {
      return zlib.createGunzip();
    }
    if (enc === "deflate") {
      return zlib.createInflate();
    }
    if (enc === "br") {
      return zlib.createBrotliDecompress();
    }
    return null;
  };

  const decompressor = createDecompressor();
  if (!decompressor) {
    if (compressed.length > maxBytes) {
      return { buffer: compressed.subarray(0, maxBytes), truncated: true };
    }
    return { buffer: compressed, truncated: false };
  }

  return await new Promise<{ buffer: Buffer; truncated: boolean }>(
    (resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let truncated = false;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({
          buffer: Buffer.concat(chunks),
          truncated,
        });
      };

      decompressor.on("data", (chunk: Buffer) => {
        if (settled) return;
        const remaining = maxBytes - total;
        if (chunk.length > remaining) {
          if (remaining > 0) {
            chunks.push(chunk.subarray(0, remaining));
            total += remaining;
          }
          truncated = true;
          decompressor.destroy();
          finish();
          return;
        }
        chunks.push(chunk);
        total += chunk.length;
      });

      decompressor.on("end", () => {
        finish();
      });

      decompressor.on("close", () => {
        if (truncated) finish();
      });

      decompressor.on("error", (err) => {
        if (settled) return;
        if (truncated || total > 0) {
          finish();
          return;
        }
        settled = true;
        reject(err);
      });

      decompressor.end(compressed);
    }
  );
}

/**
 * Membaca respons dari fetchFn kustom (digunakan saat pengujian unit dengan mock fetch)
 * sambil tetap menerapkan redirect: "manual", batas waktu 8 detik, pemeriksaan content-type text/html,
 * dan pemotongan pembacaan pada batas 500 KB setelah dekompresi.
 */
async function requestWithInjectedFetch(
  fetchFn: typeof fetch,
  parsedUrl: URL,
  pinnedIp: string,
  timeoutMs: number,
  maxBytes: number
): Promise<LowLevelHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const safeHeaders: Record<string, string> = {
      "User-Agent": "LinovHR-AIO-Monitor/1.0",
      Accept: "text/html,application/xhtml+xml",
    };

    const res = await fetchFn(parsedUrl.toString(), {
      method: "GET",
      redirect: "manual",
      headers: safeHeaders,
      signal: controller.signal,
      ...({ pinnedIp } as Record<string, unknown>),
    });

    const status = res.status;
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    if (status >= 300 && status < 400 && headers["location"]) {
      return {
        status,
        headers,
        bodyText: "",
        byteLength: 0,
        truncatedAtLimit: false,
      };
    }

    const contentType = headers["content-type"] ?? "";
    if (
      status >= 200 &&
      status < 300 &&
      !contentType.toLowerCase().includes("text/html")
    ) {
      throw new Error(
        `Content-Type ditolak (hanya menerima text/html): ${contentType || "kosong"}`
      );
    }

    const contentEncoding = headers["content-encoding"] ?? "";

    if (!res.body) {
      const arrBuf = await res.arrayBuffer();
      const rawBuf = Buffer.from(arrBuf);
      const { buffer, truncated } = await decompressBufferBounded(
        rawBuf,
        contentEncoding,
        maxBytes
      );
      return {
        status,
        headers,
        bodyText: buffer.toString("utf-8"),
        byteLength: buffer.length,
        truncatedAtLimit: truncated,
      };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncatedAtLimit = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;

      const remaining = maxBytes - totalBytes;
      if (value.byteLength >= remaining) {
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          totalBytes += remaining;
        }
        truncatedAtLimit = true;
        await reader.cancel().catch(() => undefined);
        break;
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }

    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const isGzipMagic =
      merged.length >= 2 && merged[0] === 0x1f && merged[1] === 0x8b;

    if (contentEncoding || isGzipMagic) {
      const decompressed = await decompressBufferBounded(
        merged,
        contentEncoding,
        maxBytes
      );
      return {
        status,
        headers,
        bodyText: decompressed.buffer.toString("utf-8"),
        byteLength: decompressed.buffer.length,
        truncatedAtLimit: truncatedAtLimit || decompressed.truncated,
      };
    }

    return {
      status,
      headers,
      bodyText: merged.toString("utf-8"),
      byteLength: totalBytes,
      truncatedAtLimit,
    };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /abort/i.test(err.message))
    ) {
      throw new Error(`Batas waktu pengambilan halaman habis (${timeoutMs} ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchSafeHtmlOptions {
  dnsLookupFn?: DnsLookupFn;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface FetchSafeHtmlResult {
  finalUrl: string;
  pinnedIp: string;
  status: number;
  html: string;
  byteLength: number;
  truncatedAtLimit: boolean;
  redirectCount: number;
}

/**
 * Mengambil halaman HTML pihak ketiga dengan perlindungan SSRF penuh:
 * - Hanya skema http dan https, hanya port 80 dan 443
 * - Resolusi DNS dan penolakan IP privat / loopback / link-local / metadata cloud / IPv6
 * - Menyambung ke IP hasil resolusi (mencegah DNS rebinding)
 * - Validasi ulang setiap pengalihan secara manual (maksimal 3 kali)
 * - Batas waktu 8 detik, batas ukuran 500 KB setelah dekompresi, dan wajib Content-Type text/html
 * - Tidak mengirim Cookie atau Authorization
 */
export async function fetchSafeHtmlPage(
  initialUrl: string,
  options: FetchSafeHtmlOptions = {}
): Promise<FetchSafeHtmlResult> {
  const dnsLookup = options.dnsLookupFn ?? defaultDnsLookup;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_HTML_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (true) {
    const { parsedUrl, pinnedIp, pinnedFamily } =
      await validateAndResolveTargetUrl(currentUrl, dnsLookup);

    const response = options.fetchFn
      ? await requestWithInjectedFetch(
          options.fetchFn,
          parsedUrl,
          pinnedIp,
          timeoutMs,
          maxBytes
        )
      : await requestPinnedWithNodeHttp(
          parsedUrl,
          pinnedIp,
          pinnedFamily,
          timeoutMs,
          maxBytes
        );

    const isRedirect =
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308;

    if (isRedirect) {
      const locationHeader = response.headers["location"];
      if (!locationHeader) {
        throw new Error(
          `Respons pengalihan HTTP ${response.status} tanpa header Location ditolak.`
        );
      }
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error(
          `Pengalihan melebihi batas maksimal (${maxRedirects} kali)`
        );
      }
      const nextUrl = new URL(locationHeader, parsedUrl.toString());
      currentUrl = nextUrl.toString();
      continue;
    }

    return {
      finalUrl: parsedUrl.toString(),
      pinnedIp,
      status: response.status,
      html: response.bodyText,
      byteLength: response.byteLength,
      truncatedAtLimit: response.truncatedAtLimit,
      redirectCount,
    };
  }
}

export interface HtmlBrandAnalysisResult {
  mentionsBrand: boolean;
  matchedBrandText: boolean;
  matchedBrandLink: boolean;
}

function decodeBasicHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Menganalisis HTML sumber pihak ketiga untuk Deteksi Tingkat 3:
 * 1. Menghapus elemen <script>, <style>, <noscript>, dan komentar HTML
 * 2. Mencari link <a href="..."> yang mengarah ke BRAND_DOMAIN (pencocokan hostname, bukan teks URL)
 * 3. Mencari istilah merek yang aktif di teks halaman yang terlihat
 */
export function analyzeHtmlForBrand(
  html: string,
  options: {
    brandDomain?: string;
    brandTerms?: Array<string | BrandTermConfig>;
    baseUrl?: string;
  } = {}
): HtmlBrandAnalysisResult {
  if (!html) {
    return {
      mentionsBrand: false,
      matchedBrandText: false,
      matchedBrandLink: false,
    };
  }

  const brandDomain =
    options.brandDomain ?? process.env.BRAND_DOMAIN ?? "linovhr.com";
  const brandTerms = options.brandTerms ?? DEFAULT_BRAND_TERMS;

  // 1. Buang komentar, <script>, <style>, dan <noscript>
  const withoutScriptsAndStyles = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  // 2. Periksa semua tag <a ... href="..."> apakah hostname tujuannya cocok dengan brandDomain
  let matchedBrandLink = false;
  const anchorHrefRegex =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))[^>]*>/gi;

  for (const match of withoutScriptsAndStyles.matchAll(anchorHrefRegex)) {
    const rawHref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) {
      continue;
    }

    try {
      const resolvedUrl = options.baseUrl
        ? new URL(decodeBasicHtmlEntities(rawHref), options.baseUrl)
        : new URL(decodeBasicHtmlEntities(rawHref));

      if (
        (resolvedUrl.protocol === "http:" ||
          resolvedUrl.protocol === "https:") &&
        isMatchingDomain(resolvedUrl.hostname, brandDomain)
      ) {
        matchedBrandLink = true;
        break;
      }
    } catch {
      // Abaikan href yang bukan URL valid
    }
  }

  // 3. Ekstrak teks bersih tanpa tag HTML dan periksa istilah merek aktif
  const visibleText = decodeBasicHtmlEntities(
    withoutScriptsAndStyles.replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  const matchedBrandText = detectBrandMentionInText(
    visibleText,
    brandTerms
  ).detected;

  return {
    mentionsBrand: matchedBrandText || matchedBrandLink,
    matchedBrandText,
    matchedBrandLink,
  };
}

function loadThirdPartyFixtureHtml(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  }
  const fileName =
    hash % 2 === 0
      ? "third-party-mentions-brand.html"
      : "third-party-no-brand.html";
  const filePath = path.join(process.cwd(), "tests", "fixtures", fileName);
  return fs.readFileSync(filePath, "utf-8");
}

export interface CheckThirdPartyPageOptions extends FetchSafeHtmlOptions {
  brandDomain?: string;
  brandTerms?: Array<string | BrandTermConfig>;
  cacheStore?: PageCacheStore;
  dryRun?: boolean;
  keywordTimeoutMs?: number;
  nowFn?: () => Date;
}

export interface CheckThirdPartyPageResult {
  url: string;
  mentionsBrand: boolean;
  status: number;
  fromCache: boolean;
  dryRun: boolean;
}

/**
 * Memeriksa satu halaman sumber pihak ketiga dengan dukungan page_cache (7 hari berhasil, 24 jam gagal)
 * dan mode dry-run (membaca fixture HTML dari tests/fixtures tanpa memanggil jaringan).
 */
export async function checkThirdPartySourcePage(
  url: string,
  options: CheckThirdPartyPageOptions = {}
): Promise<CheckThirdPartyPageResult> {
  const nowFn = options.nowFn ?? (() => new Date());
  const now = nowFn();

  if (options.cacheStore) {
    const cached = await options.cacheStore.get(url);
    if (cached && isCacheEntryFresh(cached, now)) {
      return {
        url,
        mentionsBrand: cached.mentions_brand,
        status: cached.status ?? 200,
        fromCache: true,
        dryRun: false,
      };
    }
  }

  const isDryRun =
    options.dryRun ??
    (!options.fetchFn &&
      !options.dnsLookupFn &&
      (process.env.SERPAPI_DRY_RUN === "true" ||
        process.env.SERPAPI_DRY_RUN === "1"));

  if (isDryRun) {
    const html = loadThirdPartyFixtureHtml(url);
    const analysis = analyzeHtmlForBrand(html, {
      brandDomain: options.brandDomain,
      brandTerms: options.brandTerms,
      baseUrl: url,
    });

    if (options.cacheStore) {
      await options.cacheStore.upsert({
        url,
        fetched_at: now.toISOString(),
        mentions_brand: analysis.mentionsBrand,
        status: 200,
      });
    }

    return {
      url,
      mentionsBrand: analysis.mentionsBrand,
      status: 200,
      fromCache: false,
      dryRun: true,
    };
  }

  try {
    const fetched = await fetchSafeHtmlPage(url, options);

    if (fetched.status < 200 || fetched.status >= 300) {
      if (options.cacheStore) {
        await options.cacheStore.upsert({
          url,
          fetched_at: nowFn().toISOString(),
          mentions_brand: false,
          status: fetched.status || 500,
        });
      }
      return {
        url,
        mentionsBrand: false,
        status: fetched.status,
        fromCache: false,
        dryRun: false,
      };
    }

    const analysis = analyzeHtmlForBrand(fetched.html, {
      brandDomain: options.brandDomain,
      brandTerms: options.brandTerms,
      baseUrl: fetched.finalUrl,
    });

    if (options.cacheStore) {
      await options.cacheStore.upsert({
        url,
        fetched_at: nowFn().toISOString(),
        mentions_brand: analysis.mentionsBrand,
        status: fetched.status,
      });
    }

    return {
      url,
      mentionsBrand: analysis.mentionsBrand,
      status: fetched.status,
      fromCache: false,
      dryRun: false,
    };
  } catch {
    if (options.cacheStore) {
      await options.cacheStore.upsert({
        url,
        fetched_at: nowFn().toISOString(),
        mentions_brand: false,
        status: 0,
      });
    }
    return {
      url,
      mentionsBrand: false,
      status: 0,
      fromCache: false,
      dryRun: false,
    };
  }
}

export interface ThirdPartyKeywordStats {
  duration_ms: number;
  checked_count: number;
  skipped_count: number;
  timed_out: boolean;
}

/**
 * Mengevaluasi daftar sumber pihak ketiga (bukan domain sendiri) untuk satu keyword:
 * - Maksimal 10 sumber per keyword
 * - Konkurensi maksimal 3
 * - Batas waktu total per keyword: maksimal 15 detik (sumber yang belum selesai dilewati & ditandai tidak diperiksa)
 * - Mencatat durasi pemeriksaan tingkat 3 per keyword
 */
export async function evaluateThirdPartySourcesForCheck(
  input: {
    hasAiOverview: boolean;
    detected_domain: boolean;
    detected_text: boolean;
    sources: AnnotatedCheckSource[];
  },
  options: CheckThirdPartyPageOptions = {}
): Promise<{
  status: CheckStatus;
  detected_domain: boolean;
  detected_text: boolean;
  detected_third_party: boolean;
  sources: AnnotatedCheckSource[];
  thirdPartyStats: ThirdPartyKeywordStats;
}> {
  const startWallMs = Date.now();
  const keywordTimeoutMs =
    options.keywordTimeoutMs ?? KEYWORD_THIRD_PARTY_TIMEOUT_MS;
  const perSourceTimeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  const updatedSources: AnnotatedCheckSource[] = input.sources.map((s) => ({
    ...s,
  }));

  const thirdPartyIndices: number[] = [];
  for (let i = 0; i < updatedSources.length; i++) {
    if (!updatedSources[i]!.is_own) {
      thirdPartyIndices.push(i);
      if (thirdPartyIndices.length >= MAX_SOURCES_PER_KEYWORD) {
        break;
      }
    }
  }

  let cursor = 0;
  let checkedCount = 0;
  let skippedCount = 0;
  let timedOut = false;

  async function worker() {
    while (cursor < thirdPartyIndices.length) {
      const elapsedMs = Date.now() - startWallMs;
      const remainingKeywordMs = keywordTimeoutMs - elapsedMs;

      if (remainingKeywordMs <= 0) {
        timedOut = true;
        const skippedIdx = cursor++;
        if (skippedIdx < thirdPartyIndices.length) {
          skippedCount++;
        }
        continue;
      }

      const currentIdx = cursor++;
      const sourceIndex = thirdPartyIndices[currentIdx];
      if (sourceIndex === undefined) break;

      const src = updatedSources[sourceIndex]!;
      const effectiveSourceTimeout = Math.min(
        perSourceTimeoutMs,
        remainingKeywordMs
      );

      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const res = await Promise.race([
          checkThirdPartySourcePage(src.url, {
            ...options,
            timeoutMs: effectiveSourceTimeout,
          }),
          new Promise<null>((resolve) => {
            deadlineTimer = setTimeout(() => resolve(null), remainingKeywordMs);
          }),
        ]);

        const hitKeywordDeadline =
          res === null ||
          (res.status === 0 &&
            Date.now() - startWallMs >= keywordTimeoutMs - 5);

        if (hitKeywordDeadline) {
          timedOut = true;
          skippedCount++;
          updatedSources[sourceIndex] = {
            ...src,
            mentions_brand: false,
          };
        } else {
          checkedCount++;
          updatedSources[sourceIndex] = {
            ...src,
            mentions_brand: res.mentionsBrand,
          };
        }
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENCY, thirdPartyIndices.length);
  if (workerCount > 0) {
    await Promise.all(
      Array.from({ length: workerCount }, () => worker())
    );
  }

  const durationMs = Math.max(0, Date.now() - startWallMs);
  const detected_third_party = updatedSources.some(
    (s) => !s.is_own && s.mentions_brand
  );

  const isDetected =
    input.detected_domain || input.detected_text || detected_third_party;
  const status: CheckStatus = !input.hasAiOverview
    ? "no_ai_overview"
    : isDetected
      ? "detected"
      : "not_detected";

  return {
    status,
    detected_domain: input.detected_domain,
    detected_text: input.detected_text,
    detected_third_party,
    sources: updatedSources,
    thirdPartyStats: {
      duration_ms: durationMs,
      checked_count: checkedCount,
      skipped_count: skippedCount,
      timed_out: timedOut,
    },
  };
}
