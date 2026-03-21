import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import type { DigestItem, HistoryData } from "./types.js";

/*
  HISTORY.JSON LIFECYCLE:
  ┌─────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ MISSING  │────▶│ CREATE   │────▶│ UPDATE   │────▶│ PRUNE    │
  │(1st run) │     │(empty)   │     │(daily)   │     │(>90 days)│
  └─────────┘     └──────────┘     └──────────┘     └──────────┘
       │                                                   │
       │          ┌──────────┐                             │
       └─────────▶│ CORRUPT  │─── backup + reset ──────────┘
                  └──────────┘
*/

const HISTORY_FILE = "data/history.json";

export function computeVelocity(
  items: DigestItem[],
  config: { highSignalThreshold: number; historyDays: number },
  basePath: string
): DigestItem[] {
  const historyPath = resolve(basePath, HISTORY_FILE);
  const history = loadHistory(historyPath);
  const today = new Date().toISOString().split("T")[0];

  // Find yesterday's snapshot (most recent before today)
  const dates = Object.keys(history.snapshots).sort().reverse();
  const yesterday = dates.find((d) => d < today);

  const enriched = items.map((item) => {
    const sourceHistory = yesterday
      ? history.snapshots[yesterday]?.[item.source]
      : undefined;
    const priorStats = sourceHistory?.[item.id];

    if (!priorStats) {
      return { ...item, isNew: true, isHighSignal: false, velocity: {} };
    }

    const velocity: Record<string, number> = {};
    for (const [key, value] of Object.entries(item.stats)) {
      const prior = priorStats[key];
      if (prior !== undefined) {
        velocity[key] = value - prior;
      }
    }

    const maxVelocity = Math.max(...Object.values(velocity), 0);
    const isHighSignal = maxVelocity >= config.highSignalThreshold;

    return { ...item, velocity, isNew: false, isHighSignal };
  });

  // Update history with today's snapshot
  if (!history.snapshots[today]) {
    history.snapshots[today] = {};
  }
  for (const item of items) {
    if (!history.snapshots[today][item.source]) {
      history.snapshots[today][item.source] = {};
    }
    history.snapshots[today][item.source][item.id] = { ...item.stats };
  }

  // Prune old snapshots
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.historyDays);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  for (const date of Object.keys(history.snapshots)) {
    if (date < cutoffStr) {
      delete history.snapshots[date];
    }
  }

  saveHistory(historyPath, history);
  return enriched;
}

function loadHistory(path: string): HistoryData {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.snapshots || typeof parsed.snapshots !== "object") {
      throw new Error("Invalid history structure");
    }
    return parsed as HistoryData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { snapshots: {} };
    }
    // Corrupt file — backup and reset
    console.warn(`History file corrupt, backing up and resetting: ${(err as Error).message}`);
    try {
      copyFileSync(path, `${path}.backup.${Date.now()}`);
    } catch {
      // backup failed — continue anyway
    }
    return { snapshots: {} };
  }
}

function saveHistory(path: string, data: HistoryData): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`Failed to save history: ${(err as Error).message}`);
  }
}
