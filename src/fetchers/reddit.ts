import { DigestItem, RedditSourceConfig } from "../types.js";
import { delay } from "../utils.js";

const USER_AGENT = "daily-digest-claude-code/1.0 (by /u/dailydigest)";
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

/**
 * Obtain an OAuth access token using Reddit's "application only" flow.
 * Requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars.
 * Falls back to unauthenticated www.reddit.com if credentials are missing.
 */
async function getOAuthToken(): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET ?? "";

  if (!clientId) {
    return null;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      console.warn(`[reddit] OAuth token request failed: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      console.warn("[reddit] OAuth response missing access_token");
      return null;
    }

    return data.access_token;
  } catch (err) {
    console.warn("[reddit] OAuth token request error:", (err as Error).message);
    return null;
  }
}

interface RedditClient {
  baseUrl: string;
  headers: Record<string, string>;
}

async function createRedditClient(): Promise<RedditClient> {
  const token = await getOAuthToken();

  if (token) {
    console.log("[reddit] Using OAuth API (oauth.reddit.com)");
    return {
      baseUrl: "https://oauth.reddit.com",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
    };
  }

  console.warn("[reddit] No REDDIT_CLIENT_ID set — falling back to www.reddit.com (may be blocked)");
  return {
    baseUrl: "https://www.reddit.com",
    headers: {
      "User-Agent": USER_AGENT,
    },
  };
}

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response | null> {
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

  const client = await createRedditClient();

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
          `${client.baseUrl}/r/${encodeURIComponent(subreddit)}/search.json` +
          `?q=${encodedTerm}&sort=new&t=day&limit=${config.maxItems}&restrict_sr=on`;

        const response = await fetchWithRetry(url, client.headers);
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
        `${client.baseUrl}/search.json` +
        `?q=${encodedTerm}&sort=new&t=day&limit=${config.maxItems}`;

      const response = await fetchWithRetry(url, client.headers);
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

    // Filter by minimum score
    const minScore = config.minScore ?? 0;
    const qualityPosts = minScore > 0
      ? recentPosts.filter(post => post.score >= minScore)
      : recentPosts;
    if (recentPosts.length !== qualityPosts.length) {
      console.log(`[reddit] Filtered ${recentPosts.length - qualityPosts.length}/${recentPosts.length} posts below ${minScore} score`);
    }

    // Map to DigestItem
    const items: DigestItem[] = qualityPosts.map((post) => ({
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
