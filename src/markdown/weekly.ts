import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { UserProfile } from "../types.js";
import { getWeekNumber } from "../utils.js";

interface WeeklyItem {
  title: string;
  source: string;
  url: string;
  summary?: string;
  stats: Record<string, number>;
  relevance?: string;
  date: string;
}

export async function generateWeeklyRollup(
  basePath: string,
  profile: UserProfile,
  model: string
): Promise<string | null> {
  const today = new Date();
  if (today.getDay() !== 0) {
    // Not Sunday — skip weekly generation
    return null;
  }

  const dailyFolder = resolve(basePath, "Daily");
  const weekNumber = getWeekNumber(today);
  const year = today.getFullYear();
  const dateStr = today.toISOString().split("T")[0];

  // Read past 7 daily digests
  const dailyFiles = readDailyFiles(dailyFolder, 7);

  if (dailyFiles.length === 0) {
    return buildMinimalWeekly(year, weekNumber, dateStr);
  }

  // Extract items from daily files (parse markdown)
  const weekItems = extractItemsFromDailies(dailyFiles);

  // Generate narrative with Claude
  const narrative = await generateNarrative(weekItems, profile, model);

  return buildWeeklyMarkdown(year, weekNumber, dateStr, dailyFiles.length, weekItems, narrative);
}

function readDailyFiles(folder: string, days: number): { date: string; content: string }[] {
  try {
    const files = readdirSync(folder)
      .filter((f) => f.endsWith("-claude-code-digest.md"))
      .sort()
      .reverse()
      .slice(0, days);

    return files.map((f) => ({
      date: f.replace("-claude-code-digest.md", ""),
      content: readFileSync(resolve(folder, f), "utf-8"),
    }));
  } catch {
    return [];
  }
}

function extractItemsFromDailies(files: { date: string; content: string }[]): WeeklyItem[] {
  const items: WeeklyItem[] = [];

  for (const file of files) {
    // Extract list items with bold titles
    const itemRegex = /^- \*\*(.+?)\*\* — (.+?)$/gm;
    let match;
    while ((match = itemRegex.exec(file.content)) !== null) {
      items.push({
        title: match[1],
        source: "unknown",
        url: "",
        summary: match[2].slice(0, 200),
        stats: {},
        date: file.date,
      });
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  });
}

async function generateNarrative(
  items: WeeklyItem[],
  profile: UserProfile,
  model: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return generateFallbackNarrative(items);
  }

  const client = new Anthropic({ apiKey });

  const itemList = items
    .slice(0, 30)
    .map((i) => `- "${i.title}" (${i.date}): ${i.summary || "No summary"}`)
    .join("\n");

  const prompt = `You are writing a weekly newsletter called "This Week in Claude Code." Your reader is ${profile.name}, who is ${profile.skillLevel} level and focused on ${profile.interests.slice(0, 3).join(", ")}.

Here are the items that appeared in this week's daily digests:
${itemList}

Write a newsletter with these sections. Write like a thoughtful human editor, not an AI. Be specific. Use real item names.

## The Big Picture
One paragraph: what was the overarching theme or most important development this week?

## Themes This Week
If the items naturally cluster into 2-3 themes, give each theme a short heading (### level) with 1-2 sentences explaining the theme and naming key items. If no clear themes emerge, skip this section.

## Top 5 of the Week
Numbered list of the 5 most notable items with a one-sentence description each.

## Trends to Watch
One paragraph: what patterns are emerging? What should the reader keep an eye on next week?

## What This Means for You
One paragraph personalized to the reader's profile: what should they pay attention to or try?

Respond with the markdown sections only (starting with ## The Big Picture). No preamble.`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return text.trim();
  } catch (err) {
    console.warn("Weekly narrative generation failed:", (err as Error).message);
    return generateFallbackNarrative(items);
  }
}

function generateFallbackNarrative(items: WeeklyItem[]): string {
  const top5 = items.slice(0, 5);
  const topList = top5
    .map((item, i) => `${i + 1}. **${item.title}** — ${item.summary?.slice(0, 100) || "No summary"}`)
    .join("\n");

  return `## The Big Picture

This week saw ${items.length} notable items across the Claude Code ecosystem.

## Top 5 of the Week

${topList || "No items this week."}

## Trends to Watch

*AI narrative unavailable — connect the Anthropic API for personalized weekly analysis.*

## What This Means for You

*Personalized recommendations unavailable — check your ANTHROPIC_API_KEY.*`;
}

function buildWeeklyMarkdown(
  year: number,
  week: number,
  date: string,
  daysCovered: number,
  items: WeeklyItem[],
  narrative: string
): string {
  return `---
date: ${date}
type: weekly-rollup
week: ${year}-W${String(week).padStart(2, "0")}
days_covered: ${daysCovered}
total_items_this_week: ${items.length}
tags:
  - claude-code
  - digest
  - weekly
---

# This Week in Claude Code — Week ${week}, ${year}

${narrative}

---

> [!info] Weekly Stats
> Days: ${daysCovered} | Total items: ${items.length} | Generated: ${date}
`;
}

function buildMinimalWeekly(year: number, week: number, date: string): string {
  return `---
date: ${date}
type: weekly-rollup
week: ${year}-W${String(week).padStart(2, "0")}
days_covered: 0
total_items_this_week: 0
tags:
  - claude-code
  - digest
  - weekly
---

# This Week in Claude Code — Week ${week}, ${year}

No daily digests were generated this week. Check that the GitHub Action is running correctly.

---

> [!info] Weekly Stats
> Days: 0 | Total items: 0 | Generated: ${date}
`;
}

