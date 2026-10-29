import fs from "node:fs";
import path from "node:path";
import { analyzeHtmlForBrand, fetchSafeHtmlPage } from "../lib/fetch-page.ts";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnvLocal();

  const targetUrl = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (!targetUrl) {
    console.error('Cara pakai: npm run try:fetch -- "<url>"');
    process.exit(1);
  }

  const brandDomain = process.env.BRAND_DOMAIN || "linovhr.com";

  console.log("=== Uji Fetch Halaman Pihak Ketiga (Mode Nyata) ===");
  console.log(`Target Domain Merek : ${brandDomain}`);

  try {
    const fetched = await fetchSafeHtmlPage(targetUrl);
    const analysis = analyzeHtmlForBrand(fetched.html, {
      brandDomain,
      baseUrl: fetched.finalUrl,
    });

    console.log(`Hasil Pengambilan   : BERHASIL`);
    console.log(`Alasan Penolakan    : -`);
    console.log(`Status HTTP         : ${fetched.status}`);
    console.log(
      `Ukuran Setelah Baca : ${fetched.byteLength} byte (${(
        fetched.byteLength / 1024
      ).toFixed(1)} KB)${fetched.truncatedAtLimit ? " [Terpotong pada batas 500 KB]" : ""}`
    );
    console.log(`Jumlah Pengalihan   : ${fetched.redirectCount}`);
    console.log(
      `Merek di Teks       : ${analysis.matchedBrandText ? "YA (Ditemukan)" : "TIDAK"}`
    );
    console.log(
      `Link ke ${brandDomain} : ${analysis.matchedBrandLink ? "YA (Ditemukan)" : "TIDAK"}`
    );
    console.log(
      `Kesimpulan Tingkat 3: ${analysis.mentionsBrand ? "TERDETEKSI" : "TIDAK TERDETEKSI"}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`Hasil Pengambilan   : DITOLAK / GAGAL`);
    console.log(`Alasan Penolakan    : ${reason}`);
    console.log(`Status HTTP         : -`);
    console.log(`Ukuran Setelah Baca : 0 byte`);
    console.log(`Merek di Teks       : TIDAK`);
    console.log(`Link ke ${brandDomain} : TIDAK`);
    process.exitCode = 1;
  }
}

main();
