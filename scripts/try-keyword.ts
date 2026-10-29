import fs from "node:fs";
import path from "node:path";
import {
  fetchKeywordAiOverview,
  sanitizeSerpApiRaw,
} from "../lib/serpapi.ts";
import { evaluateAiOverviewDetection } from "../lib/detect.ts";

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
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

function parseArgs(argv: string[]): {
  keyword: string;
  saveFixtureName: string | null;
} {
  let saveFixtureName: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--save-fixture") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Opsi --save-fixture membutuhkan argumen <nama>.");
      }
      saveFixtureName = next.replace(/\.json$/i, "").trim();
      i++;
    } else if (arg.startsWith("--save-fixture=")) {
      saveFixtureName = arg
        .slice("--save-fixture=".length)
        .replace(/\.json$/i, "")
        .trim();
    } else {
      positional.push(arg);
    }
  }

  const keyword = positional.join(" ").trim();
  if (!keyword) {
    throw new Error(
      'Penggunaan: npm run try:keyword -- "<keyword>" [--save-fixture <nama>]'
    );
  }

  return { keyword, saveFixtureName };
}

async function main() {
  loadEnvLocal();
  const { keyword, saveFixtureName } = parseArgs(process.argv.slice(2));

  const result = await fetchKeywordAiOverview(keyword, { dryRun: false });
  const evaluation = evaluateAiOverviewDetection(result.parsed, {
    brandDomain: process.env.BRAND_DOMAIN ?? "linovhr.com",
  });

  const sourceDomains = result.parsed.sources.map((s) => s.domain);
  const answerPreview = result.parsed.answerText
    ? result.parsed.answerText.replace(/\s+/g, " ").trim().slice(0, 200)
    : "(kosong)";

  console.log("=== Hasil Uji Keyword SerpApi ===");
  console.log(`Keyword                        : ${keyword}`);
  console.log(
    `Panggilan kedua (page_token)   : ${result.usedFollowUpPageToken ? "Ya" : "Tidak"}`
  );
  console.log(`Jumlah panggilan SerpApi       : ${result.apiCallsCount}`);
  console.log(`hasAiOverview                  : ${result.parsed.hasAiOverview}`);
  console.log(`Jumlah sumber                  : ${result.parsed.sources.length}`);
  console.log(
    `Daftar domain sumber           : ${sourceDomains.length > 0 ? sourceDomains.join(", ") : "-"}`
  );
  console.log(`Status akhir                   : ${evaluation.status}`);
  console.log(
    `Flag deteksi                   : detected_domain=${evaluation.detected_domain}, detected_text=${evaluation.detected_text}, detected_third_party=${evaluation.detected_third_party}`
  );
  console.log(`200 karakter pertama jawaban   : ${answerPreview}`);

  if (saveFixtureName) {
    const fixturesDir = path.join(process.cwd(), "tests", "fixtures");
    fs.mkdirSync(fixturesDir, { recursive: true });

    const safeBaseName = path.basename(saveFixtureName);
    const primaryPath = path.join(fixturesDir, `${safeBaseName}.json`);
    const sanitizedFirst = sanitizeSerpApiRaw(result.firstRaw);
    fs.writeFileSync(
      primaryPath,
      JSON.stringify(sanitizedFirst, null, 2),
      "utf-8"
    );
    console.log(
      `Fixture panggilan ke-1 disimpan: tests/fixtures/${safeBaseName}.json`
    );

    if (result.usedFollowUpPageToken && result.secondRaw) {
      const followUpName = `${safeBaseName}-followup.json`;
      const followUpPath = path.join(fixturesDir, followUpName);
      const sanitizedSecond = sanitizeSerpApiRaw(result.secondRaw);
      fs.writeFileSync(
        followUpPath,
        JSON.stringify(sanitizedSecond, null, 2),
        "utf-8"
      );
      console.log(
        `Fixture panggilan ke-2 disimpan: tests/fixtures/${followUpName}`
      );
    }
  }
}

main().catch((err) => {
  console.error(
    "Gagal menjalankan try:keyword:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
