/**
 * Social / civic-pulse layer — real public-opinion data from tsaaguur.mn
 * (crawled Facebook + Mongolian news trends). This is the "citizen experience"
 * dimension of the digital twin: alongside the physical simulation, the twin
 * surfaces what the public is ALREADY saying about a policy.
 */
import type { SimDomain } from "@/lib/types";

export type Sentiment = "positive" | "neutral" | "negative";

/** A single trending topic (хамгийн халуун). */
export interface TrendTopic {
  id: string;
  /** 1-based rank in the current hottest list; 0 for cluster-derived topics. */
  rank: number;
  /** Mongolian title as shown on tsaaguur.mn. */
  title: string;
  /** Optional English gloss for non-Mongolian viewers. */
  titleEn?: string;
  /** Coarse civic category used for domain matching + coloring. */
  category: string;
  emoji?: string;
  sentiment: Sentiment;
  reactions: number;
  comments: number;
  shares: number;
  /** Number of Facebook posts behind the topic. */
  posts: number;
  /** Number of news articles behind the topic. */
  news: number;
  /** Heat / trend score from tsaaguur.mn. */
  score: number;
}

/** A single high-engagement post (Их яригдаж байгаа). */
export interface CitizenPost {
  id: string;
  author: string;
  text: string;
  likes: number;
  comments: number;
  shares: number;
  url?: string;
}

/** A clustered theme grouping several related topics (Гол сэдвүүд). */
export interface TopicCluster {
  id: string;
  title: string;
  subtopics: string[];
  posts: number;
  score: number;
}

/** The full civic snapshot returned by the tsaaguur.mn endpoint. */
export interface CitizenPulse {
  updatedAt: string;
  source: string;
  /** true = served from the live tsaaguur.mn API; false = bundled sample. */
  live: boolean;
  trends: TrendTopic[];
  topPosts: CitizenPost[];
  clusters: TopicCluster[];
}

/** Scenario ↔ public-opinion match, attached to a simulation result. */
export interface PublicSignal {
  matched: Array<{ topic: TrendTopic; relevance: string }>;
  /** Aggregate public mood across the matched topics. */
  mood: Sentiment | "mixed" | "none";
  /** Total reactions across matched topics (a rough salience weight). */
  engagement: number;
  /** One-line read of where public opinion stands on this policy. */
  headline: string;
  /** Which simulation domains drove the match. */
  domains: SimDomain[];
  /** A representative real citizen/official post on the topic, if found. */
  quote?: { author: string; text: string; likes: number };
}
