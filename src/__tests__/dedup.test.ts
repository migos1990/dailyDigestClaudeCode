import { describe, it, expect } from "vitest";
import { deduplicateByUrl } from "../index.js";
import type { DigestItem } from "../types.js";

function makeItem(overrides: Partial<DigestItem> = {}): DigestItem {
  return {
    id: "test:1",
    source: "github",
    title: "Test Item",
    description: "A test item",
    url: "https://example.com/1",
    stats: { stars: 100 },
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("deduplicateByUrl", () => {
  it("returns empty array for empty input", () => {
    expect(deduplicateByUrl([])).toEqual([]);
  });

  it("keeps unique items", () => {
    const items = [
      makeItem({ url: "https://a.com" }),
      makeItem({ url: "https://b.com" }),
    ];
    expect(deduplicateByUrl(items)).toHaveLength(2);
  });

  it("removes duplicates by URL, keeping first occurrence", () => {
    const items = [
      makeItem({ id: "first", url: "https://a.com", title: "First" }),
      makeItem({ id: "second", url: "https://a.com", title: "Second" }),
    ];
    const result = deduplicateByUrl(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("first");
  });

  it("deduplicates across sources with same URL", () => {
    const items = [
      makeItem({ source: "github", url: "https://example.com" }),
      makeItem({ source: "reddit", url: "https://example.com" }),
    ];
    expect(deduplicateByUrl(items)).toHaveLength(1);
  });
});
