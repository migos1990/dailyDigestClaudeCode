import { describe, it, expect } from "vitest";
import { trendScore } from "../markdown/daily.js";
import type { DigestItem } from "../types.js";

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

describe("trendScore", () => {
  it("scores GitHub items by stars / 100", () => {
    const item = makeItem({ source: "github", stats: { stars: 1000 } });
    expect(trendScore(item)).toBe(10);
  });

  it("scores YouTube items by views / 500", () => {
    const item = makeItem({ source: "youtube", stats: { views: 5000 } });
    expect(trendScore(item)).toBe(10);
  });

  it("returns 0 for reddit items", () => {
    const item = makeItem({ source: "reddit", stats: { score: 500 } });
    expect(trendScore(item)).toBe(0);
  });

  it("applies velocity bonus", () => {
    const base = makeItem({ source: "github", stats: { stars: 100 } });
    const withVelocity = makeItem({
      source: "github",
      stats: { stars: 100 },
      velocity: { stars: 50 },
    });
    expect(trendScore(withVelocity)).toBeGreaterThan(trendScore(base));
  });

  it("applies 1.2x boost for new items", () => {
    const existing = makeItem({ source: "github", stats: { stars: 1000 } });
    const newItem = makeItem({ source: "github", stats: { stars: 1000 }, isNew: true });
    expect(trendScore(newItem)).toBe(trendScore(existing) * 1.2);
  });
});
