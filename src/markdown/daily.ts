import type { DigestItem, DigestResult, UserProfile } from "../types.js";

export function generateDailyDigest(result: DigestResult, profile: UserProfile): string {
  const { items, sourcesOk, sourcesFailed, date } = result;

  const github = items.filter((i) => i.source === "github");
  const youtube = items.filter((i) => i.source === "youtube");
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

  // Trending GitHub Skills
  sections.push(buildSourceSection("Trending GitHub Skills", github, "github", sourcesFailed));

  // YouTube Highlights
  sections.push(buildSourceSection("YouTube Highlights", youtube, "youtube", sourcesFailed));

  // Community Pulse
  sections.push(buildSourceSection("Community Pulse", reddit, "reddit", sourcesFailed));

  // Digest Health footer
  sections.push(buildHealthFooter(result));

  return sections.filter(Boolean).join("\n");
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

  // Use AI summary if available on first item, otherwise generate from data
  const summaryParts: string[] = [];

  if (sourcesFailed.length > 0) {
    summaryParts.push(
      `Today's digest is partial — ${sourcesFailed.join(", ")} ${sourcesFailed.length === 1 ? "was" : "were"} unavailable.`
    );
  }

  // Build summary from available items
  const github = items.filter((i) => i.source === "github");
  const youtube = items.filter((i) => i.source === "youtube");
  const reddit = items.filter((i) => i.source === "reddit");

  if (github.length > 0) {
    const top = github[0];
    summaryParts.push(
      `${github.length} GitHub ${github.length === 1 ? "skill" : "skills"} trending — top: **${top.title}** (${formatStats(top)}).`
    );
  }
  if (youtube.length > 0) {
    summaryParts.push(
      `${youtube.length} new ${youtube.length === 1 ? "video" : "videos"} on YouTube.`
    );
  }
  if (reddit.length > 0) {
    summaryParts.push(
      `${reddit.length} ${reddit.length === 1 ? "discussion" : "discussions"} trending on Reddit.`
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
    // If no relevance scoring, show top items by source weight
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

  const parts: string[] = [
    `## Recommended for You`,
    "",
    `*Based on your profile: ${profile.goals.slice(0, 2).join(", ")}, ${profile.skillLevel}, focused on ${profile.interests.slice(0, 3).join(" and ")}.*`,
    "",
  ];

  if (high.length > 0) {
    parts.push("### High Relevance", "");
    for (const item of high) {
      parts.push(formatDigestItem(item));
    }
  }

  if (medium.length > 0) {
    parts.push("### Medium Relevance", "");
    for (const item of medium) {
      parts.push(formatDigestItem(item));
    }
  }

  return parts.join("\n") + "\n";
}

function buildSourceSection(
  title: string,
  items: DigestItem[],
  source: string,
  sourcesFailed: string[]
): string {
  if (sourcesFailed.includes(source)) {
    const sourceLabel =
      source === "github" ? "GitHub" : source === "youtube" ? "YouTube" : "Reddit";
    return `## ${title}

> [!warning] ${sourceLabel} was unavailable
> This section will return tomorrow. The rest of the digest is unaffected.
`;
  }

  if (items.length === 0) {
    const emptyMsg =
      source === "github"
        ? "No new Claude Code skills trending today."
        : source === "youtube"
          ? "No new Claude Code videos found today."
          : "No Claude Code discussions trending today.";
    return `## ${title}

${emptyMsg}
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

  // Title + summary
  const summary = item.summary || item.description?.slice(0, 150) || "No description available.";
  lines.push(`- **${item.title}** — ${summary}`);

  // Stats + velocity + install command
  const metaParts: string[] = [];
  metaParts.push(formatStats(item));

  const velocityStr = formatVelocity(item);
  if (velocityStr) metaParts.push(velocityStr);

  if (item.installCommand) {
    metaParts.push(`\`${item.installCommand}\``);
  }

  // Relevance reason
  if (item.relevanceReason) {
    lines.push(`  Relevance: *${item.relevanceReason}*`);
  }

  lines.push(`  ${metaParts.join(" | ")} | [Link](${item.url})`);

  // Wikilinks
  if (item.priorAppearances && item.priorAppearances.length > 0) {
    const links = item.priorAppearances
      .slice(-3) // Show last 3 appearances max
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
