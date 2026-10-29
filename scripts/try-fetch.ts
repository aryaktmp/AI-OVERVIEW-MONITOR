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
    console.error('Usage: npm run try:fetch -- "<url>"');
    process.exit(1);
  }

  const brandDomain = process.env.BRAND_DOMAIN || "linovhr.com";

  console.log("=== Third-Party Page Fetch Test (Live Mode) ===");
  console.log(`Brand Domain Target : ${brandDomain}`);

  try {
    const fetched = await fetchSafeHtmlPage(targetUrl);
    const analysis = analyzeHtmlForBrand(fetched.html, {
      brandDomain,
      baseUrl: fetched.finalUrl,
    });

    console.log(`Fetch Result        : SUCCESS`);
    console.log(`Rejection Reason    : -`);
    console.log(`HTTP Status         : ${fetched.status}`);
    console.log(
      `Size After Read     : ${fetched.byteLength} bytes (${(
        fetched.byteLength / 1024
      ).toFixed(1)} KB)${fetched.truncatedAtLimit ? " [Truncated at 500 KB limit]" : ""}`
    );
    console.log(`Redirect Count      : ${fetched.redirectCount}`);
    console.log(
      `Brand in Text       : ${analysis.matchedBrandText ? "YES (Found)" : "NO"}`
    );
    console.log(
      `Link to ${brandDomain} : ${analysis.matchedBrandLink ? "YES (Found)" : "NO"}`
    );
    console.log(
      `Tier 3 Conclusion   : ${analysis.mentionsBrand ? "DETECTED" : "NOT DETECTED"}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`Fetch Result        : REJECTED / FAILED`);
    console.log(`Rejection Reason    : ${reason}`);
    console.log(`HTTP Status         : -`);
    console.log(`Size After Read     : 0 bytes`);
    console.log(`Brand in Text       : NO`);
    console.log(`Link to ${brandDomain} : NO`);
    process.exitCode = 1;
  }
}

main();
