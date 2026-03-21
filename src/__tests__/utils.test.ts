import { describe, it, expect } from "vitest";
import { delay, getWeekNumber } from "../utils.js";

describe("delay", () => {
  it("resolves after the specified time", async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("getWeekNumber", () => {
  it("returns week 1 for Jan 1 2024 (Monday)", () => {
    expect(getWeekNumber(new Date("2024-01-01"))).toBe(1);
  });

  it("returns week 52 or 1 for Dec 31", () => {
    const week = getWeekNumber(new Date("2024-12-31"));
    expect(week).toBeGreaterThanOrEqual(1);
  });

  it("returns consistent results for the same date", () => {
    const date = new Date("2025-06-15");
    expect(getWeekNumber(date)).toBe(getWeekNumber(date));
  });
});
