import { readFileSync } from "fs";
import { resolve } from "path";
import type { DigestConfig } from "./types.js";

const DEFAULTS: DigestConfig = {
  schedule: { timezone: "America/New_York", hour: 6 },
  sources: {
    github: { searchTerms: ["claude code"], maxItems: 10, weight: 3, minStars: 3, searchWindow: 168 },
    youtube: { searchTerms: ["claude code"], maxItems: 8, weight: 2, minViews: 100, searchWindow: 72 },
    reddit: {
      subreddits: ["ClaudeAI"],
      searchTerms: ["claude code"],
      maxItems: 8,
      weight: 1,
      minScore: 3,
    },
    hackernews: {
      searchTerms: ["claude code"],
      maxItems: 8,
      weight: 1,
      minPoints: 5,
      searchWindow: 72,
    },
  },
  profile: {
    name: "User",
    goals: [],
    skillLevel: "intermediate",
    interests: [],
    currentProjects: [],
  },
  velocity: { highSignalThreshold: 100, historyDays: 90 },
  summarizer: { model: "claude-haiku-4-5-20251001", batchSize: 15 },
  output: { vaultPath: ".", dailyFolder: "Daily", weeklyFolder: "Weekly" },
  clustering: { enabled: true, minItems: 6 },
};

export function loadConfig(configPath?: string): DigestConfig {
  const path = configPath ?? resolve(process.cwd(), "config.json");

  let config: DigestConfig;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    config = deepMerge(DEFAULTS as unknown as Record<string, unknown>, parsed) as unknown as DigestConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`Config not found at ${path}, using defaults`);
      return DEFAULTS;
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config.json: ${err.message}`);
    }
    throw err;
  }

  validateConfig(config);
  return config;
}

function validateConfig(config: DigestConfig): void {
  const errors: string[] = [];

  for (const [name, source] of Object.entries(config.sources)) {
    if (!Array.isArray(source.searchTerms) || source.searchTerms.length === 0) {
      errors.push(`sources.${name}.searchTerms must be a non-empty array`);
    }
    if (typeof source.maxItems !== "number" || source.maxItems < 1) {
      errors.push(`sources.${name}.maxItems must be a positive number`);
    }
  }

  if (typeof config.summarizer.batchSize !== "number" || config.summarizer.batchSize < 1) {
    errors.push("summarizer.batchSize must be a positive number");
  }

  if (typeof config.velocity.historyDays !== "number" || config.velocity.historyDays < 1) {
    errors.push("velocity.historyDays must be a positive number");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid config:\n  - ${errors.join("\n  - ")}`);
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
