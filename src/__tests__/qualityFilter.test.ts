import { describe, it, expect } from "vitest";
import type { DigestItem, DigestConfig } from "../types.js";

// Re-implement filterByQuality logic for testing (it's not exported)
function filterByQuality(items: DigestItem[], sources: DigestConfig["sources"]): DigestItem[] {
  return items.filter(item => {
    switch (item.source) {
      case "github":
        return (item.stats.stars ?? 0) >= (sources.github.minStars ?? 0);
      case "youtube":
        return (item.stats.views ?? 0) >= (sources.youtube.minViews ?? 0);
      case "reddit":
        return (item.stats.score ?? 0) >= (sources.reddit.minScore ?? 0);
      case "hackernews":
        return (item.stats.points ?? 0) >= (sources.hackernews.minPoints ?? 0);
      default:
        return true;
    }
  });
}

const defaultSources: DigestConfig["sources"] = {
  github: { searchTerms: ["test"], maxItems: 5, weight: 3, minStars: 10 },
  youtube: { searchTerms: ["test"], maxItems: 5, weight: 2, minViews: 100 },
  reddit: { subreddits: ["test"], searchTerms: ["test"], maxItems: 5, weight: 1, minScore: 5 },
  hackernews: { searchTerms: ["test"], maxItems: 5, weight: 1, minPoints: 10 },
};

function makeItem(source: "github" | "youtube" | "reddit" | "hackernews", stats: Record<string, number>): DigestItem {
  return {
    id: `${source}:test`,
    source,
    title: "Test",
    description: "",
    url: "https://example.com",
    stats,
    createdAt: "2025-01-01T00:00:00Z",
  };
}

describe("filterByQuality", () => {
  it("keeps GitHub repos above minStars", () => {
    const items = [makeItem("github", { stars: 50 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(1);
  });

  it("filters GitHub repos below minStars", () => {
    const items = [makeItem("github", { stars: 2 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(0);
  });

  it("keeps YouTube videos above minViews", () => {
    const items = [makeItem("youtube", { views: 500 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(1);
  });

  it("filters YouTube videos below minViews", () => {
    const items = [makeItem("youtube", { views: 5 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(0);
  });

  it("keeps Reddit posts above minScore", () => {
    const items = [makeItem("reddit", { score: 20 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(1);
  });

  it("filters Reddit posts below minScore", () => {
    const items = [makeItem("reddit", { score: 1 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(0);
  });

  it("filters mixed sources correctly", () => {
    const items = [
      makeItem("github", { stars: 50 }),   // keep
      makeItem("github", { stars: 1 }),    // filter
      makeItem("youtube", { views: 200 }), // keep
      makeItem("youtube", { views: 3 }),   // filter
      makeItem("reddit", { score: 10 }),   // keep
      makeItem("reddit", { score: 0 }),    // filter
    ];
    const result = filterByQuality(items, defaultSources);
    expect(result).toHaveLength(3);
  });

  it("treats missing stats as 0 (filtered)", () => {
    const items = [makeItem("youtube", {})];
    expect(filterByQuality(items, defaultSources)).toHaveLength(0);
  });

  it("passes items at exactly the threshold", () => {
    const items = [makeItem("github", { stars: 10 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(1);
  });

  it("keeps HN stories above minPoints", () => {
    const items = [makeItem("hackernews", { points: 50 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(1);
  });

  it("filters HN stories below minPoints", () => {
    const items = [makeItem("hackernews", { points: 2 })];
    expect(filterByQuality(items, defaultSources)).toHaveLength(0);
  });
});
