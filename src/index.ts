/*
  DAILY DIGEST ORCHESTRATOR — Pipeline Flow:

  CONFIG ──▶ FETCH (parallel) ──▶ DEDUP ──▶ SUMMARIZE ──▶ CLUSTER ──▶ VELOCITY ──▶ WIKILINKS ──▶ MARKDOWN ──▶ NOTIFY ──▶ WRITE
    │              │                                                                      │
    │         ┌────┴────────┐                                                        ┌────┴────┐
    │         │ GitHub      │                                                        │ Daily   │
    │         │ YouTube     │                                                        │ Weekly  │
    │         │ Reddit      │                                                        │ (Sun)   │
    │         │ Hacker News │                                                        └─────────┘
    │         └─────────────┘
*/

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "./config.js";
import { fetchGitHub } from "./fetchers/github.js";
import { fetchYouTube } from "./fetchers/youtube.js";
import { fetchReddit } from "./fetchers/reddit.js";
import { fetchHackerNews } from "./fetchers/hackernews.js";
import { summarizeItems } from "./summarizer.js";
import { clusterItems } from "./clustering.js";
import { computeVelocity } from "./velocity.js";
import { enrichWithWikilinks } from "./markdown/wikilinks.js";
import { generateDailyDigest } from "./markdown/daily.js";
import { generateWeeklyRollup } from "./markdown/weekly.js";
import { sendNotifications } from "./notify.js";
import { getWeekNumber } from "./utils.js";
import type { DigestItem, DigestConfig, DigestResult, SourceWeights } from "./types.js";

async function main() {
  const startTime = Date.now();
  const config = loadConfig();
  const basePath = process.cwd();
  const today = new Date().toISOString().split("T")[0];

  console.log(`[${today}] Starting Claude Code daily digest...`);

  // Step 1: Fetch from all sources in parallel
  const results = await Promise.allSettled([
    fetchGitHub(config.sources.github),
    fetchYouTube(config.sources.youtube),
    fetchReddit(config.sources.reddit),
    fetchHackerNews(config.sources.hackernews),
  ]);

  const sourceNames = ["github", "youtube", "reddit", "hackernews"] as const;
  const sourcesOk: string[] = [];
  const sourcesFailed: string[] = [];
  const fetched: DigestItem[][] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      sourcesOk.push(sourceNames[i]);
      fetched.push(result.value);
    } else {
      console.error(`${sourceNames[i]} fetch failed:`, result.reason);
      sourcesFailed.push(sourceNames[i]);
      fetched.push([]);
    }
  }

  const [githubItems, youtubeItems, redditItems, hackernewsItems] = fetched;

  // Step 2: Combine and deduplicate by URL
  const allItems = deduplicateByUrl([...githubItems, ...youtubeItems, ...redditItems, ...hackernewsItems]);
  console.log(`Fetched ${allItems.length} items (${githubItems.length} GH, ${youtubeItems.length} YT, ${redditItems.length} Reddit, ${hackernewsItems.length} HN)`);

  if (allItems.length === 0) {
    console.warn("No items fetched from any source — skipping digest generation.");
    return;
  }

  // Step 2.5: Quality filter — remove items below engagement thresholds
  const qualityItems = filterByQuality(allItems, config.sources);
  const itemsFiltered = allItems.length - qualityItems.length;
  if (itemsFiltered > 0) {
    console.log(`Quality filter: kept ${qualityItems.length}/${allItems.length} items (removed ${itemsFiltered})`);
  }

  if (qualityItems.length === 0) {
    console.warn("All items filtered by quality thresholds — skipping digest generation.");
    return;
  }

  // Step 3: AI Summarization + Relevance Scoring
  const summarized = await summarizeItems(qualityItems, config.profile, config.summarizer);
  const itemsSummarized = summarized.filter((i) => i.summary).length;
  console.log(`Summarized ${itemsSummarized}/${qualityItems.length} items`);

  // Step 3.5: Topic clustering
  const clustered = await clusterItems(summarized, config);

  // Step 4: Compute velocity from historical data
  const withVelocity = computeVelocity(clustered, config.velocity, basePath);
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
    itemsTotal: qualityItems.length,
    itemsSummarized,
    itemsFiltered,
    highSignalCount,
    runtimeSeconds,
    date: today,
  };

  const sourceWeights: SourceWeights = {
    github: config.sources.github.weight,
    youtube: config.sources.youtube.weight,
    reddit: config.sources.reddit.weight,
    hackernews: config.sources.hackernews.weight,
  };
  const dailyMd = generateDailyDigest(result, config.profile, sourceWeights);
  const dailyDir = resolve(basePath, config.output.dailyFolder);
  mkdirSync(dailyDir, { recursive: true });
  const dailyPath = resolve(dailyDir, `${today}-claude-code-digest.md`);
  writeFileSync(dailyPath, dailyMd);
  console.log(`Daily digest written: ${dailyPath}`);

  // Step 6.5: Send notifications (best-effort, after file is persisted)
  await sendNotifications(result, config, dailyPath);

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

function filterByQuality(items: DigestItem[], sources: DigestConfig["sources"]): DigestItem[] {
  return items.filter(item => {
    switch (item.source) {
      case "github":
        return (item.stats.stars ?? 0) >= (sources.github.minStars ?? 0);
      case "youtube":
        return (item.stats.views ?? 0) >= (sources.youtube.minViews ?? 0);
      case "reddit":
        return (item.stats.score ?? 0) >= (sources.reddit.minScore ?? 0);
      case "hackernews":
        return (item.stats.points ?? 0) >= (sources.hackernews.minPoints ?? 0);
      default:
        return true;
    }
  });
}

export function deduplicateByUrl(items: DigestItem[]): DigestItem[] {
  const seen = new Map<string, DigestItem>();
  for (const item of items) {
    if (!seen.has(item.url)) {
      seen.set(item.url, item);
    }
  }
  return Array.from(seen.values());
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
