import fs from "node:fs";
import path from "node:path";
import { isDryRun } from "../lib/dry-run";
import {
  fetchKeywordAiOverview,
  parseSerpApiResponse,
  sanitizeSerpApiRaw,
  type ParsedAiOverview,
} from "../lib/serpapi";
import {
  buildBrandTermRegex,
  evaluateAiOverviewDetection,
} from "../lib/detect";

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
  dryRun: boolean | null;
  replayPath: string | null;
  extraParams: Record<string, string>;
} {
  let saveFixtureName: string | null = null;
  let dryRun: boolean | null = null;
  let replayPath: string | null = null;
  const extraParams: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--live") {
      dryRun = false;
    } else if (arg === "--replay") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Option --replay requires a <path> argument.");
      }
      replayPath = next.trim();
      i++;
    } else if (arg.startsWith("--replay=")) {
      replayPath = arg.slice("--replay=".length).trim();
    } else if (arg === "--param") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Option --param requires a <key=value> argument.");
      }
      const eqIdx = next.indexOf("=");
      if (eqIdx !== -1) {
        extraParams[next.slice(0, eqIdx).trim()] = next.slice(eqIdx + 1).trim();
      }
      i++;
    } else if (arg.startsWith("--param=")) {
      const paramStr = arg.slice("--param=".length).trim();
      const eqIdx = paramStr.indexOf("=");
      if (eqIdx !== -1) {
        extraParams[paramStr.slice(0, eqIdx).trim()] = paramStr
          .slice(eqIdx + 1)
          .trim();
      }
    } else if (arg === "--save-fixture") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Option --save-fixture requires a <name> argument.");
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
  if (!keyword && !replayPath) {
    throw new Error(
      'Usage: tsx scripts/try-keyword.ts "<keyword>" [--dry-run|--live] [--save-fixture <name>] [--replay <path>] [--param key=value]'
    );
  }

  return { keyword, saveFixtureName, dryRun, replayPath, extraParams };
}

function cleanFixtureForSaving(rawInput: unknown): unknown {
  const sanitized = sanitizeSerpApiRaw(rawInput);
  if (!sanitized || typeof sanitized !== "object") return sanitized;

  function recursiveClean(obj: unknown): unknown {
    if (typeof obj === "string") {
      let str = obj;
      if (str.includes("serpapi.com/searches/")) {
        str = "";
      }
      return str;
    }
    if (Array.isArray(obj)) {
      return obj.map(recursiveClean);
    }
    if (obj && typeof obj === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (
          k === "search_metadata" ||
          k === "raw_html_file" ||
          k === "json_endpoint" ||
          k === "markdown_endpoint" ||
          k === "pixel_position_endpoint" ||
          k.toLowerCase() === "api_key" ||
          k.toLowerCase() === "apikey"
        ) {
          continue;
        }
        out[k] = recursiveClean(v);
      }
      return out;
    }
    return obj;
  }

  return recursiveClean(sanitized);
}

async function main() {
  loadEnvLocal();
  const {
    keyword,
    saveFixtureName,
    dryRun: cliDryRun,
    replayPath,
    extraParams,
  } = parseArgs(process.argv.slice(2));

  let parsed: ParsedAiOverview;
  let apiCallsCount: number;
  let usedFollowUpPageToken: boolean;
  let answerText: string;
  let firstRawToSave: unknown = null;
  let secondRawToSave: unknown = null;

  if (replayPath) {
    // Mode Replay: membaca fixture langsung tanpa jaringan dan tanpa kuota
    console.log("MODE: REPLAY (fixture, no network)");
    const fixtureFullPath = path.isAbsolute(replayPath)
      ? replayPath
      : path.resolve(process.cwd(), replayPath);

    if (!fs.existsSync(fixtureFullPath)) {
      throw new Error(`Fixture file not found: ${fixtureFullPath}`);
    }

    const rawFixture = JSON.parse(fs.readFileSync(fixtureFullPath, "utf-8"));
    parsed = parseSerpApiResponse(rawFixture);
    apiCallsCount = 0;
    usedFollowUpPageToken = Boolean(
      rawFixture.used_followup_page_token || rawFixture.ai_overview_followup
    );
    answerText = parsed.answerText;
  } else {
    const effectiveDryRun = cliDryRun !== null ? cliDryRun : isDryRun();

    // Baris pertama wajib menampilkan status mode
    if (effectiveDryRun) {
      console.log("MODE: DRY RUN (fixture, no network)");
    } else {
      console.log("MODE: LIVE (SerpApi call)");
    }

    const result = await fetchKeywordAiOverview(keyword, {
      dryRun: effectiveDryRun,
      extraParams,
    });
    parsed = result.parsed;
    apiCallsCount = result.apiCallsCount;
    usedFollowUpPageToken = result.usedFollowUpPageToken;
    answerText = result.parsed.answerText;
    firstRawToSave = result.firstRaw;
    secondRawToSave = result.secondRaw;
  }

  const evaluation = evaluateAiOverviewDetection(parsed, {
    brandDomain: process.env.BRAND_DOMAIN ?? "linovhr.com",
  });

  // Jumlah panggilan SerpApi dan penggunaan page_token
  console.log(`Jumlah panggilan SerpApi       : ${apiCallsCount}`);
  console.log(
    `Penggunaan page_token          : ${usedFollowUpPageToken ? "Ya" : "Tidak"}`
  );
  console.log(`hasAiOverview                  : ${parsed.hasAiOverview}`);

  const totalSources = parsed.sources_total ?? parsed.sources.length;
  const resolvedSources =
    parsed.sources_resolved ??
    parsed.sources.filter(
      (s) => !s.is_google_internal && !s.is_unresolved
    ).length;
  const resolutionPct =
    totalSources > 0 ? Math.round((resolvedSources / totalSources) * 100) : 0;
  console.log(
    `Tingkat resolusi sumber        : ${resolvedSources}/${totalSources} (${resolutionPct}%)`
  );
  console.log(
    `Klasifikasi tautan             : ${parsed.link_kind_direct ?? 0} direct, ${parsed.link_kind_token ?? 0} token, ${parsed.link_kind_google_internal ?? 0} google_internal`
  );
  console.log(`Jumlah total sumber unik       : ${parsed.sources.length}`);

  // Daftar domain unik beserta jumlah kemunculan (bukan daftar mentah)
  const domainCounts = new Map<string, number>();
  for (const s of parsed.sources) {
    const d = s.domain;
    domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }
  const uniqueDomainList = Array.from(domainCounts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  console.log(
    `Daftar domain unik (${uniqueDomainList.length} domain unik, ${parsed.sources.length} total sumber):`
  );
  if (uniqueDomainList.length === 0) {
    console.log("  (tidak ada sumber)");
  } else {
    for (const [domain, count] of uniqueDomainList) {
      console.log(`  - ${domain} (${count} kemunculan)`);
    }
  }

  console.log(`Final status                   : ${evaluation.status}`);
  console.log(
    `Detection flags                : detected_domain=${evaluation.detected_domain}, detected_text=${evaluation.detected_text}, detected_third_party=${evaluation.detected_third_party}`
  );

  // Untuk detected_text: istilah merek yang cocok dan 80 karakter konteks di sekitarnya tanpa seluruh teks
  console.log("Deteksi teks merek (detected_text):");
  if (!evaluation.detected_text || evaluation.matched_terms.length === 0) {
    console.log("  false (tidak ada istilah merek yang cocok)");
  } else {
    console.log(
      `  true (istilah cocok: ${evaluation.matched_terms.join(", ")})`
    );
    for (const term of evaluation.matched_terms) {
      const regex = buildBrandTermRegex(term);
      const match = regex.exec(answerText);
      if (match) {
        // Sekitar 40 karakter sebelum dan 40 karakter sesudah istilah (total ~80 karakter konteks di sekitar istilah)
        const start = Math.max(0, match.index - 40);
        const end = Math.min(
          answerText.length,
          match.index + match[0].length + 40
        );
        const rawContext = answerText
          .slice(start, end)
          .replace(/\s+/g, " ")
          .trim();
        const prefix = start > 0 ? "..." : "";
        const suffix = end < answerText.length ? "..." : "";
        console.log(`  - Istilah cocok : "${term}"`);
        console.log(`    Konteks (~80 char): "${prefix}${rawContext}${suffix}"`);
      }
    }
  }

  if (saveFixtureName && firstRawToSave) {
    const fixturesDir = path.join(process.cwd(), "tests", "fixtures");
    fs.mkdirSync(fixturesDir, { recursive: true });

    const safeBaseName = path.basename(saveFixtureName).replace(/\.json$/, "");
    const primaryPath = path.join(fixturesDir, `${safeBaseName}.json`);
    const cleanedFirst = cleanFixtureForSaving(firstRawToSave);
    let rawJsonStr = JSON.stringify(cleanedFirst, null, 2);
    const keyToRedact = process.env.SERPAPI_KEY;
    if (keyToRedact && keyToRedact.length >= 8) {
      rawJsonStr = rawJsonStr.split(keyToRedact).join("[REDACTED]");
    }
    if (keyToRedact && rawJsonStr.includes(keyToRedact)) {
      throw new Error("Security check failed: api_key still present in fixture!");
    }
    fs.writeFileSync(primaryPath, rawJsonStr, "utf-8");
    console.log(
      `1st call fixture saved: tests/fixtures/${safeBaseName}.json`
    );

    if (usedFollowUpPageToken && secondRawToSave) {
      const followUpName = `${safeBaseName}-followup.json`;
      const followUpPath = path.join(fixturesDir, followUpName);
      const cleanedSecond = cleanFixtureForSaving(secondRawToSave);
      let secondJsonStr = JSON.stringify(cleanedSecond, null, 2);
      if (keyToRedact && keyToRedact.length >= 8) {
        secondJsonStr = secondJsonStr.split(keyToRedact).join("[REDACTED]");
      }
      if (keyToRedact && secondJsonStr.includes(keyToRedact)) {
        throw new Error("Security check failed: api_key still present in follow-up fixture!");
      }
      fs.writeFileSync(followUpPath, secondJsonStr, "utf-8");
      console.log(
        `2nd call fixture saved: tests/fixtures/${followUpName}`
      );
    }
  }
}

main().catch((err) => {
  console.error(
    "Failed to execute try:keyword:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
