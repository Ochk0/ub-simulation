/**
 * tsaaguur.mn civic-pulse client (server-side).
 *
 * Fetches the live trend snapshot from TSAAGUUR_API_URL and normalizes it to
 * {@link CitizenPulse}. With no URL configured (or on any failure) it serves the
 * bundled sample so the feature always renders. Results are cached briefly to
 * avoid hammering the upstream on every simulation.
 *
 * EXPECTED ENDPOINT CONTRACT — GET {TSAAGUUR_API_URL} returns JSON shaped like
 * src/lib/social/sample.json (keys: updatedAt, trends[], topPosts[], clusters[]).
 * If the real API differs, adjust `normalize()` below — that's the only seam.
 */
import type {
  CitizenPulse,
  TrendTopic,
  PublicSignal,
  Sentiment,
} from "./types";
import type { Scenario, SimDomain } from "@/lib/types";
import sample from "./sample.json";

const SAMPLE = sample as unknown as CitizenPulse;
const TTL_MS = 120_000;

let cache: { at: number; data: CitizenPulse } | null = null;

/** Load the current civic pulse (live if configured, else sample). */
export async function getCitizenPulse(): Promise<CitizenPulse> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const url = process.env.TSAAGUUR_API_URL;
  let data: CitizenPulse = { ...SAMPLE, live: false };

  if (url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
        // Next data cache; we also keep our own TTL above.
        next: { revalidate: 120 },
      }).finally(() => clearTimeout(timer));
      if (res.ok) {
        const raw = await res.json();
        const norm = normalize(raw);
        if (norm) data = { ...norm, live: true };
      }
    } catch (err) {
      console.warn(`[tsaaguur] live fetch failed, using sample: ${(err as Error).message}`);
    }
  }

  cache = { at: Date.now(), data };
  return data;
}

/** Map the upstream payload onto our model. Tolerant of nesting + missing keys. */
function normalize(raw: unknown): CitizenPulse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const body = (r.data && typeof r.data === "object" ? r.data : r) as Record<string, unknown>;
  const trends = Array.isArray(body.trends) ? body.trends.map(asTrend).filter(Boolean) : [];
  if (!trends.length) return null;
  return {
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : new Date().toISOString(),
    source: "tsaaguur.mn",
    live: true,
    trends: trends as TrendTopic[],
    topPosts: Array.isArray(body.topPosts) ? (body.topPosts as CitizenPulse["topPosts"]) : [],
    clusters: Array.isArray(body.clusters) ? (body.clusters as CitizenPulse["clusters"]) : [],
  };
}

const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];
function asTrend(v: unknown, i: number): TrendTopic | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const title = typeof t.title === "string" ? t.title : "";
  if (!title) return null;
  return {
    id: String(t.id ?? `t${i + 1}`),
    rank: num(t.rank) || i + 1,
    title,
    titleEn: typeof t.titleEn === "string" ? t.titleEn : undefined,
    category: typeof t.category === "string" ? t.category : "other",
    emoji: typeof t.emoji === "string" ? t.emoji : undefined,
    sentiment: SENTIMENTS.includes(t.sentiment as Sentiment) ? (t.sentiment as Sentiment) : "neutral",
    reactions: num(t.reactions),
    comments: num(t.comments),
    shares: num(t.shares),
    posts: num(t.posts),
    news: num(t.news),
    score: num(t.score),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Scenario ↔ public opinion matching
 * ────────────────────────────────────────────────────────────────────────── */

/** Mongolian keyword patterns per simulation domain, matched against titles. */
const DOMAIN_PATTERNS: Partial<Record<SimDomain, RegExp>> = {
  traffic: /скүүтер|мопед|дугуй|унац|тээвэр|зам(?!гай)|хаалт|замын|түгжрэл|гэрэл|уулзвар/i,
  transit: /автобус|нийтийн тээвэр|метро|трам|буудал|скүүтер|мопед/i,
  pollution: /утаа|агаарын бохирдол|агаарын чанар|тоосонцор|нүүрс|ногоон|орон сууц|халаалт|pm ?2/i,
  energy: /эрчим хүч|цахилгаан|нүүрс|дулаан|эрчим|станц/i,
  emergency: /аврах|осол|онцгой|гал|түймэр|яаралтай|эмнэлэг|түргэн/i,
};

const sentimentWord: Record<Sentiment, string> = {
  positive: "largely supportive",
  neutral: "watching closely / split",
  negative: "pushing back",
};

/** Convert a cluster to a lightweight topic so themes also participate in matching. */
function clusterTopics(pulse: CitizenPulse): TrendTopic[] {
  return pulse.clusters.map((c) => ({
    id: c.id,
    rank: 0,
    title: c.title,
    category: "theme",
    sentiment: "neutral" as Sentiment,
    reactions: Math.round(c.score * 10),
    comments: 0,
    shares: 0,
    posts: c.posts,
    news: 0,
    score: c.score,
  }));
}

/** Find what citizens are already saying about a simulated policy. */
export function matchTrendsToScenario(scenario: Scenario, pulse: CitizenPulse): PublicSignal {
  const pool = [...pulse.trends, ...clusterTopics(pulse)];
  const domains = scenario.domains.filter((d) => DOMAIN_PATTERNS[d]);

  const seen = new Set<string>();
  const matched: PublicSignal["matched"] = [];
  for (const domain of domains) {
    const re = DOMAIN_PATTERNS[domain]!;
    for (const topic of pool) {
      if (seen.has(topic.title)) continue;
      if (re.test(topic.title) || (topic.titleEn && re.test(topic.titleEn))) {
        seen.add(topic.title);
        matched.push({
          topic,
          relevance:
            topic.rank > 0
              ? `Trending #${topic.rank} · ${topic.posts} posts · ${topic.news} news`
              : `${topic.posts} posts across ${pulse.clusters.find((c) => c.id === topic.id)?.subtopics.length ?? 1} sub-threads`,
        });
      }
    }
  }

  matched.sort((a, b) => b.topic.score - a.topic.score);
  const top = matched.slice(0, 4);
  const quote = findQuote(pulse, domains);

  if (!top.length) {
    return {
      matched: [],
      mood: "none",
      engagement: 0,
      headline: "No significant public discussion detected on this topic yet — a chance to lead the narrative.",
      domains,
      quote,
    };
  }

  const engagement = top.reduce((s, m) => s + m.topic.reactions, 0);
  const mood = aggregateMood(top.map((m) => m.topic.sentiment));
  const lead = top[0].topic;
  const moodPhrase = mood === "mixed" ? "divided" : sentimentWord[mood as Sentiment];
  const rankPart = lead.rank > 0 ? `is trending #${lead.rank}` : "is being actively discussed";
  const headline = `"${lead.title}" ${rankPart} on tsaaguur.mn — citizens are ${moodPhrase}.`;

  return { matched: top, mood, engagement, headline, domains, quote };
}

/** Surface the highest-engagement real post that touches the scenario's domains. */
function findQuote(
  pulse: CitizenPulse,
  domains: SimDomain[]
): PublicSignal["quote"] {
  let best: PublicSignal["quote"];
  let bestLikes = -1;
  for (const post of pulse.topPosts) {
    const hit = domains.some((d) => DOMAIN_PATTERNS[d]?.test(post.text));
    if (hit && post.likes > bestLikes) {
      bestLikes = post.likes;
      best = { author: post.author, text: post.text, likes: post.likes };
    }
  }
  return best;
}

function aggregateMood(s: Sentiment[]): PublicSignal["mood"] {
  if (!s.length) return "none";
  const uniq = new Set(s);
  if (uniq.size === 1) return s[0];
  const counts = { positive: 0, neutral: 0, negative: 0 } as Record<Sentiment, number>;
  for (const x of s) counts[x]++;
  const max = Math.max(counts.positive, counts.neutral, counts.negative);
  const leaders = SENTIMENTS.filter((k) => counts[k] === max);
  return leaders.length === 1 ? leaders[0] : "mixed";
}
