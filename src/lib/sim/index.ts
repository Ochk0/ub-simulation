/**
 * Simulation engine orchestrator.
 *
 * Routes a parsed {@link Scenario} to the relevant domain modules, merges their
 * outputs into a single {@link SimulationResult}, generates the narrative
 * summary (the "AI insight" stub — swap in an LLM later), and computes the
 * proactive risk feed and map focus.
 */
import type {
  Scenario,
  SimulationResult,
  DomainResult,
  Metric,
  SimDomain,
  DomainSimulator,
  CityData,
} from "@/lib/types";
import { getCityData } from "@/lib/city";
import { formatValue, signedPct } from "@/lib/format";
import { MAP_DEFAULT, PLACES } from "@/lib/constants";

import { simulateTraffic } from "./traffic";
import { simulatePollution } from "./pollution";
import { simulateEmergency } from "./emergency";
import { simulateEnergy } from "./energy";
import { simulateTransit } from "./transit";
import { predictRisks } from "./risk";
import { estimateBudget } from "./budget";

const SIMS: Record<SimDomain, DomainSimulator> = {
  traffic: simulateTraffic,
  pollution: simulatePollution,
  emergency: simulateEmergency,
  energy: simulateEnergy,
  transit: simulateTransit,
};

/** Run a scenario end-to-end and return the renderable result. */
export function runSimulation(
  scenario: Scenario,
  city: CityData = getCityData()
): SimulationResult {
  const order = dedupeDomains(scenario.domains);
  const domains: DomainResult[] = order.map((d) => SIMS[d](scenario, city));

  const primaryMetrics = pickPrimary(domains);
  const overlays = domains.flatMap((d) => d.overlays);
  const insights = domains.flatMap((d) => d.insights).slice(0, 6);
  const risks = predictRisks(scenario, city, domains);
  const summary = narrate(scenario, domains, primaryMetrics);
  const confidence = Math.min(0.97, 0.6 + scenario.parseConfidence * 0.35);
  const mapFocus = focusFor(scenario);

  const result: SimulationResult = {
    scenario,
    summary,
    primaryMetrics,
    domains,
    overlays,
    insights,
    risks,
    confidence,
    mapFocus,
  };
  result.budget = estimateBudget(scenario, result);
  return result;
}

function dedupeDomains(ds: SimDomain[]): SimDomain[] {
  const seen = new Set<SimDomain>();
  const out: SimDomain[] = [];
  for (const d of ds) if (SIMS[d] && !seen.has(d)) (seen.add(d), out.push(d));
  return out.length ? out : ["traffic"];
}

const significance = (m: Metric) => Math.abs(m.deltaPct);

/** Ensure a fragment reads as a sentence when joined into the summary. */
const endSentence = (t: string) => {
  const x = t.trim();
  return /[.!?;]$/.test(x) ? x : x + ".";
};

/** One headline metric per domain (largest movement), then fill to 4. */
function pickPrimary(domains: DomainResult[]): Metric[] {
  const perDomain = domains
    .map((d) => [...d.metrics].sort((a, b) => significance(b) - significance(a))[0])
    .filter(Boolean) as Metric[];
  const rest = domains
    .flatMap((d) => d.metrics)
    .filter((m) => !perDomain.includes(m))
    .sort((a, b) => significance(b) - significance(a));
  const out: Metric[] = [];
  for (const m of [...perDomain, ...rest]) {
    if (out.length >= 4) break;
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** Template-based narrative — the human-readable "AI analysis" paragraph. */
function narrate(scenario: Scenario, domains: DomainResult[], primary: Metric[]): string {
  const s: string[] = [];
  const sys =
    domains.length > 1 ? `${domains.length} interconnected systems` : "the targeted system";
  s.push(`Running "${scenario.title}" through Ulaanbaatar's digital twin across ${sys}.`);

  const top = primary[0];
  if (top) {
    s.push(
      top.baseline === 0
        ? `The model projects ${top.label.toLowerCase()} of ${formatValue(top.predicted, top.format, top.unit)}.`
        : `The model projects ${top.label.toLowerCase()} moving from ` +
            `${formatValue(top.baseline, top.format, top.unit)} to ` +
            `${formatValue(top.predicted, top.format, top.unit)} (${signedPct(top.deltaPct)}).`
    );
  }

  for (const h of domains.map((d) => d.headline).filter(Boolean).slice(0, 2)) s.push(endSentence(h));

  const good = primary.filter((m) => m.sentiment === "good").length;
  const bad = primary.filter((m) => m.sentiment === "bad").length;
  s.push(
    good > bad
      ? "Net impact is positive — a strong candidate for a pilot study."
      : bad > good
        ? "This introduces real tradeoffs — mitigation measures are advised before rollout."
        : "Impact is mixed; pair with complementary measures to maximize net benefit."
  );
  return s.join(" ");
}

/** Where to fly the map to highlight the scenario. */
function focusFor(scenario: Scenario): SimulationResult["mapFocus"] {
  const p = scenario.params;
  if (p.addStation?.at) return { ...p.addStation.at, zoom: 13 };
  if (p.addStation?.place) {
    const pl = PLACES[p.addStation.place.toLowerCase()];
    if (pl) return { lat: pl.lat, lng: pl.lng, zoom: 13 };
  }
  if (p.roadClosure) {
    const pl = PLACES[p.roadClosure.toLowerCase()] ?? PLACES["peace avenue"];
    if (pl) return { lat: pl.lat, lng: pl.lng, zoom: 13 };
  }
  // Corridor signal scenarios center on Peace Avenue so the recolored arterial reads clearly.
  if (p.adaptiveSignals) {
    const pl = PLACES["peace avenue"];
    return { lat: pl.lat, lng: pl.lng, zoom: 13 };
  }
  return { lat: MAP_DEFAULT.center.lat, lng: MAP_DEFAULT.center.lng, zoom: MAP_DEFAULT.zoom };
}
