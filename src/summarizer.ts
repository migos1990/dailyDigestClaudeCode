import Anthropic from "@anthropic-ai/sdk";
import type { DigestItem, UserProfile, SummarizerResponse } from "./types.js";

export async function summarizeItems(
  items: DigestItem[],
  profile: UserProfile,
  config: { model: string; batchSize: number }
): Promise<DigestItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set — skipping AI summaries");
    return items;
  }

  if (items.length === 0) return items;

  const client = new Anthropic({ apiKey });
  const enriched = [...items];

  // Build id → index map for O(1) lookups
  const idToIndex = new Map<string, number>();
  for (let j = 0; j < enriched.length; j++) {
    idToIndex.set(enriched[j].id, j);
  }

  // Process in batches
  for (let i = 0; i < items.length; i += config.batchSize) {
    const batch = items.slice(i, i + config.batchSize);
    try {
      const responses = await summarizeBatch(client, batch, profile, config.model);
      for (const resp of responses) {
        if (!isValidSummarizerResponse(resp)) {
          continue;
        }
        const idx = idToIndex.get(resp.id);
        if (idx !== undefined) {
          enriched[idx] = {
            ...enriched[idx],
            summary: resp.summary,
            relevance: resp.relevance,
            relevanceReason: resp.relevanceReason,
            installCommand: resp.installCommand ?? enriched[idx].installCommand,
          };
        }
      }
    } catch (err) {
      console.warn(`Summarizer batch failed (items ${i}-${i + batch.length}):`, (err as Error).message);
      // Items in this batch keep their raw titles — graceful degradation
    }
  }

  return enriched;
}

async function summarizeBatch(
  client: Anthropic,
  items: DigestItem[],
  profile: UserProfile,
  model: string
): Promise<SummarizerResponse[]> {
  const itemDescriptions = items
    .map(
      (item, idx) =>
        `${idx + 1}. [${item.source.toUpperCase()}] "${item.title}" — ${item.description?.slice(0, 200) || "No description"} | URL: ${item.url} | Stats: ${JSON.stringify(item.stats)}`
    )
    .join("\n");

  const prompt = `You are a Claude Code ecosystem analyst writing a daily intelligence briefing.

User Profile:
- Name: ${profile.name}
- Goals: ${profile.goals.join(", ")}
- Skill Level: ${profile.skillLevel}
- Interests: ${profile.interests.join(", ")}
- Current Projects: ${profile.currentProjects.join(", ")}

Analyze these ${items.length} trending items. For each, provide:
1. A 2-sentence summary: what it IS and why it MATTERS. Be specific — name the capability, not "useful tool for developers."
2. Relevance to this user: High, Medium, or Low
3. A one-line reason WHY it's relevant, referencing the user's specific goals/interests
4. An install command if it's a GitHub repo (git clone URL), otherwise null

Write like a newsletter editor, not a content generator. No "In today's digest..." or "Here are the highlights..." — lead with specifics.

Items:
${itemDescriptions}

Respond with ONLY a JSON array (no markdown fencing):
[{"id": "${items[0]?.id}", "summary": "...", "relevance": "High|Medium|Low", "relevanceReason": "...", "installCommand": "..." or null}]

Use the exact id values from each item. Respond with valid JSON only.`;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse JSON — handle potential markdown fencing
  const cleaned = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      console.warn("Summarizer response is not an array");
      return [];
    }
    return parsed as SummarizerResponse[];
  } catch (parseErr) {
    console.warn("Failed to parse summarizer response as JSON:", cleaned.slice(0, 200));
    return [];
  }
}

const VALID_RELEVANCE = new Set(["High", "Medium", "Low"]);

function isValidSummarizerResponse(resp: unknown): resp is SummarizerResponse {
  if (!resp || typeof resp !== "object") return false;
  const r = resp as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.summary === "string" &&
    typeof r.relevance === "string" &&
    VALID_RELEVANCE.has(r.relevance)
  );
}
