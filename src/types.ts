export interface DigestConfig {
  schedule: { timezone: string; hour: number };
  sources: {
    github: SourceConfig;
    youtube: SourceConfig;
    reddit: RedditSourceConfig;
  };
  profile: UserProfile;
  velocity: { highSignalThreshold: number; historyDays: number };
  summarizer: { model: string; batchSize: number };
  output: { vaultPath: string; dailyFolder: string; weeklyFolder: string };
}

export interface SourceConfig {
  searchTerms: string[];
  maxItems: number;
  weight: number;
  minStars?: number;
  minViews?: number;
  minScore?: number;
  searchWindow?: number; // hours to look back
}

export interface RedditSourceConfig extends SourceConfig {
  subreddits: string[];
}

export interface UserProfile {
  name: string;
  goals: string[];
  skillLevel: "beginner" | "intermediate" | "advanced";
  interests: string[];
  currentProjects: string[];
}

export type SourceWeights = Record<"github" | "youtube" | "reddit", number>;

export interface DigestItem {
  id: string;
  source: "github" | "youtube" | "reddit";
  title: string;
  description: string;
  url: string;
  stats: Record<string, number>;
  createdAt: string;
  // Enriched by summarizer
  summary?: string;
  relevance?: "High" | "Medium" | "Low";
  relevanceReason?: string;
  installCommand?: string;
  contentType?: "tool" | "tutorial" | "discussion" | "news" | "reference";
  hookLine?: string;
  // Enriched by velocity engine
  velocity?: Record<string, number>;
  isNew?: boolean;
  isHighSignal?: boolean;
  // Enriched by wikilinks engine
  priorAppearances?: string[];
}

export interface HistorySnapshot {
  [itemId: string]: Record<string, number>;
}

export interface HistoryData {
  snapshots: Record<string, Record<string, HistorySnapshot>>;
}

export interface SeenItems {
  [url: string]: string[];
}

export interface DigestResult {
  items: DigestItem[];
  sourcesOk: string[];
  sourcesFailed: string[];
  itemsTotal: number;
  itemsSummarized: number;
  itemsFiltered: number;
  highSignalCount: number;
  runtimeSeconds: number;
  date: string;
}

export interface SummarizerResponse {
  id: string;
  summary: string;
  relevance: "High" | "Medium" | "Low";
  relevanceReason: string;
  installCommand: string | null;
  contentType?: "tool" | "tutorial" | "discussion" | "news" | "reference";
  hookLine?: string;
}
