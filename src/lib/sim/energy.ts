/**
 * ENERGY domain simulator — winter heat + electricity for Ulaanbaatar.
 *
 * The central tension: UB's catastrophic winter PM2.5 comes mostly from
 * raw-coal ger-district stoves. Electrifying that heat cleans the air, but it
 * dumps load onto a grid that already peaks near its capacity ceiling in the
 * deep cold. This module quantifies that tradeoff and flags grid-investment
 * risk when headroom collapses.
 *
 * Pure / deterministic: every number is derived from the scenario params and
 * the real city data — no randomness, no clocks, no I/O.
 */
import type {
  Scenario,
  CityData,
  DomainResult,
  Metric,
  Insight,
  ChoroplethOverlay,
  ImpactLevel,
  MetricFormat,
} from "@/lib/types";
import { TOTAL_HOUSEHOLDS } from "@/lib/city";

/* ── Winter baselines (typical UB cold-season day) ──────────────────────────
 * Peak grid load ~1150 MW against ~1300 MW installed/available capacity, so
 * headroom is razor-thin (~11.5%). Coal includes CHP plants + ger stoves. */
const BASE_PEAK_MW = 1150;
const GRID_CAPACITY_MW = 1300;
const BASE_COAL_TONS = 14000; // tons/day, CHP + ger stoves combined
const BASE_HEAT_ELEC_GWH = 19; // GWh/day of electric heating demand

/* Sensitivity of a full coal->electric switch (coalToElectric = 1.0):
 * each 0.10 step removes ~1500 t/day coal and adds ~120 MW peak + ~2.4 GWh. */
const COAL_REMOVED_PER_UNIT = 15000; // tons/day at coalToElectric = 1
const PEAK_ADDED_PER_UNIT = 1200; // MW at coalToElectric = 1
const HEAT_GWH_ADDED_PER_UNIT = 24; // GWh/day at coalToElectric = 1

/* Secondary electricity loads (small vs. heating electrification). */
const EV_PEAK_PER_UNIT = 90; // MW at evAdoption = 1 (overnight + daytime charging)
const EV_GWH_PER_UNIT = 5; // GWh/day at evAdoption = 1
const PEAK_PER_E_BUS = 0.05; // MW of depot charging per electric bus
const REMOTE_DAY_PEAK_MW = 6; // MW shed per gov remote-work day (office HVAC/lighting)

const headroomPct = (peak: number): number =>
  ((GRID_CAPACITY_MW - peak) / GRID_CAPACITY_MW) * 100;

/** Build one fully-populated Metric, computing delta/deltaPct/direction. */
function metric(
  key: string,
  label: string,
  baseline: number,
  predicted: number,
  unit: string,
  format: MetricFormat,
  /** sentiment when predicted rises above baseline. */
  upSentiment: ImpactLevel,
  /** sentiment when predicted falls below baseline. */
  downSentiment: ImpactLevel,
): Metric {
  const delta = predicted - baseline;
  // Guard divide-by-zero; a zero baseline yields 0% rather than Infinity/NaN.
  const deltaPct = baseline === 0 ? 0 : (delta / baseline) * 100;
  const EPS = 1e-9;
  const direction: Metric["direction"] =
    delta > EPS ? "up" : delta < -EPS ? "down" : "flat";
  const sentiment: ImpactLevel =
    direction === "flat" ? "neutral" : direction === "up" ? upSentiment : downSentiment;
  return { key, label, baseline, predicted, unit, delta, deltaPct, direction, sentiment, format };
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * ENERGY simulation: shift ger coal heat to the grid, layer on EV/bus/remote
 * loads, then recompute peak load, coal, headroom and heating-electricity.
 */
export function simulateEnergy(scenario: Scenario, city: CityData): DomainResult {
  const p = scenario.params;
  const coalToElectric = clamp01(typeof p.coalToElectric === "number" ? p.coalToElectric : 0);
  const evAdoption = clamp01(typeof p.evAdoption === "number" ? p.evAdoption : 0);
  const addBuses = typeof p.addBuses === "number" ? Math.max(0, p.addBuses) : 0;
  const electricBuses = p.electricBuses === true;
  const remoteWorkDays =
    typeof p.remoteWorkDays === "number" ? Math.max(0, Math.min(5, p.remoteWorkDays)) : 0;

  /* ── Heating electrification: the dominant lever ───────────────────────── */
  const coalRemoved = COAL_REMOVED_PER_UNIT * coalToElectric;
  const heatPeakAdded = PEAK_ADDED_PER_UNIT * coalToElectric;
  const heatGwhAdded = HEAT_GWH_ADDED_PER_UNIT * coalToElectric;

  /* ── Secondary loads (much smaller than heating) ───────────────────────── */
  const evPeakAdded = EV_PEAK_PER_UNIT * evAdoption;
  const evGwhAdded = EV_GWH_PER_UNIT * evAdoption;
  const busPeakAdded = electricBuses ? addBuses * PEAK_PER_E_BUS : 0;
  const remotePeakShed = remoteWorkDays * REMOTE_DAY_PEAK_MW;

  /* ── Recompute headline figures ────────────────────────────────────────── */
  const predictedPeak = round(
    BASE_PEAK_MW + heatPeakAdded + evPeakAdded + busPeakAdded - remotePeakShed,
    0,
  );
  const predictedCoal = round(Math.max(0, BASE_COAL_TONS - coalRemoved), 0);
  const predictedHeatElec = round(BASE_HEAT_ELEC_GWH + heatGwhAdded + evGwhAdded, 1);
  const baseHeadroom = round(headroomPct(BASE_PEAK_MW), 1);
  const predictedHeadroom = round(headroomPct(predictedPeak), 1);

  /* ── Per-district added electric heating load (choropleth) ─────────────────
   * Each district's share of new heating load ∝ its raw-coal ger households,
   * i.e. households * gerHouseholdShare. Distribute heatPeakAdded by weight. */
  const weights = city.districts.map((d) => ({
    slug: d.slug,
    weight: d.households * d.gerHouseholdShare,
  }));
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0) || 1;
  const districtMw = weights
    .map((w) => ({ slug: w.slug, mw: round((heatPeakAdded * w.weight) / totalWeight, 1) }))
    .sort((a, b) => b.mw - a.mw);

  // Level by added-MW rank: the top third carry the most grid stress.
  const topCut = Math.max(1, Math.ceil(districtMw.length / 3));
  const maxMw = districtMw.length ? districtMw[0].mw : 0;
  const choro: ChoroplethOverlay = {
    kind: "choropleth",
    id: "energy-added-heat-load",
    title: "Added electric heating load by district",
    metricLabel: "Added peak load",
    unit: "MW",
    values: districtMw.map((d, i) => {
      let level: ImpactLevel;
      if (maxMw <= 0) {
        level = "neutral"; // no electrification → nothing to color
      } else if (i < topCut) {
        // Highest-load districts: bad if grid is already over-stressed.
        level = predictedHeadroom < 5 ? "bad" : "warn";
      } else {
        level = predictedHeadroom < 5 ? "neutral" : "good";
      }
      return {
        slug: d.slug,
        value: d.mw,
        level,
        note: d.mw > 0 ? `${d.mw} MW new heating load` : "no electrified heating",
      };
    }),
  };

  /* ── Metrics ───────────────────────────────────────────────────────────── */
  const metrics: Metric[] = [
    // Higher peak is bad (creeps toward the capacity ceiling).
    metric("peak-load", "Peak grid load", BASE_PEAK_MW, predictedPeak, "MW", "number", "bad", "good"),
    // Lower coal is good (cleaner air, the whole point).
    metric("coal-burned", "Coal burned", BASE_COAL_TONS, predictedCoal, "tons/day", "number", "bad", "good"),
    // Lower headroom is bad (less spare capacity → blackout / shortfall risk).
    metric("grid-headroom", "Grid headroom", baseHeadroom, predictedHeadroom, "%", "percent", "good", "bad"),
    // Heating electricity is contextual: it rises by design, neither praised nor penalized.
    metric(
      "heat-elec",
      "Heating electricity demand",
      BASE_HEAT_ELEC_GWH,
      predictedHeatElec,
      "GWh/day",
      "number",
      "neutral",
      "neutral",
    ),
  ];

  /* ── Insights: surface the tradeoff and the grid-investment caution ────── */
  const insights: Insight[] = [];
  // BASE_COAL_TONS is a fixed non-zero baseline, so this division is always safe.
  const coalPctCut = round((coalRemoved / BASE_COAL_TONS) * 100, 0);

  if (coalToElectric > 0) {
    insights.push({
      kind: "tradeoff",
      title: "Cleaner air vs. grid capacity",
      detail:
        `Switching ${round(coalToElectric * 100, 0)}% of ger coal heating to electric cuts coal ` +
        `~${coalPctCut}% (${round(coalRemoved, 0)} t/day) — a major winter PM2.5 win — but adds ` +
        `~${round(heatPeakAdded, 0)} MW to a ${BASE_PEAK_MW} MW winter peak, dropping grid headroom ` +
        `from ${baseHeadroom}% to ${predictedHeadroom}%.`,
    });
  } else {
    insights.push({
      kind: "finding",
      title: "Heating still coal-bound",
      detail:
        `No coal-to-electric switch in this scenario, so winter peak load holds near ` +
        `${BASE_PEAK_MW} MW and coal stays at ~${BASE_COAL_TONS} t/day. Air-quality gains here ` +
        `would require electrifying ger-district heat.`,
    });
  }

  if (predictedHeadroom < 0) {
    insights.push({
      kind: "caution",
      title: "Grid demand exceeds capacity",
      detail:
        `Projected peak ${predictedPeak} MW overshoots the ~${GRID_CAPACITY_MW} MW ceiling ` +
        `(headroom ${predictedHeadroom}%). Electrification at this pace is infeasible without new ` +
        `generation/imports — phase the rollout and pair it with grid upgrades.`,
    });
  } else if (predictedHeadroom < 5) {
    const topNames = districtMw
      .slice(0, topCut)
      .map((d) => city.districts.find((c) => c.slug === d.slug)?.name ?? d.slug)
      .join(", ");
    insights.push({
      kind: "recommendation",
      title: "Phase the rollout; upgrade the grid first",
      detail:
        `Headroom falls to ${predictedHeadroom}% (below the ~5% safety margin). Stagger ` +
        `electrification — start where load concentrates (${topNames}) — and add capacity / ` +
        `demand-response before the next cold snap to avoid winter shortfalls.`,
    });
  } else if (coalToElectric > 0) {
    insights.push({
      kind: "recommendation",
      title: "Capacity holds — accelerate where feasible",
      detail:
        `Even after electrification the grid keeps ${predictedHeadroom}% headroom, so this pace is ` +
        `serviceable. Expand the clean-heat switch district by district while monitoring the ` +
        `winter peak against the ${GRID_CAPACITY_MW} MW ceiling.`,
    });
  }

  const secondaryLoad = evPeakAdded + busPeakAdded;
  if (secondaryLoad > 0) {
    insights.push({
      kind: "finding",
      title: "EV / electric-bus load is secondary",
      detail:
        `EVs and electric buses add ~${round(secondaryLoad, 1)} MW — small beside heating ` +
        `electrification, but it stacks on the same winter peak. Favor off-peak (overnight) ` +
        `charging to protect evening headroom.`,
    });
  }

  /* ── Headline ──────────────────────────────────────────────────────────── */
  const headline =
    coalToElectric > 0
      ? `Coal −${coalPctCut}% to ${predictedCoal.toLocaleString()} t/day; peak ${predictedPeak} MW, ` +
        `grid headroom ${predictedHeadroom}%${predictedHeadroom < 5 ? " (tight)" : ""}`
      : `Energy roughly steady: peak ${predictedPeak} MW, coal ~${predictedCoal.toLocaleString()} t/day, ` +
        `headroom ${predictedHeadroom}%`;

  return {
    domain: "energy",
    headline,
    metrics,
    overlays: [choro],
    insights,
  };
}
