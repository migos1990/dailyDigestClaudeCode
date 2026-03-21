import { DigestItem, RedditSourceConfig } from "../types.js";
import { delay } from "../utils.js";

const USER_AGENT = "daily-digest-claude-code/1.0";
const RATE_LIMIT_DELAY_MS = 2000;
const RECENT_HOURS = 48;

interface RedditPost {
  name: string;
  id: string;
  title: string;
  selftext: string;
  permalink: string;
  score: number;
  num_comments: number;
  upvote_ratio: number;
  created_utc: number;
}

interface RedditListingResponse {
  data: {
    children: Array<{ data: RedditPost }>;
  };
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  const headers = { "User-Agent": USER_AGENT };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers });

      if (response.status === 429) {
        if (attempt === 0) {
          console.warn(`[reddit] Rate limited (429) on ${url}, retrying after 2s...`);
          await delay(RATE_LIMIT_DELAY_MS);
          continue;
        }
        console.warn(`[reddit] Rate limited (429) on retry, giving up: ${url}`);
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        console.warn(
          `[reddit] Non-JSON response (possible bot detection). Content-Type: ${contentType}, URL: ${url}`
        );
        return null;
      }

      if (!response.ok) {
        console.warn(`[reddit] HTTP ${response.status} for ${url}`);
        return null;
      }

      return response;
    } catch (err) {
      if (attempt === 0) {
        console.error(`[reddit] Fetch error for ${url}:`, err);
        return null;
      }
    }
  }

  return null;
}

export async function fetchReddit(config: RedditSourceConfig): Promise<DigestItem[]> {
  const seen = new Set<string>();
  const allPosts: RedditPost[] = [];
  const cutoff = Date.now() - RECENT_HOURS * 60 * 60 * 1000;
  let isFirstRequest = true;

  try {
    // Subreddit-scoped searches
    for (const subreddit of config.subreddits) {
      for (const term of config.searchTerms) {
        if (!isFirstRequest) {
          await delay(RATE_LIMIT_DELAY_MS);
        }
        isFirstRequest = false;

        const encodedTerm = encodeURIComponent(term);
        const url =
          `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json` +
          `?q=${encodedTerm}&sort=new&t=day&limit=${config.maxItems}&restrict_sr=on`;

        const response = await fetchWithRetry(url);
        if (!response) continue;

        const json = (await response.json()) as RedditListingResponse;
        for (const child of json.data?.children ?? []) {
          const post = child.data;
          if (!seen.has(post.name)) {
            seen.add(post.name);
            allPosts.push(post);
          }
        }
      }
    }

    // General searches (not restricted to a subreddit)
    for (const term of config.searchTerms) {
      if (!isFirstRequest) {
        await delay(RATE_LIMIT_DELAY_MS);
      }
      isFirstRequest = false;

      const encodedTerm = encodeURIComponent(term);
      const url =
        `https://www.reddit.com/search.json` +
        `?q=${encodedTerm}&sort=new&t=day&limit=${config.maxItems}`;

      const response = await fetchWithRetry(url);
      if (!response) continue;

      const json = (await response.json()) as RedditListingResponse;
      for (const child of json.data?.children ?? []) {
        const post = child.data;
        if (!seen.has(post.name)) {
          seen.add(post.name);
          allPosts.push(post);
        }
      }
    }

    // Filter to last 48 hours
    const recentPosts = allPosts.filter(
      (post) => post.created_utc * 1000 >= cutoff
    );

    // Map to DigestItem
    const items: DigestItem[] = recentPosts.map((post) => ({
      id: `reddit:${post.name}`,
      source: "reddit" as const,
      title: post.title,
      description: post.selftext ? post.selftext.slice(0, 300) : "",
      url: `https://www.reddit.com${post.permalink}`,
      stats: {
        score: post.score,
        comments: post.num_comments,
        upvoteRatio: Math.round(post.upvote_ratio * 100),
      },
      createdAt: new Date(post.created_utc * 1000).toISOString(),
    }));

    // Sort by score descending, take top maxItems
    items.sort((a, b) => b.stats.score - a.stats.score);
    return items.slice(0, config.maxItems);
  } catch (err) {
    console.error("[reddit] Unexpected error in fetchReddit:", err);
    return [];
  }
}
