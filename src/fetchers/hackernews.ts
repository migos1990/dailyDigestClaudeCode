import type { DigestItem, HackerNewsSourceConfig } from "../types.js";
import { delay } from "../utils.js";

const POLITE_DELAY_MS = 500;

interface HNHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at_i: number;
  story_text: string | null;
}

interface HNSearchResponse {
  hits: HNHit[];
}

export async function fetchHackerNews(config: HackerNewsSourceConfig): Promise<DigestItem[]> {
  const seen = new Set<string>();
  const allHits: HNHit[] = [];
  const searchWindow = config.searchWindow ?? 72;
  const timestamp = Math.floor((Date.now() - searchWindow * 3600000) / 1000);
  const minPoints = config.minPoints ?? 0;

  try {
    let isFirst = true;
    for (const term of config.searchTerms) {
      if (!isFirst) {
        await delay(POLITE_DELAY_MS);
      }
      isFirst = false;

      const encodedTerm = encodeURIComponent(term);
      const url =
        `https://hn.algolia.com/api/v1/search?query=${encodedTerm}` +
        `&tags=story&numericFilters=created_at_i>${timestamp}` +
        `&hitsPerPage=${config.maxItems}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[hackernews] HTTP ${response.status} for term "${term}"`);
          continue;
        }

        const data = (await response.json()) as HNSearchResponse;
        for (const hit of data.hits ?? []) {
          if (!seen.has(hit.objectID)) {
            seen.add(hit.objectID);
            allHits.push(hit);
          }
        }
      } catch (err) {
        console.warn(`[hackernews] Fetch error for term "${term}":`, (err as Error).message);
      }
    }

    // Filter by minPoints
    const qualityHits = minPoints > 0
      ? allHits.filter((h) => h.points >= minPoints)
      : allHits;

    if (allHits.length !== qualityHits.length) {
      console.log(
        `[hackernews] Filtered ${allHits.length - qualityHits.length}/${allHits.length} stories below ${minPoints} points`
      );
    }

    // Sort by points descending, take top maxItems
    qualityHits.sort((a, b) => b.points - a.points);
    const topHits = qualityHits.slice(0, config.maxItems);

    const items: DigestItem[] = topHits.map((hit) => ({
      id: `hackernews:${hit.objectID}`,
      source: "hackernews" as const,
      title: hit.title,
      description: hit.story_text ? hit.story_text.slice(0, 300) : "",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      stats: {
        points: hit.points,
        comments: hit.num_comments,
      },
      createdAt: new Date(hit.created_at_i * 1000).toISOString(),
    }));

    console.log(`[hackernews] Fetched ${items.length} stories`);
    return items;
  } catch (err) {
    console.error("[hackernews] Unexpected error:", err);
    return [];
  }
}
