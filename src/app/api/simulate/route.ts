/**
 * Simulation endpoint.
 *
 * Pipeline: natural language → (DeepSeek interpret | rule-based parse) →
 * deterministic engine → (DeepSeek analyst | template narrative). The LLM steps
 * degrade gracefully: if no key is set or a call fails, the rule-based/template
 * paths produce a complete result, so the endpoint always returns 200.
 */
import { NextResponse } from "next/server";
import type { Scenario, SimulationResult } from "@/lib/types";
import { parseScenario } from "@/lib/scenarios";
import { runSimulation } from "@/lib/sim";
import { interpretScenario } from "@/lib/ai/interpret";
import { aiNarrate } from "@/lib/ai/narrate";
import { getCitizenPulse, matchTrendsToScenario } from "@/lib/social/tsaaguur";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      prompt?: string;
      scenario?: Scenario;
      /** Set false to force the deterministic path (skip LLM). */
      useAI?: boolean;
    };

    const useAI = body.useAI !== false;

    // 1. Understand the request.
    const scenario: Scenario =
      body.scenario && typeof body.scenario === "object"
        ? body.scenario
        : useAI
          ? await interpretScenario(String(body.prompt ?? ""))
          : parseScenario(String(body.prompt ?? ""));

    // 2. Run the deterministic engine (the trustworthy numbers).
    const result: SimulationResult = runSimulation(scenario);

    // 2b. Cross-reference real public opinion (tsaaguur.mn civic pulse).
    try {
      result.publicSignal = matchTrendsToScenario(scenario, await getCitizenPulse());
    } catch (e) {
      console.warn("pulse match failed", (e as Error).message);
    }

    // 3. Let the LLM analyst explain the real results.
    if (useAI) {
      const ai = await aiNarrate(scenario, result);
      if (ai) {
        result.summary = ai.summary;
        result.insights = dedupeInsights([...ai.insights, ...result.insights]).slice(0, 7);
        result.aiPowered = true;
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("simulate error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Drop near-duplicate recommendation titles so AI + engine insights don't repeat. */
function dedupeInsights<T extends { title: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
