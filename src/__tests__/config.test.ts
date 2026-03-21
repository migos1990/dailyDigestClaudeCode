import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "../config.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(import.meta.dirname ?? ".", "__config_test_tmp__");

function writeTestConfig(data: unknown): string {
  mkdirSync(TEST_DIR, { recursive: true });
  const path = resolve(TEST_DIR, "config.json");
  writeFileSync(path, JSON.stringify(data));
  return path;
}

describe("loadConfig", () => {
  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("returns defaults when config file is missing", () => {
    const config = loadConfig("/nonexistent/path/config.json");
    expect(config.summarizer.model).toBe("claude-haiku-4-5-20251001");
    expect(config.sources.github.maxItems).toBe(10);
  });

  it("merges user config with defaults", () => {
    const path = writeTestConfig({
      sources: { github: { maxItems: 20 } },
    });
    const config = loadConfig(path);
    expect(config.sources.github.maxItems).toBe(20);
    // Other defaults preserved
    expect(config.sources.github.weight).toBe(3);
    expect(config.summarizer.batchSize).toBe(15);
  });

  it("throws on invalid JSON", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = resolve(TEST_DIR, "config.json");
    writeFileSync(path, "not json {{{");
    expect(() => loadConfig(path)).toThrow("Invalid JSON");
  });

  it("throws on invalid maxItems", () => {
    const path = writeTestConfig({
      sources: { github: { maxItems: -1 } },
    });
    expect(() => loadConfig(path)).toThrow("maxItems must be a positive number");
  });
});
