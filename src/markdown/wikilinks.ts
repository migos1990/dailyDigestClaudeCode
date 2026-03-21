import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import type { DigestItem, SeenItems } from "../types.js";

const SEEN_FILE = "data/seen-items.json";

export function enrichWithWikilinks(
  items: DigestItem[],
  basePath: string,
  todayDate: string
): DigestItem[] {
  const seenPath = resolve(basePath, SEEN_FILE);
  const seen = loadSeen(seenPath);

  const enriched = items.map((item) => {
    const priorDates = seen[item.url];
    const priorAppearances = priorDates
      ? priorDates.filter((d) => d !== todayDate)
      : [];

    // Record today's appearance
    if (!seen[item.url]) {
      seen[item.url] = [];
    }
    if (!seen[item.url].includes(todayDate)) {
      seen[item.url].push(todayDate);
    }

    return {
      ...item,
      priorAppearances: priorAppearances.length > 0 ? priorAppearances : undefined,
    };
  });

  saveSeen(seenPath, seen);
  return enriched;
}

function loadSeen(path: string): SeenItems {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as SeenItems;
  } catch {
    return {};
  }
}

function saveSeen(path: string, data: SeenItems): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`Failed to save seen-items: ${(err as Error).message}`);
  }
}
