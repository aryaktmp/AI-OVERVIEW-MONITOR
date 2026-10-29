import { describe, expect, it, vi } from "vitest";
import {
  analyzeHtmlForBrand,
  checkThirdPartySourcePage,
  evaluateThirdPartySourcesForCheck,
  fetchSafeHtmlPage,
  isBlockedIpAddress,
  MAX_HTML_BYTES,
  validateAndResolveTargetUrl,
  type DnsLookupFn,
  type PageCacheEntry,
  type PageCacheStore,
} from "@/lib/fetch-page";
import type { AnnotatedCheckSource } from "@/lib/detect";

function createInMemoryPageCache(): {
  store: PageCacheStore;
  map: Map<string, PageCacheEntry>;
} {
  const map = new Map<string, PageCacheEntry>();
  return {
    map,
    store: {
      async get(url: string) {
        return map.get(url) ?? null;
      },
      async upsert(entry: PageCacheEntry) {
        map.set(entry.url, entry);
      },
    },
  };
}

const safeDnsMock: DnsLookupFn = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("Perlindungan SSRF & Deteksi Tingkat 3 (lib/fetch-page.ts)", () => {
  it("menolak localhost, IP privat, link-local, metadata cloud, 0.0.0.0, IPv6 loopback, dan IPv4 dalam IPv6", async () => {
    const blockedIps = [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.100.254",
      "169.254.169.254", // AWS/GCP/Cloud metadata
      "169.254.1.1", // link-local
      "0.0.0.0",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:172.16.5.4",
      "::ffff:192.168.1.1",
      "::ffff:169.254.169.254",
      "64:ff9b::127.0.0.1",
      "2002:7f00:0001::1",
    ];

    for (const ip of blockedIps) {
      expect(isBlockedIpAddress(ip), `IP ${ip} seharusnya ditolak`).toBe(true);
    }

    // Pastikan IP publik standar diizinkan
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
    expect(isBlockedIpAddress("172.15.255.255")).toBe(false);
    expect(isBlockedIpAddress("172.32.0.1")).toBe(false);
    expect(isBlockedIpAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);

    // Tolak URL dengan hostname localhost atau literal IP terlarang
    const blockedUrls = [
      "http://localhost/admin",
      "http://sub.localhost/test",
      "http://127.0.0.1/secret",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/",
    ];

    for (const url of blockedUrls) {
      await expect(
        validateAndResolveTargetUrl(url, safeDnsMock),
        `URL ${url} seharusnya ditolak`
      ).rejects.toThrow(/ditolak|SSRF/i);
    }
  });

  it("menolak hostname yang resolve ke IP privat atau metadata cloud, dan menyambung ke IP hasil resolusi", async () => {
    const privateDnsMock: DnsLookupFn = async (hostname) => {
      if (hostname === "rebind-private.example.com") {
        return [{ address: "192.168.1.25", family: 4 }];
      }
      if (hostname === "rebind-metadata.example.com") {
        return [{ address: "169.254.169.254", family: 4 }];
      }
      if (hostname === "dual-record.example.com") {
        return [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.8", family: 4 },
        ];
      }
      return [{ address: "93.184.216.34", family: 4 }];
    };

    await expect(
      fetchSafeHtmlPage("https://rebind-private.example.com/artikel", {
        dnsLookupFn: privateDnsMock,
      })
    ).rejects.toThrow(/SSRF|terlarang/i);

    await expect(
      fetchSafeHtmlPage("https://rebind-metadata.example.com/artikel", {
        dnsLookupFn: privateDnsMock,
      })
    ).rejects.toThrow(/SSRF|terlarang/i);

    await expect(
      fetchSafeHtmlPage("https://dual-record.example.com/artikel", {
        dnsLookupFn: privateDnsMock,
      })
    ).rejects.toThrow(/SSRF|terlarang/i);

    // Pastikan jika DNS aman, fetchFn menerima pinnedIp hasil resolusi dan tanpa Cookie/Authorization
    const mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["Cookie"]).toBeUndefined();
      expect(headers["Authorization"]).toBeUndefined();
      expect((init as Record<string, unknown>)?.pinnedIp).toBe("93.184.216.34");
      return new Response("<html><body>Halo</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    const okResult = await fetchSafeHtmlPage("https://safe.example.com/artikel", {
      dnsLookupFn: privateDnsMock,
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    expect(okResult.pinnedIp).toBe("93.184.216.34");
    expect(okResult.status).toBe(200);
  });

  it("menolak pengalihan (redirect) ke IP privat dan pengalihan lebih dari 3 kali", async () => {
    const dnsMock: DnsLookupFn = async (hostname) => {
      if (hostname === "internal.corp") {
        return [{ address: "10.10.1.5", family: 4 }];
      }
      return [{ address: "93.184.216.34", family: 4 }];
    };

    // Kasus 1: Redirect dari domain publik ke host yang resolve ke IP privat
    const redirectToPrivateFetch = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr === "https://public.example.com/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://internal.corp/secret" },
        });
      }
      return new Response("<html>Secret</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    await expect(
      fetchSafeHtmlPage("https://public.example.com/start", {
        dnsLookupFn: dnsMock,
        fetchFn: redirectToPrivateFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/SSRF|terlarang/i);

    // Kasus 2: Redirect lebih dari 3 kali (4 kali berturut-turut)
    let hop = 0;
    const tooManyRedirectsFetch = vi.fn(async () => {
      hop++;
      return new Response(null, {
        status: 301,
        headers: { location: `https://public.example.com/hop-${hop}` },
      });
    });

    await expect(
      fetchSafeHtmlPage("https://public.example.com/hop-0", {
        dnsLookupFn: dnsMock,
        fetchFn: tooManyRedirectsFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/Pengalihan melebihi batas maksimal/i);
    expect(tooManyRedirectsFetch).toHaveBeenCalledTimes(4);
  });

  it("menolak port selain 80 dan 443 serta skema selain http dan https", async () => {
    const invalidUrls = [
      "ftp://example.com/file.html",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "gopher://example.com:70/",
      "http://example.com:8080/artikel",
      "https://example.com:8443/artikel",
      "http://example.com:3000/api",
      "http://example.com:22/",
    ];

    for (const url of invalidUrls) {
      await expect(
        validateAndResolveTargetUrl(url, safeDnsMock),
        `URL ${url} seharusnya ditolak`
      ).rejects.toThrow(/Skema URL ditolak|Port URL ditolak/i);
    }

    // Port 80 dan 443 diizinkan
    const ok80 = await validateAndResolveTargetUrl(
      "http://example.com:80/artikel",
      safeDnsMock
    );
    expect(ok80.parsedUrl.port).toBe("");
    const ok443 = await validateAndResolveTargetUrl(
      "https://example.com:443/artikel",
      safeDnsMock
    );
    expect(ok443.parsedUrl.port).toBe("");
  });

  it("menerapkan batas ukuran 500 KB, batas waktu 8 detik, dan menolak content-type bukan text/html", async () => {
    // 1. Tolak Content-Type application/pdf
    const pdfFetch = vi.fn(async () => {
      return new Response("%PDF-1.5...", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    });

    await expect(
      fetchSafeHtmlPage("https://example.com/dokumen.pdf", {
        dnsLookupFn: safeDnsMock,
        fetchFn: pdfFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/Content-Type ditolak/i);

    // 2. Potong pembacaan tepat di 500 KB (MAX_HTML_BYTES = 512.000 byte)
    const oversizedHtml = "<html><body>" + "A".repeat(700 * 1024) + "</body></html>";
    const oversizedFetch = vi.fn(async () => {
      return new Response(oversizedHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    const truncatedRes = await fetchSafeHtmlPage("https://example.com/besar", {
      dnsLookupFn: safeDnsMock,
      fetchFn: oversizedFetch as unknown as typeof fetch,
    });
    expect(truncatedRes.truncatedAtLimit).toBe(true);
    expect(truncatedRes.byteLength).toBe(MAX_HTML_BYTES);

    // 3. Batas waktu (timeout)
    const slowFetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        })
    );

    await expect(
      fetchSafeHtmlPage("https://example.com/lambat", {
        dnsLookupFn: safeDnsMock,
        fetchFn: slowFetch as unknown as typeof fetch,
        timeoutMs: 30,
      })
    ).rejects.toThrow(/Batas waktu pengambilan halaman habis/i);
  });

  it("mendeteksi istilah merek di teks bersih, link ke linovhr.com, dan mengabaikan domain mirip (notlinovhr.com) serta isi script/style", () => {
    // 1. Mengabaikan istilah merek di dalam <script> dan <style>, serta domain mirip notlinovhr.com
    const htmlFalsePositive = `
      <html>
        <head>
          <style>.linovhr { color: red; }</style>
          <script>const vendor = "LinovHR"; const url = "https://linovhr.com";</script>
        </head>
        <body>
          <p>Artikel ini membahas manajemen cuti karyawan secara umum.</p>
          <a href="https://notlinovhr.com/fitur">Portal SDM Eksternal</a>
          <a href="https://kompetitor.id/artikel?utm_source=linovhr.com">Parameter Query</a>
        </body>
      </html>
    `;
    const resFalse = analyzeHtmlForBrand(htmlFalsePositive, {
      brandDomain: "linovhr.com",
    });
    expect(resFalse.mentionsBrand).toBe(false);
    expect(resFalse.matchedBrandText).toBe(false);
    expect(resFalse.matchedBrandLink).toBe(false);

    // 2. Mendeteksi link <a href="https://www.linovhr.com/payroll"> walau teks anchor tidak menyebut merek
    const htmlWithBrandLink = `
      <html>
        <body>
          <p>Pelajari selengkapnya di <a href="https://www.linovhr.com/payroll">situs resmi penyedia ini</a>.</p>
        </body>
      </html>
    `;
    const resLink = analyzeHtmlForBrand(htmlWithBrandLink, {
      brandDomain: "linovhr.com",
    });
    expect(resLink.mentionsBrand).toBe(true);
    expect(resLink.matchedBrandLink).toBe(true);
    expect(resLink.matchedBrandText).toBe(false);

    // 3. Mendeteksi penyebutan nama merek di teks body
    const htmlWithBrandText = `
      <html>
        <body>
          <p>Salah satu aplikasi HRIS lokal adalah LinovHR yang mendukung PPh 21.</p>
        </body>
      </html>
    `;
    const resText = analyzeHtmlForBrand(htmlWithBrandText, {
      brandDomain: "linovhr.com",
    });
    expect(resText.mentionsBrand).toBe(true);
    expect(resText.matchedBrandText).toBe(true);
  });

  it("memakai ulang hasil page_cache selama 7 hari (berhasil) dan 24 jam (gagal), serta memperbaruinya setelah kedaluwarsa", async () => {
    const { store: cacheStore } = createInMemoryPageCache();
    let currentTime = new Date("2026-10-29T08:00:00Z");

    const fetchMock = vi.fn(async () => {
      return new Response(
        '<html><body><p>Direkomendasikan menggunakan LinovHR.</p></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        }
      );
    });

    // Panggilan ke-1: ambil dari jaringan dan simpan ke cache
    const first = await checkThirdPartySourcePage(
      "https://blogsdm.id/review-hris",
      {
        dnsLookupFn: safeDnsMock,
        fetchFn: fetchMock as unknown as typeof fetch,
        cacheStore,
        nowFn: () => currentTime,
      }
    );
    expect(first.fromCache).toBe(false);
    expect(first.mentionsBrand).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Panggilan ke-2 (hari ke-6, masih < 7 hari): ambil dari cache tanpa memanggil fetch
    currentTime = new Date("2026-11-04T07:00:00Z");
    const second = await checkThirdPartySourcePage(
      "https://blogsdm.id/review-hris",
      {
        dnsLookupFn: safeDnsMock,
        fetchFn: fetchMock as unknown as typeof fetch,
        cacheStore,
        nowFn: () => currentTime,
      }
    );
    expect(second.fromCache).toBe(true);
    expect(second.mentionsBrand).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Panggilan ke-3 (hari ke-8, sudah > 7 hari): cache kedaluwarsa, panggil fetch ulang
    currentTime = new Date("2026-11-06T09:00:00Z");
    const third = await checkThirdPartySourcePage(
      "https://blogsdm.id/review-hris",
      {
        dnsLookupFn: safeDnsMock,
        fetchFn: fetchMock as unknown as typeof fetch,
        cacheStore,
        nowFn: () => currentTime,
      }
    );
    expect(third.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Kasus gagal (mis. bukan HTML): disimpan di cache selama 24 jam
    const failFetchMock = vi.fn(async () => {
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const fail1 = await checkThirdPartySourcePage(
      "https://blogsdm.id/api.json",
      {
        dnsLookupFn: safeDnsMock,
        fetchFn: failFetchMock as unknown as typeof fetch,
        cacheStore,
        nowFn: () => currentTime,
      }
    );
    expect(fail1.status).toBe(0);
    expect(fail1.fromCache).toBe(false);
    expect(failFetchMock).toHaveBeenCalledTimes(1);

    // 12 jam kemudian (< 24 jam): ambil dari cache gagal tanpa memanggil jaringan lagi
    currentTime = new Date(currentTime.getTime() + 12 * 3600_000);
    const fail2 = await checkThirdPartySourcePage(
      "https://blogsdm.id/api.json",
      {
        dnsLookupFn: safeDnsMock,
        fetchFn: failFetchMock as unknown as typeof fetch,
        cacheStore,
        nowFn: () => currentTime,
      }
    );
    expect(fail2.fromCache).toBe(true);
    expect(failFetchMock).toHaveBeenCalledTimes(1);
  });

  it("membatasi maksimal 10 sumber pihak ketiga per keyword, melewati domain sendiri, dan memperbarui detected_third_party", async () => {
    const sources: AnnotatedCheckSource[] = [
      {
        position: 1,
        title: "LinovHR",
        url: "https://linovhr.com/fitur",
        domain: "linovhr.com",
        is_own: true,
        is_competitor: false,
        mentions_brand: true,
      },
      ...Array.from({ length: 12 }, (_, idx) => ({
        position: idx + 2,
        title: `Artikel ${idx + 1}`,
        url: `https://media-${idx + 1}.example.com/artikel`,
        domain: `media-${idx + 1}.example.com`,
        is_own: false,
        is_competitor: false,
        mentions_brand: false,
      })),
    ];

    const visitedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      visitedUrls.push(urlStr);
      const html =
        urlStr.includes("media-3.example.com")
          ? '<html><body>Lihat <a href="https://linovhr.com">LinovHR</a></body></html>'
          : "<html><body>Artikel umum</body></html>";
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const evaluated = await evaluateThirdPartySourcesForCheck(
      {
        hasAiOverview: true,
        detected_domain: false,
        detected_text: false,
        sources,
      },
      {
        dnsLookupFn: safeDnsMock,
        fetchFn: fetchMock as unknown as typeof fetch,
      }
    );

    // Hanya maksimal 10 sumber non-own yang diambil (bukan 12, dan bukan linovhr.com)
    expect(visitedUrls).toHaveLength(10);
    expect(visitedUrls.some((u) => u.includes("linovhr.com"))).toBe(false);
    expect(evaluated.detected_third_party).toBe(true);
    expect(evaluated.status).toBe("detected");
    expect(
      evaluated.sources.find((s) => s.domain === "media-3.example.com")
        ?.mentions_brand
    ).toBe(true);
  });

  it("memakai fixture HTML dari tests/fixtures saat mode dry-run aktif tanpa memanggil jaringan", async () => {
    const res = await checkThirdPartySourcePage(
      "https://blogsdm.id/artikel/software-hr-terbaik",
      {
        dryRun: true,
      }
    );

    expect(res.dryRun).toBe(true);
    expect(res.status).toBe(200);
    expect(typeof res.mentionsBrand).toBe("boolean");
  });
});
