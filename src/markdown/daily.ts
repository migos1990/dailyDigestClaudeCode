import type { DigestItem, DigestResult, UserProfile } from "../types.js";

export function generateDailyDigest(result: DigestResult, profile: UserProfile): string {
  const { items, sourcesOk, sourcesFailed, date } = result;

  const trending = items
    .filter((i) => i.source === "github" || i.source === "youtube")
    .sort((a, b) => trendScore(b) - trendScore(a));
  const reddit = items.filter((i) => i.source === "reddit");
  const highSignal = items.filter((i) => i.isHighSignal);
  const highRelevance = items.filter((i) => i.relevance === "High");
  const medRelevance = items.filter((i) => i.relevance === "Medium");

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
  sections.push(buildExecutiveSummary(items, sourcesFailed));

  // Recommended for You
  sections.push(
    buildRecommendations(highRelevance, medRelevance, profile, items)
  );

  // Unified Trending section (GitHub + YouTube sorted by trend score)
  sections.push(buildTrendingSection(trending, sourcesFailed));

  // Community Pulse (Reddit)
  sections.push(buildSourceSection("Community Pulse", reddit, "reddit", sourcesFailed));

  // Digest Health footer
  sections.push(buildHealthFooter(result));

  return sections.filter(Boolean).join("\n");
}

/**
 * Computes a unified trend score across sources so GitHub repos
 * and YouTube videos can be ranked together.
 *
 * GitHub:  stars / 100  (so 10K stars ≈ 100 points)
 * YouTube: views / 500  (so 50K views ≈ 100 points)
 * Velocity bonus: 2x multiplier for items with velocity data
 */
export function trendScore(item: DigestItem): number {
  let base = 0;
  if (item.source === "github") {
    base = (item.stats.stars ?? 0) / 100;
  } else if (item.source === "youtube") {
    base = (item.stats.views ?? 0) / 500;
  }

  // Velocity bonus: items that are accelerating rank higher
  if (item.velocity) {
    const maxVelocity = Math.max(...Object.values(item.velocity), 0);
    base += maxVelocity;
  }

  // New items get a small boost so they don't get buried
  if (item.isNew) {
    base *= 1.2;
  }

  return base;
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

function buildExecutiveSummary(items: DigestItem[], sourcesFailed: string[]): string {
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

  const github = items.filter((i) => i.source === "github");
  const youtube = items.filter((i) => i.source === "youtube");
  const reddit = items.filter((i) => i.source === "reddit");

  const trendingCount = github.length + youtube.length;
  if (trendingCount > 0) {
    const topItem = [...github, ...youtube].sort((a, b) => trendScore(b) - trendScore(a))[0];
    const sourceTag = topItem.source === "github" ? "repo" : "video";
    summaryParts.push(
      `${trendingCount} trending items today — top ${sourceTag}: **${topItem.title}** (${formatStats(topItem)}).`
    );
  }
  if (reddit.length > 0) {
    summaryParts.push(
      `${reddit.length} ${reddit.length === 1 ? "discussion" : "discussions"} on Reddit.`
    );
  }

  return `## Executive Summary

${summaryParts.join(" ")}
`;
}

function buildRecommendations(
  high: DigestItem[],
  medium: DigestItem[],
  profile: UserProfile,
  allItems: DigestItem[]
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

  // Sort recommendations by trend score too
  const sortedHigh = [...high].sort((a, b) => trendScore(b) - trendScore(a));
  const sortedMed = [...medium].sort((a, b) => trendScore(b) - trendScore(a));

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

function buildTrendingSection(
  items: DigestItem[],
  sourcesFailed: string[]
): string {
  const githubFailed = sourcesFailed.includes("github");
  const youtubeFailed = sourcesFailed.includes("youtube");

  if (githubFailed && youtubeFailed) {
    return `## Trending Now

> [!warning] GitHub and YouTube were unavailable
> This section will return tomorrow. The rest of the digest is unaffected.
`;
  }

  const warnings: string[] = [];
  if (githubFailed) warnings.push("> [!warning] GitHub was unavailable — showing YouTube only\n");
  if (youtubeFailed) warnings.push("> [!warning] YouTube was unavailable — showing GitHub only\n");

  if (items.length === 0) {
    return `## Trending Now

${warnings.join("\n")}No trending Claude Code repos or videos found today.
`;
  }

  const lines = [`## Trending Now`, ""];
  if (warnings.length > 0) {
    lines.push(...warnings);
  }

  for (const item of items) {
    lines.push(formatDigestItem(item));
  }
  return lines.join("\n") + "\n";
}

function buildSourceSection(
  title: string,
  items: DigestItem[],
  source: string,
  sourcesFailed: string[]
): string {
  if (sourcesFailed.includes(source)) {
    const sourceLabel = "Reddit";
    return `## ${title}

> [!warning] ${sourceLabel} was unavailable
> This section will return tomorrow. The rest of the digest is unaffected.
`;
  }

  if (items.length === 0) {
    return `## ${title}

No Claude Code discussions trending today.
`;
  }

  const lines = [`## ${title}`, ""];
  for (const item of items) {
    lines.push(formatDigestItem(item));
  }
  return lines.join("\n") + "\n";
}

function formatDigestItem(item: DigestItem): string {
  const lines: string[] = [];

  // Source badge + title + summary
  const badge = item.source === "github" ? "repo" : item.source === "youtube" ? "video" : "discussion";
  const summary = item.summary || item.description?.slice(0, 150) || "No description available.";
  lines.push(`- **${item.title}** \`${badge}\` — ${summary}`);

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
  const sourceStatus = ["github", "youtube", "reddit"]
    .map((s) => {
      const ok = result.sourcesOk.includes(s);
      const label = s === "github" ? "GitHub" : s === "youtube" ? "YouTube" : "Reddit";
      return `${label} ${ok ? "✓" : "✗"}`;
    })
    .join(" ");

  return `---

> [!info] Digest Health
> Sources: ${sourceStatus} | Items: ${result.itemsTotal} | Summarized: ${result.itemsSummarized} | Runtime: ${result.runtimeSeconds}s
`;
}
