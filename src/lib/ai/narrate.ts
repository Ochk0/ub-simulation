/**
 * LLM analyst layer (DeepSeek).
 *
 * After the deterministic engine computes the numbers, DeepSeek writes the
 * human-facing briefing and recommendations — grounded ONLY in the figures we
 * hand it (it explains real results, it does not generate statistics). On any
 * failure the caller keeps the template summary, so the demo never breaks.
 */
import type { Scenario, SimulationResult, Insight } from "@/lib/types";
import { formatValue, signedPct } from "@/lib/format";
import { deepseekJSON, isAIEnabled } from "./deepseek";

interface LLMNarrative {
  summary?: string;
  recommendations?: Array<{ title?: string; detail?: string }>;
}

const SYSTEM = `You are the analyst voice of "UB Twin AI", a digital twin of Ulaanbaatar used by city officials to test decisions before making them. You are handed the RESULTS of a deterministic simulation.

Write a crisp, credible briefing a mayor could read aloud. CRITICAL RULES:
- Use ONLY the numbers provided. Never invent or round-trip new statistics.
- Be specific and reference the actual figures and districts given.
- Name the key trade-off when there is one.
- No hype, no emojis, plain professional language.

Respond with JSON only:
{
  "summary": "3-4 sentence analysis",
  "recommendations": [ { "title": "imperative action (<=8 words)", "detail": "one concrete sentence" }, up to 3 ]
}`;

export async function aiNarrate(
  scenario: Scenario,
  result: SimulationResult
): Promise<{ summary: string; insights: Insight[] } | null> {
  if (!isAIEnabled()) return null;

  const ai = await deepseekJSON<LLMNarrative>(SYSTEM, buildFacts(scenario, result), {
    maxTokens: 650,
    temperature: 0.5,
  });
  if (!ai || typeof ai.summary !== "string" || !ai.summary.trim()) return null;

  const insights: Insight[] = Array.isArray(ai.recommendations)
    ? ai.recommendations
        .filter((r) => r && typeof r.title === "string" && r.title.trim())
        .slice(0, 3)
        .map((r) => ({
          kind: "recommendation" as const,
          title: String(r.title).trim(),
          detail: String(r.detail ?? "").trim(),
        }))
    : [];

  return { summary: ai.summary.trim(), insights };
}

/** Compact, factual brief of the computed simulation for the model to explain. */
function buildFacts(scenario: Scenario, result: SimulationResult): string {
  const lines: string[] = [];
  lines.push(`City: Ulaanbaatar, Mongolia.`);
  lines.push(`Scenario: ${scenario.title}`);
  lines.push(`Original question: ${scenario.prompt}`);
  lines.push(`Affected systems: ${scenario.domains.join(", ")}`);
  lines.push("");
  lines.push("Headline metrics (baseline -> predicted):");
  for (const m of result.primaryMetrics) {
    lines.push(
      `- ${m.label}: ${formatValue(m.baseline, m.format, m.unit)} -> ` +
        `${formatValue(m.predicted, m.format, m.unit)} (${signedPct(m.deltaPct)}, ${m.sentiment} for the city)`
    );
  }
  lines.push("");
  lines.push("Per-system findings:");
  for (const d of result.domains) {
    lines.push(`- ${d.domain}: ${d.headline}`);
    for (const i of d.insights.slice(0, 2)) lines.push(`    · ${i.title}: ${i.detail}`);
  }
  if (result.risks?.length) {
    lines.push("");
    lines.push(`Most urgent predicted risk: ${result.risks[0].title} — ${result.risks[0].detail}`);
  }
  if (result.budget) {
    const b = result.budget;
    const fmtT = (n: number) => `₮${(n / 1e9).toFixed(1)}B`;
    lines.push("");
    lines.push(
      `Cost case (indicative): capital ${fmtT(b.capitalCost)}, annual cost ${fmtT(b.annualCost)}, ` +
        `annual benefit ${fmtT(b.annualBenefit)}, payback ${b.paybackYears == null ? "none" : b.paybackYears + " yrs"} ` +
        `(benefit/cost ${b.benefitCostRatio.toFixed(1)}× over ${b.horizonYears}y). ${b.verdict}`
    );
  }
  if (result.publicSignal && result.publicSignal.matched.length) {
    lines.push("");
    lines.push(`Real public opinion (crawled from tsaaguur.mn): ${result.publicSignal.headline}`);
    for (const m of result.publicSignal.matched.slice(0, 3)) {
      lines.push(`- "${m.topic.title}" — ${m.topic.sentiment} sentiment, ${m.topic.reactions} reactions (${m.relevance})`);
    }
    lines.push(
      "In ONE sentence of the summary, note how this public sentiment aligns with or complicates the projected impact."
    );
  }
  lines.push("");
  lines.push("Return JSON only.");
  return lines.join("\n");
}
