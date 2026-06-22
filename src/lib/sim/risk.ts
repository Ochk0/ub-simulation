/**
 * UB Twin AI — Future Risk Radar.
 *
 * The proactive "what's coming" feed. Unlike the domain simulators (which model
 * the *effect* of a policy), this module projects a believable baseline city
 * risk feed for the next ~24h — Peace Avenue congestion, the nightly winter
 * PM2.5 spike, AM bus overload, junction accident risk, the evening grid peak,
 * and flash-flood exposure in low-lying ger areas — and then nudges each item's
 * SEVERITY by how the current scenario actually moved the relevant domain.
 *
 * A scenario that improves traffic should visibly calm the traffic/accident
 * warnings; one that worsens air quality should keep the pollution/flood
 * warnings hot. The result is purely deterministic — every number derives from
 * the scenario, the city, and the domain results.
 */
import type {
  Scenario,
  CityData,
  DomainResult,
  RiskPrediction,
  ImpactLevel,
  SimDomain,
  Metric,
} from "@/lib/types";
import { PLACES } from "@/lib/constants";
import { districtBySlug } from "@/lib/city";

/* ──────────────────────────────────────────────────────────────────────────
 * Severity helpers — a small ordered ladder so we can step risks up/down.
 * "low" risk maps to ImpactLevel "neutral" (no dedicated low level exists).
 * ────────────────────────────────────────────────────────────────────────── */

/** Ascending order of badness; index used to step severities up and down. */
const LADDER: ImpactLevel[] = ["good", "neutral", "warn", "bad"];

function downgrade(level: ImpactLevel): ImpactLevel {
  const i = LADDER.indexOf(level);
  return LADDER[Math.max(0, i - 1)];
}

function upgrade(level: ImpactLevel): ImpactLevel {
  const i = LADDER.indexOf(level);
  return LADDER[Math.min(LADDER.length - 1, i + 1)];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Domain signal — read each domain's PRIMARY metric and decide whether the
 * policy made things clearly better, clearly worse, or roughly neutral.
 * ────────────────────────────────────────────────────────────────────────── */

type Signal = "better" | "worse" | "neutral";

/** Primary metric key we trust most per domain (substring match, tolerant). */
const PRIMARY_KEY: Partial<Record<SimDomain, string>> = {
  traffic: "congestion",
  pollution: "pm2.5",
  transit: "utilization",
  energy: "grid",
};

/** Pick the most relevant metric for a domain, falling back to the first one. */
function primaryMetric(result: DomainResult): Metric | undefined {
  const wanted = PRIMARY_KEY[result.domain];
  if (wanted) {
    const hit = result.metrics.find(
      (m) =>
        m.key.toLowerCase().includes(wanted) ||
        m.label.toLowerCase().includes(wanted),
    );
    if (hit) return hit;
  }
  // Fall back to the metric with the largest magnitude change.
  return result.metrics
    .slice()
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))[0];
}

/**
 * Classify how a domain moved. A change only counts as "better"/"worse" when
 * it is both directionally meaningful (>~5% vs baseline) and the simulator
 * itself judged the sentiment good/bad for the city.
 */
function domainSignal(result: DomainResult | undefined): Signal {
  if (!result) return "neutral";
  const m = primaryMetric(result);
  if (!m) return "neutral";
  const big = Math.abs(m.deltaPct) >= 5;
  if (big && m.sentiment === "good") return "better";
  if (big && m.sentiment === "bad") return "worse";
  // Even sub-threshold moves with a clear bad sentiment keep pressure on.
  if (m.sentiment === "bad" && Math.abs(m.deltaPct) >= 1) return "worse";
  return "neutral";
}

/** Adjust a baseline severity by a domain signal, returning the new level. */
function adjust(baseline: ImpactLevel, signal: Signal): ImpactLevel {
  if (signal === "better") return downgrade(baseline);
  if (signal === "worse") return upgrade(baseline);
  return baseline;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Geometry — resolve a believable ger-heavy district centre for the nightly
 * PM2.5 spike from REAL district metadata (highest raw-coal heating share).
 * ────────────────────────────────────────────────────────────────────────── */

function gerHotspot(city: CityData): { lat: number; lng: number; label: string } {
  // Among real districts, the one with the highest ger-coal heating share is
  // the dominant winter PM2.5 source; prefer a populous one to be believable.
  const ranked = city.districts
    .filter((d) => d.population > 50_000)
    .slice()
    .sort((a, b) => b.gerHouseholdShare - a.gerHouseholdShare);
  const top = ranked[0] ?? districtBySlug("songinokhairkhan");
  if (top) return { lat: top.center.lat, lng: top.center.lng, label: top.name };
  // Defensive fallback to a well-known ger-belt place.
  return PLACES["songinokhairkhan"];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Detail text — phrase the sentence to reflect the adjustment when relevant.
 * ────────────────────────────────────────────────────────────────────────── */

function phrase(base: string, signal: Signal): string {
  if (signal === "better") return `${base}, but mitigated by the simulated policy.`;
  if (signal === "worse") return `${base}, and amplified by the simulated policy.`;
  return `${base}.`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main entry — build the six-item baseline feed, severity-adjusted in place.
 * Never throws; with no domains it returns the untouched baseline radar.
 * ────────────────────────────────────────────────────────────────────────── */

export function predictRisks(
  scenario: Scenario,
  city: CityData,
  domains: DomainResult[],
): RiskPrediction[] {
  // Index domain results so each risk can find its driver in O(1).
  const byDomain = new Map<SimDomain, DomainResult>();
  for (const d of domains ?? []) byDomain.set(d.domain, d);

  const sig = (dom: SimDomain): Signal => domainSignal(byDomain.get(dom));

  // Accident risk tracks traffic; flood/pollution share the air-quality driver.
  const trafficSig = sig("traffic");
  const pollutionSig = sig("pollution");
  const transitSig = sig("transit");
  const energySig = sig("energy");

  const peace = PLACES["peace avenue"];
  const square = PLACES["sukhbaatar square"];
  const ger = gerHotspot(city);

  const risks: RiskPrediction[] = [
    {
      // 1 — Central congestion is the chronic UB pain point; tracks traffic.
      id: "risk-peace-ave-congestion",
      kind: "traffic",
      severity: adjust("bad", trafficSig),
      etaMinutes: 45,
      title: "Congestion building on Peace Avenue",
      detail: phrase(
        "Eastbound flow on Peace Avenue (Энх Тайвны өргөн чөлөө) is forecast to choke near rush hour",
        trafficSig,
      ),
      location: { ...peace },
    },
    {
      // 2 — The nightly winter PM2.5 spike from raw-coal ger heating.
      id: "risk-night-pm25-spike",
      kind: "pollution",
      severity: adjust("bad", pollutionSig),
      etaMinutes: 360,
      title: "Air-quality spike expected tonight",
      detail: phrase(
        `PM2.5 in ${ger.label} is projected to climb past 200 µg/m³ after dark as ger-area coal stoves fire up (WHO 24h guideline 15)`,
        pollutionSig,
      ),
      location: { lat: ger.lat, lng: ger.lng, label: ger.label },
    },
    {
      // 3 — Morning bus crush; tracks transit utilization.
      id: "risk-am-bus-overload",
      kind: "transit",
      severity: adjust("warn", transitSig),
      etaMinutes: 840,
      title: "Bus overload forecast — tomorrow AM peak",
      detail: phrase(
        "Trunk routes into downtown are projected to exceed seated capacity through the 08:00 peak",
        transitSig,
      ),
      location: { ...peace, label: "Downtown corridor" },
    },
    {
      // 4 — Junction accident exposure rises and falls with traffic load.
      id: "risk-sukhbaatar-junction-accident",
      kind: "accident",
      severity: adjust("warn", trafficSig),
      etaMinutes: 90,
      title: "Elevated accident risk at Sukhbaatar Square junction",
      detail: phrase(
        "Turning conflicts around Sükhbaatar Square raise collision odds during the build-up to rush hour",
        trafficSig,
      ),
      location: { ...square },
    },
    {
      // 5 — Evening heating + lighting load nears grid capacity.
      id: "risk-evening-grid-peak",
      kind: "energy",
      severity: adjust("warn", energySig),
      etaMinutes: 300,
      title: "Evening grid demand peak approaching capacity",
      detail: phrase(
        "Combined heating and lighting load is projected to approach the evening supply ceiling",
        energySig,
      ),
      location: { lat: ger.lat, lng: ger.lng, label: ger.label },
    },
    {
      // 6 — Flash-flood exposure in low-lying ger areas; shares pollution's
      // ger-belt driver, so cleaner-heat policies that thin the ger belt help.
      id: "risk-ger-flash-flood",
      kind: "flood",
      severity: adjust("neutral", pollutionSig), // baseline "low" → neutral
      etaMinutes: 1440,
      title: "Flash-flood risk in low-lying ger areas after forecast rain",
      detail: phrase(
        `Forecast rain could pond in unsewered low-lying ger areas around ${ger.label}`,
        pollutionSig,
      ),
      location: { lat: ger.lat, lng: ger.lng, label: ger.label },
    },
  ];

  return risks;
}
