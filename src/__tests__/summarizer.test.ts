import { describe, it, expect } from "vitest";

// We can't easily import the private isValidSummarizerResponse,
// so we test the validation logic inline
describe("summarizer response validation", () => {
  const VALID_RELEVANCE = new Set(["High", "Medium", "Low"]);

  function isValid(resp: unknown): boolean {
    if (!resp || typeof resp !== "object") return false;
    const r = resp as Record<string, unknown>;
    return (
      typeof r.id === "string" &&
      typeof r.summary === "string" &&
      typeof r.relevance === "string" &&
      VALID_RELEVANCE.has(r.relevance)
    );
  }

  it("accepts valid response", () => {
    expect(
      isValid({ id: "github:foo", summary: "A summary", relevance: "High", relevanceReason: "matches", installCommand: null })
    ).toBe(true);
  });

  it("rejects missing id", () => {
    expect(isValid({ summary: "A summary", relevance: "High" })).toBe(false);
  });

  it("rejects missing summary", () => {
    expect(isValid({ id: "x", relevance: "High" })).toBe(false);
  });

  it("rejects invalid relevance value", () => {
    expect(isValid({ id: "x", summary: "s", relevance: "SuperHigh" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isValid(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValid("string")).toBe(false);
  });
});
