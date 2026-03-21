import { describe, it, expect } from "vitest";
import { compositeScore, selectDigestItems } from "../markdown/daily.js";
import type { DigestItem, SourceWeights } from "../types.js";

const defaultWeights: SourceWeights = { github: 3, youtube: 2, reddit: 1 };

function makeItem(overrides: Partial<DigestItem> = {}): DigestItem {
  return {
    id: "test:1",
    source: "github",
    title: "Test",
    description: "",
    url: "https://example.com",
    stats: { stars: 0 },
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("compositeScore", () => {
  it("scores GitHub items using stars, source weight, and relevance", () => {
    const item = makeItem({ source: "github", stats: { stars: 1000 }, relevance: "High" });
    // High=3 * github_weight=3 * (1000/100) * novelty=1.0 = 90
    expect(compositeScore(item, defaultWeights)).toBe(90);
  });

  it("scores YouTube items using views", () => {
    const item = makeItem({ source: "youtube", stats: { views: 5000 }, relevance: "High" });
    // High=3 * youtube_weight=2 * (5000/500) * 1.0 = 60
    expect(compositeScore(item, defaultWeights)).toBe(60);
  });

  it("scores Reddit items using score + comments", () => {
    const item = makeItem({ source: "reddit", stats: { score: 100, comments: 50 }, relevance: "Medium" });
    // Medium=1.5 * reddit_weight=1 * (150/20) * 1.0 = 11.25
    expect(compositeScore(item, defaultWeights)).toBe(11.25);
  });

  it("applies relevance multipliers correctly", () => {
    const base = { source: "github" as const, stats: { stars: 1000 } };
    const high = makeItem({ ...base, relevance: "High" });
    const med = makeItem({ ...base, relevance: "Medium" });
    const low = makeItem({ ...base, relevance: "Low" });
    const unscored = makeItem({ ...base });

    expect(compositeScore(high, defaultWeights)).toBeGreaterThan(compositeScore(med, defaultWeights));
    expect(compositeScore(med, defaultWeights)).toBeGreaterThan(compositeScore(low, defaultWeights));
    expect(compositeScore(unscored, defaultWeights)).toBeGreaterThan(compositeScore(low, defaultWeights));
  });

  it("applies velocity bonus", () => {
    const base = makeItem({ source: "github", stats: { stars: 100 } });
    const withVelocity = makeItem({
      source: "github",
      stats: { stars: 100 },
      velocity: { stars: 50 },
    });
    expect(compositeScore(withVelocity, defaultWeights)).toBeGreaterThan(compositeScore(base, defaultWeights));
  });

  it("applies 1.2x boost for new items", () => {
    const existing = makeItem({ source: "github", stats: { stars: 1000 } });
    const newItem = makeItem({ source: "github", stats: { stars: 1000 }, isNew: true });
    expect(compositeScore(newItem, defaultWeights)).toBe(compositeScore(existing, defaultWeights) * 1.2);
  });

  it("penalizes stale items with 3+ prior appearances", () => {
    const fresh = makeItem({ source: "github", stats: { stars: 1000 } });
    const stale = makeItem({
      source: "github",
      stats: { stars: 1000 },
      priorAppearances: ["2025-01-01", "2025-01-02", "2025-01-03"],
    });
    expect(compositeScore(stale, defaultWeights)).toBeLessThan(compositeScore(fresh, defaultWeights));
    expect(compositeScore(stale, defaultWeights)).toBe(compositeScore(fresh, defaultWeights) * 0.6);
  });

  it("applies moderate penalty for 1-2 prior appearances", () => {
    const fresh = makeItem({ source: "github", stats: { stars: 1000 } });
    const seen = makeItem({
      source: "github",
      stats: { stars: 1000 },
      priorAppearances: ["2025-01-01"],
    });
    expect(compositeScore(seen, defaultWeights)).toBe(compositeScore(fresh, defaultWeights) * 0.85);
  });

  it("uses source weights from config", () => {
    const github = makeItem({ source: "github", stats: { stars: 100 } });
    const heavyWeights: SourceWeights = { github: 10, youtube: 1, reddit: 1 };
    const lightWeights: SourceWeights = { github: 1, youtube: 1, reddit: 1 };
    expect(compositeScore(github, heavyWeights)).toBeGreaterThan(compositeScore(github, lightWeights));
  });
});

describe("selectDigestItems", () => {
  it("drops Low relevance items", () => {
    const items = [
      makeItem({ id: "1", relevance: "High", stats: { stars: 100 } }),
      makeItem({ id: "2", relevance: "Low", stats: { stars: 200 } }),
    ];
    const { selected, dropped } = selectDigestItems(items, defaultWeights);
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("1");
    expect(dropped).toHaveLength(1);
  });

  it("enforces budget limit", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({ id: `item-${i}`, relevance: "Medium", stats: { stars: 100 * (20 - i) }, url: `https://example.com/${i}` })
    );
    const { selected } = selectDigestItems(items, defaultWeights, 5);
    expect(selected.length).toBeLessThanOrEqual(5);
  });

  it("enforces source diversity cap", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      makeItem({ id: `gh-${i}`, source: "github", relevance: "High", stats: { stars: 100 * (15 - i) }, url: `https://example.com/${i}` })
    );
    // Add a few youtube items
    items.push(
      makeItem({ id: "yt-1", source: "youtube", relevance: "Medium", stats: { views: 500 }, url: "https://youtube.com/1" }),
      makeItem({ id: "yt-2", source: "youtube", relevance: "Medium", stats: { views: 1000 }, url: "https://youtube.com/2" }),
    );
    const { selected } = selectDigestItems(items, defaultWeights, 12);
    // YouTube items should make it in via wildcard or backfill, proving diversity works
    const youtubeCount = selected.filter((i) => i.source === "youtube").length;
    expect(youtubeCount).toBeGreaterThanOrEqual(1);
    // Total should not exceed budget
    expect(selected.length).toBeLessThanOrEqual(12);
  });

  it("returns all items when under budget", () => {
    const items = [
      makeItem({ id: "1", relevance: "High", stats: { stars: 100 } }),
      makeItem({ id: "2", relevance: "Medium", stats: { stars: 50 }, url: "https://example.com/2" }),
    ];
    const { selected } = selectDigestItems(items, defaultWeights, 12);
    expect(selected).toHaveLength(2);
  });
});
