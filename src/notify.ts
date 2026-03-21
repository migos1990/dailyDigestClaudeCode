import type { DigestConfig, DigestResult } from "./types.js";
import { compositeScore } from "./markdown/daily.js";
import type { SourceWeights } from "./types.js";

export async function sendNotifications(
  result: DigestResult,
  config: DigestConfig,
  dailyPath: string
): Promise<void> {
  const webhookUrl =
    config.notifications?.discord?.webhookUrl ||
    process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    return; // No notifications configured — skip silently
  }

  try {
    await sendDiscordNotification(webhookUrl, result, config);
  } catch (err) {
    console.warn("[notify] Discord notification failed:", (err as Error).message);
  }
}

async function sendDiscordNotification(
  webhookUrl: string,
  result: DigestResult,
  config: DigestConfig
): Promise<void> {
  const sourceWeights: SourceWeights = {
    github: config.sources.github.weight,
    youtube: config.sources.youtube.weight,
    reddit: config.sources.reddit.weight,
    hackernews: config.sources.hackernews.weight,
  };

  // Get top 3 items by composite score
  const topItems = [...result.items]
    .filter((i) => i.relevance === "High" || i.relevance === "Medium")
    .sort((a, b) => compositeScore(b, sourceWeights) - compositeScore(a, sourceWeights))
    .slice(0, 3);

  const sourceBadge = (source: string) => {
    switch (source) {
      case "github": return "GH";
      case "youtube": return "YT";
      case "reddit": return "Reddit";
      case "hackernews": return "HN";
      default: return source;
    }
  };

  const fields = topItems.map((item, i) => ({
    name: `${i + 1}. ${item.title}`,
    value: [
      item.hookLine || item.summary?.slice(0, 100) || "No summary",
      `\`${sourceBadge(item.source)}\` | [Link](${item.url})`,
    ].join("\n"),
    inline: false,
  }));

  const embed = {
    title: `Claude Code Digest — ${result.date}`,
    description: [
      `**${result.items.length}** items from ${result.sourcesOk.length} sources`,
      result.highSignalCount > 0 ? ` | **${result.highSignalCount}** high-signal` : "",
    ].join(""),
    color: 0x7c3aed, // Purple
    fields,
    footer: {
      text: [
        `Sources: ${result.sourcesOk.join(", ")}`,
        result.sourcesFailed.length > 0 ? ` | Failed: ${result.sourcesFailed.join(", ")}` : "",
        ` | ${result.runtimeSeconds}s`,
      ].join(""),
    },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    embeds: [embed],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook returned HTTP ${response.status}`);
  }

  console.log("[notify] Discord notification sent successfully");
}
