import type { DigestItem, SourceConfig } from "../types.js";

interface GitHubSearchResponse {
  items: GitHubRepo[];
}

interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  created_at: string;
}

import { delay } from "../utils.js";

export async function fetchGitHub(
  config: SourceConfig,
): Promise<DigestItem[]> {
  const seen = new Map<string, DigestItem>();
  const token = process.env.GITHUB_TOKEN;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "daily-digest-claude-code",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const windowHours = config.searchWindow ?? 168;
  const pushedAfter = new Date(Date.now() - windowHours * 60 * 60 * 1000)
    .toISOString().split("T")[0];
  const minStars = config.minStars ?? 0;

  for (let i = 0; i < config.searchTerms.length; i++) {
    const term = config.searchTerms[i];

    if (i > 0) {
      await delay(1000);
    }

    const params = new URLSearchParams({
      q: `${term} pushed:>${pushedAfter}`,
      sort: "stars",
      order: "desc",
      per_page: String(config.maxItems),
    });

    const url = `https://api.github.com/search/repositories?${params}`;

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (err) {
      console.error(
        `[github] Network error fetching term "${term}":`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (response.status === 403) {
      console.warn(
        `[github] Rate limited (403) while searching "${term}". Returning ${seen.size} items collected so far.`,
      );
      return Array.from(seen.values());
    }

    if (!response.ok) {
      console.error(
        `[github] HTTP ${response.status} for term "${term}": ${response.statusText}`,
      );
      continue;
    }

    let data: GitHubSearchResponse;
    try {
      data = (await response.json()) as GitHubSearchResponse;
    } catch (err) {
      console.error(
        `[github] Failed to parse JSON for term "${term}":`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    for (const repo of data.items) {
      if (seen.has(repo.full_name)) {
        continue;
      }

      if (repo.stargazers_count < minStars) {
        continue;
      }

      const item: DigestItem = {
        id: `github:${repo.full_name}`,
        source: "github",
        title: repo.full_name,
        description: repo.description ?? "",
        url: repo.html_url,
        stats: {
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          watchers: repo.watchers_count,
        },
        createdAt: repo.created_at,
        installCommand: `git clone ${repo.clone_url}`,
      };

      seen.set(repo.full_name, item);
    }
  }

  return Array.from(seen.values());
}
