import type { DigestItem, SourceConfig } from "../types.js";

function htmlDecode(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

interface YouTubeSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
}

interface YouTubeVideoStatistics {
  viewCount?: string;
  likeCount?: string;
}

interface YouTubeVideoItem {
  id: string;
  statistics: YouTubeVideoStatistics;
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoItem[];
}

export async function fetchYouTube(
  config: SourceConfig,
): Promise<DigestItem[]> {
  const API_KEY = process.env.YOUTUBE_API_KEY;

  if (!API_KEY) {
    console.warn("[youtube] YOUTUBE_API_KEY not set — skipping YouTube fetch");
    return [];
  }

  const publishedAfter = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const seenIds = new Set<string>();
  const searchItems: YouTubeSearchItem[] = [];

  // Step 1: Search for videos matching each term
  for (const term of config.searchTerms) {
    const params = new URLSearchParams({
      part: "snippet",
      q: term,
      type: "video",
      order: "date",
      maxResults: String(config.maxItems),
      publishedAfter,
      key: API_KEY,
    });

    let data: YouTubeSearchResponse;
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${params}`,
      );

      if (res.status === 403) {
        console.warn(
          "[youtube] Quota exceeded (403) during search — returning partial results",
        );
        break;
      }

      if (!res.ok) {
        console.error(
          `[youtube] Search request failed with status ${res.status}`,
        );
        continue;
      }

      data = (await res.json()) as YouTubeSearchResponse;
    } catch (err) {
      console.error(`[youtube] Fetch error during search for "${term}":`, err);
      return [];
    }

    for (const item of data.items ?? []) {
      const videoId = item.id.videoId;
      if (!seenIds.has(videoId)) {
        seenIds.add(videoId);
        searchItems.push(item);
      }
    }
  }

  if (searchItems.length === 0) {
    return [];
  }

  // Step 2: Batch-fetch statistics for all collected video IDs
  const videoIds = searchItems.map((item) => item.id.videoId);
  const statsMap = new Map<string, YouTubeVideoStatistics>();

  try {
    const statsParams = new URLSearchParams({
      part: "statistics",
      id: videoIds.join(","),
      key: API_KEY,
    });

    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${statsParams}`,
    );

    if (statsRes.status === 403) {
      console.warn(
        "[youtube] Quota exceeded (403) during statistics fetch — returning results without stats",
      );
    } else if (statsRes.ok) {
      const statsData = (await statsRes.json()) as YouTubeVideosResponse;
      for (const video of statsData.items ?? []) {
        statsMap.set(video.id, video.statistics);
      }
    } else {
      console.error(
        `[youtube] Statistics request failed with status ${statsRes.status}`,
      );
    }
  } catch (err) {
    console.error("[youtube] Fetch error during statistics request:", err);
    return [];
  }

  // Step 3: Map results to DigestItem[]
  const items: DigestItem[] = searchItems.map((item) => {
    const videoId = item.id.videoId;
    const stats = statsMap.get(videoId);

    return {
      id: `youtube:${videoId}`,
      source: "youtube" as const,
      title: htmlDecode(item.snippet.title),
      description: item.snippet.description.slice(0, 200),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      stats: {
        views: Number(stats?.viewCount ?? 0),
        likes: Number(stats?.likeCount ?? 0),
      },
      createdAt: item.snippet.publishedAt,
    };
  });

  return items;
}
