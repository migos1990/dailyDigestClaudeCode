/*
  DAILY DIGEST ORCHESTRATOR — Pipeline Flow:

  CONFIG ──▶ FETCH (parallel) ──▶ DEDUP ──▶ SUMMARIZE ──▶ VELOCITY ──▶ WIKILINKS ──▶ MARKDOWN ──▶ WRITE
    │              │                                                                      │
    │         ┌────┴────┐                                                            ┌────┴────┐
    │         │ GitHub  │                                                            │ Daily   │
    │         │ YouTube │                                                            │ Weekly  │
    │         │ Reddit  │                                                            │ (Sun)   │
    │         └─────────┘                                                            └─────────┘
*/

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "./config.js";
import { fetchGitHub } from "./fetchers/github.js";
import { fetchYouTube } from "./fetchers/youtube.js";
import { fetchReddit } from "./fetchers/reddit.js";
import { summarizeItems } from "./summarizer.js";
import { computeVelocity } from "./velocity.js";
import { enrichWithWikilinks } from "./markdown/wikilinks.js";
import { generateDailyDigest } from "./markdown/daily.js";
import { generateWeeklyRollup } from "./markdown/weekly.js";
import type { DigestItem, DigestResult } from "./types.js";

async function main() {
  const startTime = Date.now();
  const config = loadConfig();
  const basePath = process.cwd();
  const today = new Date().toISOString().split("T")[0];

  console.log(`[${today}] Starting Claude Code daily digest...`);

  // Step 1: Fetch from all sources in parallel
  const sourcesOk: string[] = [];
  const sourcesFailed: string[] = [];

  const [githubItems, youtubeItems, redditItems] = await Promise.all([
    fetchGitHub(config.sources.github).then((items) => {
      if (items.length > 0 || !sourcesFailed.includes("github")) sourcesOk.push("github");
      return items;
    }).catch((err) => {
      console.error("GitHub fetch failed:", err);
      sourcesFailed.push("github");
      return [] as DigestItem[];
    }),
    fetchYouTube(config.sources.youtube).then((items) => {
      if (items.length > 0 || !sourcesFailed.includes("youtube")) sourcesOk.push("youtube");
      return items;
    }).catch((err) => {
      console.error("YouTube fetch failed:", err);
      sourcesFailed.push("youtube");
      return [] as DigestItem[];
    }),
    fetchReddit(config.sources.reddit).then((items) => {
      if (items.length > 0 || !sourcesFailed.includes("reddit")) sourcesOk.push("reddit");
      return items;
    }).catch((err) => {
      console.error("Reddit fetch failed:", err);
      sourcesFailed.push("reddit");
      return [] as DigestItem[];
    }),
  ]);

  // Step 2: Combine and deduplicate by URL
  const allItems = deduplicateByUrl([...githubItems, ...youtubeItems, ...redditItems]);
  console.log(`Fetched ${allItems.length} items (${githubItems.length} GH, ${youtubeItems.length} YT, ${redditItems.length} Reddit)`);

  // Step 3: AI Summarization + Relevance Scoring
  const summarized = await summarizeItems(allItems, config.profile, config.summarizer);
  const itemsSummarized = summarized.filter((i) => i.summary).length;
  console.log(`Summarized ${itemsSummarized}/${allItems.length} items`);

  // Step 4: Compute velocity from historical data
  const withVelocity = computeVelocity(summarized, config.velocity, basePath);
  const highSignalCount = withVelocity.filter((i) => i.isHighSignal).length;
  console.log(`Velocity computed. High-signal items: ${highSignalCount}`);

  // Step 5: Enrich with wikilinks
  const withLinks = enrichWithWikilinks(withVelocity, basePath, today);

  // Step 6: Generate daily markdown
  const runtimeSeconds = Math.round((Date.now() - startTime) / 1000);
  const result: DigestResult = {
    items: withLinks,
    sourcesOk,
    sourcesFailed,
    itemsTotal: allItems.length,
    itemsSummarized,
    highSignalCount,
    runtimeSeconds,
    date: today,
  };

  const dailyMd = generateDailyDigest(result, config.profile);
  const dailyDir = resolve(basePath, config.output.dailyFolder);
  mkdirSync(dailyDir, { recursive: true });
  const dailyPath = resolve(dailyDir, `${today}-claude-code-digest.md`);
  writeFileSync(dailyPath, dailyMd);
  console.log(`Daily digest written: ${dailyPath}`);

  // Step 7: Generate weekly rollup (Sundays only)
  const weeklyMd = await generateWeeklyRollup(basePath, config.profile, config.summarizer.model);
  if (weeklyMd) {
    const weeklyDir = resolve(basePath, config.output.weeklyFolder);
    mkdirSync(weeklyDir, { recursive: true });
    const weekNum = getWeekNumber(new Date());
    const year = new Date().getFullYear();
    const weeklyPath = resolve(weeklyDir, `${year}-W${String(weekNum).padStart(2, "0")}-weekly-rollup.md`);
    writeFileSync(weeklyPath, weeklyMd);
    console.log(`Weekly rollup written: ${weeklyPath}`);
  }

  // Log summary
  const totalRuntime = Math.round((Date.now() - startTime) / 1000);
  console.log(`Done in ${totalRuntime}s. Items: ${allItems.length}, Summarized: ${itemsSummarized}, High-signal: ${highSignalCount}`);
  console.log(`Sources OK: [${sourcesOk.join(", ")}], Failed: [${sourcesFailed.join(", ")}]`);
}

function deduplicateByUrl(items: DigestItem[]): DigestItem[] {
  const seen = new Map<string, DigestItem>();
  for (const item of items) {
    if (!seen.has(item.url)) {
      seen.set(item.url, item);
    }
  }
  return Array.from(seen.values());
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
