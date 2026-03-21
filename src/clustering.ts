import Anthropic from "@anthropic-ai/sdk";
import type { DigestItem, DigestConfig } from "./types.js";

interface ClusterAssignment {
  cluster: string;
  itemIds: string[];
}

export async function clusterItems(
  items: DigestItem[],
  config: DigestConfig
): Promise<DigestItem[]> {
  const clusterConfig = config.clustering;
  if (!clusterConfig?.enabled) {
    return items;
  }

  const minItems = clusterConfig.minItems ?? 6;
  const itemsWithSummaries = items.filter((i) => i.summary);

  if (itemsWithSummaries.length < minItems) {
    console.log(`[clustering] Skipping — only ${itemsWithSummaries.length} summarized items (need ${minItems})`);
    return items;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[clustering] ANTHROPIC_API_KEY not set — skipping clustering");
    return items;
  }

  const client = new Anthropic({ apiKey });

  const itemList = items
    .map((i) => `- [${i.id}] "${i.title}" — ${i.summary || i.description?.slice(0, 100) || "No description"}`)
    .join("\n");

  const prompt = `You are organizing a daily intelligence digest about Claude Code and AI development tools. Group these items into 2-4 thematic clusters.

Each cluster should have a short, specific name (2-4 words, e.g., "MCP Server Ecosystem", "Workflow Automation", "Community Discussion"). Every item must belong to exactly one cluster. If an item doesn't fit well, put it in the most relevant cluster.

Items:
${itemList}

Respond with ONLY a JSON array (no markdown fencing):
[{"cluster": "Cluster Name", "itemIds": ["id1", "id2"]}]`;

  try {
    const response = await client.messages.create({
      model: config.summarizer.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    const assignments = JSON.parse(cleaned) as ClusterAssignment[];

    if (!Array.isArray(assignments)) {
      console.warn("[clustering] Response is not an array — skipping");
      return items;
    }

    // Build id → cluster mapping
    const idToCluster = new Map<string, string>();
    for (const assignment of assignments) {
      if (assignment.cluster && Array.isArray(assignment.itemIds)) {
        for (const id of assignment.itemIds) {
          idToCluster.set(id, assignment.cluster);
        }
      }
    }

    // Assign clusters to items
    const clustered = items.map((item) => {
      const cluster = idToCluster.get(item.id);
      return cluster ? { ...item, cluster } : item;
    });

    const assignedCount = clustered.filter((i) => i.cluster).length;
    console.log(`[clustering] Assigned ${assignedCount}/${items.length} items to ${assignments.length} clusters`);

    return clustered;
  } catch (err) {
    console.warn("[clustering] Failed:", (err as Error).message);
    return items;
  }
}
