import type { DigestItem, DigestResult, UserProfile, SourceWeights } from "../types.js";

const DEFAULT_BUDGET = 12;
const MAX_SOURCE_SHARE = 0.6; // No single source gets more than 60% of budget

export function generateDailyDigest(
  result: DigestResult,
  profile: UserProfile,
  sourceWeights: SourceWeights
): string {
  const { items, sourcesOk, sourcesFailed, date } = result;

  const highSignal = items.filter((i) => i.isHighSignal);

  // Budget-based selection with diversity enforcement
  const { selected, dropped } = selectDigestItems(items, sourceWeights, DEFAULT_BUDGET);

  const highRelevance = selected.filter((i) => i.relevance === "High");
  const medRelevance = selected.filter((i) => i.relevance === "Medium");
  const mainItems = selected.filter((i) => i.relevance !== "High"); // non-High go into Today's Picks

  const sections: string[] = [];

  // YAML Frontmatter
  sections.push(buildFrontmatter(result));

  // Title
  sections.push(`# Claude Code Intelligence — ${date}\n`);

  // High-signal callout (only if items exist)
  if (highSignal.length > 0) {
    sections.push(buildHighSignalCallout(highSignal[0]));
  }

  // Executive summary
  sections.push(buildExecutiveSummary(selected, sourcesFailed, sourceWeights));

  // Recommended for You (High relevance items)
  sections.push(
    buildRecommendations(highRelevance, medRelevance, profile, selected, sourceWeights)
  );

  // Today's Picks (unified ranking — all sources)
  sections.push(buildTodaysPicks(mainItems, sourcesFailed, sourceWeights));

  // Digest Health footer
  sections.push(buildHealthFooter(result));

  // Filtered items transparency
  if (dropped.length > 0) {
    sections.push(buildFilteredSection(dropped));
  }

  return sections.filter(Boolean).join("\n");
}

/**
 * Computes a composite score combining relevance, source weight, engagement,
 * velocity, and novelty into a single ranking number.
 *
 * This replaces the old trendScore which only used engagement + velocity.
 */
export function compositeScore(item: DigestItem, weights: SourceWeights): number {
  // Relevance multiplier — High items rank significantly above Medium
  const relevanceMultiplier =
    item.relevance === "High" ? 3
    : item.relevance === "Medium" ? 1.5
    : item.relevance === "Low" ? 0.3
    : 1; // unscored

  // Source weight from config
  const sourceWeight = weights[item.source] ?? 1;

  // Engagement base — normalized per source so they're comparable
  let engagementBase = 0;
  if (item.source === "github") {
    engagementBase = (item.stats.stars ?? 0) / 100;
  } else if (item.source === "youtube") {
    engagementBase = (item.stats.views ?? 0) / 500;
  } else if (item.source === "reddit") {
    engagementBase = ((item.stats.score ?? 0) + (item.stats.comments ?? 0)) / 20;
  } else if (item.source === "hackernews") {
    engagementBase = ((item.stats.points ?? 0) + (item.stats.comments ?? 0)) / 30;
  }

  // Velocity bonus — items accelerating in engagement rank higher
  let velocityBonus = 0;
  if (item.velocity) {
    velocityBonus = Math.max(...Object.values(item.velocity), 0);
  }

  // Novelty multiplier — penalize stale recurring items, boost new ones
  let noveltyMultiplier = 1.0;
  if (item.isNew) {
    noveltyMultiplier = 1.2;
  } else if (item.priorAppearances && item.priorAppearances.length >= 3) {
    noveltyMultiplier = 0.6;
  } else if (item.priorAppearances && item.priorAppearances.length >= 1) {
    noveltyMultiplier = 0.85;
  }

  return relevanceMultiplier * sourceWeight * (engagementBase + velocityBonus) * noveltyMultiplier;
}

/**
 * Selects the top items for the digest with diversity enforcement.
 * No single source can take more than 60% of the budget.
 * Reserves 1 slot for a "wildcard" item from an underrepresented source.
 */
export function selectDigestItems(
  items: DigestItem[],
  weights: SourceWeights,
  budget: number = DEFAULT_BUDGET
): { selected: DigestItem[]; dropped: DigestItem[] } {
  // Score and sort all items
  const scored = items
    .filter((i) => i.relevance !== "Low")
    .map((i) => ({ item: i, score: compositeScore(i, weights) }))
    .sort((a, b) => b.score - a.score);

  const lowItems = items.filter((i) => i.relevance === "Low");
  const maxPerSource = Math.floor(budget * MAX_SOURCE_SHARE);
  const mainBudget = budget - 1; // reserve 1 slot for wildcard

  const selected: DigestItem[] = [];
  const sourceCounts: Record<string, number> = { github: 0, youtube: 0, reddit: 0, hackernews: 0 };
  const skipped: Array<{ item: DigestItem; score: number }> = [];

  // Fill main slots with diversity cap
  for (const entry of scored) {
    if (selected.length >= mainBudget) break;
    const src = entry.item.source;
    if (sourceCounts[src] >= maxPerSource) {
      skipped.push(entry);
      continue;
    }
    selected.push(entry.item);
    sourceCounts[src]++;
  }

  // Wildcard: pick the best remaining item from the least-represented source
  const dominantSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const wildcardPool = skipped
    .concat(scored.filter((e) => !selected.includes(e.item) && !skipped.includes(e)))
    .filter((e) => e.item.source !== dominantSource && (e.item.relevance === "High" || e.item.relevance === "Medium"));

  if (wildcardPool.length > 0 && selected.length < budget) {
    selected.push(wildcardPool[0].item);
  }

  // Fill any remaining budget from skipped items
  for (const entry of skipped) {
    if (selected.length >= budget) break;
    if (!selected.includes(entry.item)) {
      selected.push(entry.item);
    }
  }

  const dropped = [
    ...lowItems,
    ...scored.filter((e) => !selected.includes(e.item)).map((e) => e.item),
  ];

  return { selected, dropped };
}

function buildFrontmatter(result: DigestResult): string {
  return `---
date: ${result.date}
type: daily-digest
sources_ok:
${result.sourcesOk.map((s) => `  - ${s}`).join("\n")}
sources_failed:
${result.sourcesFailed.length > 0 ? result.sourcesFailed.map((s) => `  - ${s}`).join("\n") : "  []"}
items_total: ${result.itemsTotal}
items_summarized: ${result.itemsSummarized}
items_filtered: ${result.itemsFiltered}
high_signal_count: ${result.highSignalCount}
runtime_seconds: ${result.runtimeSeconds}
tags:
  - claude-code
  - digest
  - daily
---
`;
}

function buildHighSignalCallout(item: DigestItem): string {
  const velocityStr = formatVelocity(item);
  const installStr = item.installCommand ? `\n> \`${item.installCommand}\`` : "";
  const reasonStr = item.relevanceReason ? ` ${item.relevanceReason}` : "";

  return `> [!important] High-Signal Alert
> **${item.title}**${velocityStr ? ` — ${velocityStr}` : ""}.${reasonStr}${installStr}
`;
}

function buildExecutiveSummary(
  items: DigestItem[],
  sourcesFailed: string[],
  weights: SourceWeights
): string {
  if (items.length === 0) {
    return `## Executive Summary

No notable activity in Claude Code today. Check back tomorrow.
`;
  }

  const summaryParts: string[] = [];

  if (sourcesFailed.length > 0) {
    summaryParts.push(
      `Today's digest is partial — ${sourcesFailed.join(", ")} ${sourcesFailed.length === 1 ? "was" : "were"} unavailable.`
    );
  }

  const topItem = [...items].sort((a, b) => compositeScore(b, weights) - compositeScore(a, weights))[0];
  const sourceTag = topItem.source === "github" ? "repo" : topItem.source === "youtube" ? "video" : topItem.source === "hackernews" ? "discussion" : "discussion";
  summaryParts.push(
    `${items.length} curated items today — top ${sourceTag}: **${topItem.title}** (${formatStats(topItem)}).`
  );

  const highCount = items.filter((i) => i.relevance === "High").length;
  if (highCount > 0) {
    summaryParts.push(`${highCount} highly relevant to your current projects.`);
  }

  return `## Executive Summary

${summaryParts.join(" ")}
`;
}

function buildRecommendations(
  high: DigestItem[],
  medium: DigestItem[],
  profile: UserProfile,
  allItems: DigestItem[],
  weights: SourceWeights
): string {
  if (high.length === 0 && medium.length === 0) {
    if (allItems.every((i) => !i.relevance)) {
      return `## Recommended for You

> [!tip] AI summaries unavailable
> Recommendations will appear here when the Claude API is connected. For now, browse the sections below.
`;
    }

    return `## Recommended for You

> [!tip] Nothing matched your profile today
> No items scored High or Medium relevance for your interests (${profile.interests.slice(0, 3).join(", ")}). Browse the trending sections below — you might find something unexpected.
`;
  }

  // Sort recommendations by composite score
  const sortedHigh = [...high].sort((a, b) => compositeScore(b, weights) - compositeScore(a, weights));
  const sortedMed = [...medium].sort((a, b) => compositeScore(b, weights) - compositeScore(a, weights));

  const parts: string[] = [
    `## Recommended for You`,
    "",
    `*Based on your profile: ${profile.goals.slice(0, 2).join(", ")}, ${profile.skillLevel}, focused on ${profile.interests.slice(0, 3).join(" and ")}.*`,
    "",
  ];

  if (sortedHigh.length > 0) {
    parts.push("### High Relevance", "");
    for (const item of sortedHigh) {
      parts.push(formatDigestItem(item));
    }
  }

  if (sortedMed.length > 0) {
    parts.push("### Medium Relevance", "");
    for (const item of sortedMed) {
      parts.push(formatDigestItem(item));
    }
  }

  return parts.join("\n") + "\n";
}

function buildTodaysPicks(
  items: DigestItem[],
  sourcesFailed: string[],
  weights: SourceWeights
): string {
  const allFailed = sourcesFailed.includes("github") && sourcesFailed.includes("youtube") && sourcesFailed.includes("reddit") && sourcesFailed.includes("hackernews");

  if (allFailed) {
    return `## Today's Picks

> [!warning] All sources were unavailable
> This section will return tomorrow.
`;
  }

  const warnings: string[] = [];
  for (const src of sourcesFailed) {
    const label = src === "github" ? "GitHub" : src === "youtube" ? "YouTube" : src === "hackernews" ? "Hacker News" : "Reddit";
    warnings.push(`> [!warning] ${label} was unavailable\n`);
  }

  if (items.length === 0) {
    return `## Today's Picks

${warnings.join("\n")}No items made the cut today. All curated content is in the Recommended section above.
`;
  }

  // Sort by composite score
  const sorted = [...items].sort((a, b) => compositeScore(b, weights) - compositeScore(a, weights));

  const lines = [`## Today's Picks`, ""];
  if (warnings.length > 0) {
    lines.push(...warnings);
  }

  // Group by cluster if items have clusters
  const hasClusters = sorted.some((i) => i.cluster);
  if (hasClusters) {
    const clusters = new Map<string, DigestItem[]>();
    for (const item of sorted) {
      const key = item.cluster || "Other";
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(item);
    }
    for (const [clusterName, clusterItems] of clusters) {
      lines.push(`### ${clusterName}`, "");
      for (const item of clusterItems) {
        lines.push(formatDigestItem(item));
      }
    }
  } else {
    for (const item of sorted) {
      lines.push(formatDigestItem(item));
    }
  }
  return lines.join("\n") + "\n";
}

function formatDigestItem(item: DigestItem): string {
  const lines: string[] = [];

  // Content-type badge (prefer contentType, fall back to source)
  const badge = item.contentType
    ?? (item.source === "github" ? "tool" : item.source === "youtube" ? "video" : item.source === "hackernews" ? "discussion" : "discussion");

  // Lead with hookLine if available, otherwise summary
  const lead = item.hookLine || item.summary || item.description?.slice(0, 150) || "No description available.";
  lines.push(`- **${item.title}** \`${badge}\` — ${lead}`);

  // Show summary as detail if hookLine was used as lead
  if (item.hookLine && item.summary) {
    lines.push(`  ${item.summary}`);
  }

  // Relevance reason
  if (item.relevanceReason) {
    lines.push(`  Relevance: *${item.relevanceReason}*`);
  }

  // Stats + velocity + install command
  const metaParts: string[] = [];
  metaParts.push(formatStats(item));

  const velocityStr = formatVelocity(item);
  if (velocityStr) metaParts.push(velocityStr);

  if (item.installCommand) {
    metaParts.push(`\`${item.installCommand}\``);
  }

  lines.push(`  ${metaParts.join(" | ")} | [Link](${item.url})`);

  // Wikilinks
  if (item.priorAppearances && item.priorAppearances.length > 0) {
    const links = item.priorAppearances
      .slice(-3)
      .map((d) => `[[${d}-claude-code-digest|${d}]]`)
      .join(", ");
    lines.push(`  Also seen: ${links}`);
  }

  lines.push("");
  return lines.join("\n");
}

function formatStats(item: DigestItem): string {
  switch (item.source) {
    case "github":
      return `Stars: ${item.stats.stars?.toLocaleString() ?? "?"}`;
    case "youtube":
      return `${item.stats.views?.toLocaleString() ?? "?"} views`;
    case "reddit":
      return `${item.stats.score ?? "?"} upvotes, ${item.stats.comments ?? "?"} comments`;
    case "hackernews":
      return `${item.stats.points ?? "?"} pts, ${item.stats.comments ?? "?"} comments`;
    default:
      return "";
  }
}

function formatVelocity(item: DigestItem): string {
  if (item.isNew) return "NEW";
  if (!item.velocity) return "";

  const parts: string[] = [];
  for (const [key, delta] of Object.entries(item.velocity)) {
    if (delta > 0) {
      parts.push(`+${delta}/${key === "stars" || key === "score" ? "day" : key}`);
    }
  }
  return parts.join(", ");
}

function buildHealthFooter(result: DigestResult): string {
  const sourceStatus = ["github", "youtube", "reddit", "hackernews"]
    .map((s) => {
      const ok = result.sourcesOk.includes(s);
      const label = s === "github" ? "GitHub" : s === "youtube" ? "YouTube" : s === "hackernews" ? "HN" : "Reddit";
      return `${label} ${ok ? "✓" : "✗"}`;
    })
    .join(" ");

  const filteredStr = result.itemsFiltered > 0 ? ` | Filtered: ${result.itemsFiltered}` : "";

  return `---

> [!info] Digest Health
> Sources: ${sourceStatus} | Items: ${result.itemsTotal} | Summarized: ${result.itemsSummarized}${filteredStr} | Runtime: ${result.runtimeSeconds}s
`;
}

function buildFilteredSection(dropped: DigestItem[]): string {
  if (dropped.length === 0) return "";

  const lines = dropped.slice(0, 10).map((item) => {
    const reason = item.relevance === "Low" ? "Low relevance" : "Below budget cutoff";
    const badge = item.source === "github" ? "repo" : item.source === "youtube" ? "video" : item.source === "hackernews" ? "discussion" : "discussion";
    return `- **${item.title}** \`${badge}\` — ${reason}`;
  });

  const extra = dropped.length > 10 ? `\n- ...and ${dropped.length - 10} more` : "";

  return `<details>
<summary>Also considered (${dropped.length} items)</summary>

${lines.join("\n")}${extra}
</details>
`;
}
