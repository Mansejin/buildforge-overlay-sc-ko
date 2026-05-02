// scripts/scrape-liquipedia.mjs
// Release-time catalog scraper. Walks the full Liquipedia strategy graph
// (per-race + per-matchup + per-difficulty categories), unions with the
// checked-in safety net at data/known-build-pages.txt, then streams every
// discovered page through the Rust `scrape` binary so the parser used at
// release time is byte-identical to the parser the app ships.
//
// Outputs:
//   data/builds.json          - canonical catalog, ready to ship as Tauri resource
//   data/scrape-coverage.json - per-page report (categories, variants, outcome)
//
// CLI:
//   node scripts/scrape-liquipedia.mjs [--rate-limit-ms=2300] [--user-agent=...]
//                                      [--max-pages=N]    (debug; truncates discovery)
//                                      [--titles=a.txt]   (skip discovery, use file as source)
//                                      [--scrape-bin=PATH] (override Rust binary path)
//                                      [--no-build]       (skip cargo build; assume bin is fresh)

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const BUILDS_OUT = join(DATA_DIR, "builds.json");
const COVERAGE_OUT = join(DATA_DIR, "scrape-coverage.json");
const KNOWN_PAGES = join(DATA_DIR, "known-build-pages.txt");

const args = parseArgs(process.argv.slice(2));
const rateLimitMs = Math.max(2000, Number(args["rate-limit-ms"]) || 2300);
const userAgent =
  args["user-agent"] ||
  process.env.BW_LIQUIPEDIA_USER_AGENT ||
  "BWBuildOverlay-Scrape/2.0.0 (https://github.com/Etra-0/starcraft-build-overlay)";
const maxPages = Number(args["max-pages"]) || 0;
const titlesFile = args["titles"];
const skipBuild = "no-build" in args;
const scrapeBinOverride = args["scrape-bin"];

const RACES = ["Protoss", "Terran", "Zerg"];
const MATCHUPS = ["PvT", "PvZ", "PvP", "TvP", "TvZ", "TvT", "ZvP", "ZvT", "ZvZ"];
const DIFFICULTY_BUCKETS = ["Beginner_Strategy", "Intermediate_Strategy", "Advanced_Strategy"];

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

function categorySeeds() {
  const seeds = new Set();
  for (const r of RACES) {
    seeds.add(`Category:${r}_Build_Orders`);
    seeds.add(`Category:${r}_Builds`);
    seeds.add(`Category:${r}_Strategy`);
    for (const d of DIFFICULTY_BUCKETS) {
      seeds.add(`Category:${r}_${d}`);
    }
  }
  for (const m of MATCHUPS) {
    seeds.add(`Category:${m}_Builds`);
    seeds.add(`Category:${m}_Build_Orders`);
    seeds.add(`Category:${m}_Strategy`);
  }
  return [...seeds];
}

async function liquipediaApi(params) {
  const url = new URL("https://liquipedia.net/starcraft/api.php");
  for (const [k, v] of Object.entries({ format: "json", formatversion: "2", ...params })) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Liquipedia HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  await sleep(rateLimitMs);
  if (json.error) throw new Error(`Liquipedia API ${json.error.code}: ${json.error.info}`);
  return json;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function walkCategory(category) {
  const pages = [];
  let cmcontinue;
  for (;;) {
    const json = await liquipediaApi({
      action: "query",
      list: "categorymembers",
      cmtitle: category,
      cmlimit: 500,
      cmcontinue
    });
    const members = json.query?.categorymembers || [];
    pages.push(...members);
    cmcontinue = json.continue?.cmcontinue;
    if (!cmcontinue) break;
  }
  return pages;
}

function loadKnownPages() {
  if (!existsSync(KNOWN_PAGES)) return [];
  return readFileSync(KNOWN_PAGES, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function locateScrapeBin() {
  if (scrapeBinOverride) return resolve(ROOT, scrapeBinOverride);
  const candidates = [
    join(ROOT, "src-tauri", "target", "release", "scrape.exe"),
    join(ROOT, "src-tauri", "target", "release", "scrape"),
    join(ROOT, "src-tauri", "target", "debug", "scrape.exe"),
    join(ROOT, "src-tauri", "target", "debug", "scrape")
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "scrape binary not found; pass --scrape-bin=PATH or run without --no-build to compile"
  );
}

function buildScrapeBin() {
  if (skipBuild) return;
  console.log("[scrape] building Rust scrape binary (release)...");
  execSync("cargo build --release --manifest-path src-tauri/Cargo.toml --bin scrape", {
    cwd: ROOT,
    stdio: "inherit"
  });
}

async function runScrape(titles) {
  const bin = locateScrapeBin();
  console.log(`[scrape] piping ${titles.length} titles into ${bin}`);
  return new Promise((resolveP, reject) => {
    const child = spawn(bin, [], {
      cwd: ROOT,
      env: {
        ...process.env,
        BW_LIQUIPEDIA_USER_AGENT: userAgent,
        BW_LIQUIPEDIA_RATE_LIMIT_MS: String(rateLimitMs)
      }
    });
    const records = [];
    let stderrBuf = "";
    let stdoutBuf = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk;
      let idx;
      while ((idx = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, idx);
        stderrBuf = stderrBuf.slice(idx + 1);
        if (line) console.log(`  [scrape-bin] ${line}`);
      }
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          records.push(JSON.parse(line));
        } catch (err) {
          console.warn("  could not parse scrape line:", line.slice(0, 140), err.message);
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stderrBuf) console.log(`  [scrape-bin] ${stderrBuf}`);
      if (code !== 0) {
        reject(new Error(`scrape binary exited ${code}`));
      } else {
        resolveP(records);
      }
    });
    child.stdin.setDefaultEncoding("utf8");
    child.stdin.write(titles.join("\n") + "\n");
    child.stdin.end();
  });
}

function pageTitleIsArticle(title) {
  if (!title) return false;
  if (title.startsWith("Category:")) return false;
  if (title.startsWith("File:") || title.startsWith("Image:")) return false;
  if (title.startsWith("Template:")) return false;
  return true;
}

async function discoverPages() {
  const seeds = categorySeeds();
  console.log(`[scrape] discovery seeds: ${seeds.length} categories`);
  const pageToCats = new Map(); // canonical title -> Set<category>
  for (const cat of seeds) {
    let members;
    try {
      members = await walkCategory(cat);
    } catch (err) {
      console.warn(`[scrape] skipping ${cat}: ${err.message}`);
      continue;
    }
    let pageCount = 0;
    for (const m of members) {
      if (m.ns !== 0) continue; // ns=0 == article namespace
      if (!pageTitleIsArticle(m.title)) continue;
      pageCount++;
      const set = pageToCats.get(m.title) || new Set();
      set.add(cat);
      pageToCats.set(m.title, set);
    }
    console.log(`  ${cat}: ${pageCount} article pages (running unique total: ${pageToCats.size})`);
  }
  for (const known of loadKnownPages()) {
    const set = pageToCats.get(known) || new Set();
    set.add("known-build-pages.txt");
    pageToCats.set(known, set);
  }
  console.log(`[scrape] total unique candidate pages: ${pageToCats.size}`);
  return pageToCats;
}

async function main() {
  buildScrapeBin();
  let pageToCats;
  if (titlesFile) {
    const list = readFileSync(resolve(ROOT, titlesFile), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    pageToCats = new Map(list.map((t) => [t, new Set(["--titles file"])]));
    console.log(`[scrape] loaded ${pageToCats.size} titles from ${titlesFile}, skipping discovery`);
  } else {
    pageToCats = await discoverPages();
  }

  let titles = [...pageToCats.keys()].sort();
  if (maxPages > 0 && titles.length > maxPages) {
    console.log(`[scrape] truncating to first ${maxPages} pages (--max-pages)`);
    titles = titles.slice(0, maxPages);
  }

  const records = await runScrape(titles);

  // Aggregate into BuildsData. Sort builds by (matchup, name) for stable diffs.
  const allBuilds = [];
  const coverage = [];
  let okCount = 0;
  let emptyCount = 0;
  let errCount = 0;
  for (const rec of records) {
    const cats = [...(pageToCats.get(rec.title) || pageToCats.get(rec.pageTitle) || [])];
    coverage.push({
      title: rec.pageTitle || rec.title,
      categories: cats.sort(),
      revisionId: rec.revisionId ?? null,
      revisionTimestamp: rec.revisionTimestamp ?? null,
      variantsExtracted: rec.builds?.length || 0,
      outcome: rec.outcome,
      error: rec.error || null
    });
    if (rec.outcome === "ok") {
      okCount++;
      allBuilds.push(...rec.builds);
    } else if (rec.outcome === "fetch-error") {
      errCount++;
      console.warn(`[scrape] FAIL ${rec.pageTitle || rec.title}: ${rec.error}`);
    } else {
      emptyCount++;
    }
  }

  allBuilds.sort((a, b) => {
    const m = (a.matchup || "").localeCompare(b.matchup || "");
    if (m !== 0) return m;
    return (a.name || "").localeCompare(b.name || "");
  });
  // Dedupe on id (last write wins) - shouldn't happen with deterministic IDs
  // but cheap insurance for cases where two pages produce the same canonical
  // race+opp+slug.
  const byId = new Map();
  for (const b of allBuilds) byId.set(b.id, b);
  const builds = [...byId.values()];

  const today = new Date().toISOString().slice(0, 10);
  const envelope = { version: 4, lastUpdated: today, builds };
  writeFileSync(BUILDS_OUT, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  console.log(`[scrape] wrote ${BUILDS_OUT} - ${builds.length} builds`);

  coverage.sort((a, b) => a.title.localeCompare(b.title));
  const coverageDoc = {
    scrapedAt: new Date().toISOString(),
    pagesDiscovered: pageToCats.size,
    pagesScraped: records.length,
    pagesOk: okCount,
    pagesEmpty: emptyCount,
    pagesFailed: errCount,
    buildsEmitted: builds.length,
    pages: coverage
  };
  writeFileSync(COVERAGE_OUT, JSON.stringify(coverageDoc, null, 2) + "\n", "utf8");
  console.log(
    `[scrape] coverage: ${okCount} ok, ${emptyCount} empty, ${errCount} failed; details in ${COVERAGE_OUT}`
  );
}

main().catch((err) => {
  console.error("[scrape] fatal:", err);
  process.exit(1);
});
