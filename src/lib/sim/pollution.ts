/**
 * UB Twin AI — Air Quality (winter PM2.5) simulation.
 *
 * Ulaanbaatar suffers some of the worst winter air on Earth. The dominant
 * driver is raw-coal heating in the ger (yurt) districts: tens of thousands of
 * households burn unprocessed coal through the long, cold winter, pushing daily
 * PM2.5 well past 150–300 µg/m³ versus the WHO guideline of 15.
 *
 * Model (per district):
 *   baseline PM2.5 = 45 (background: traffic/dust/regional) + coalComponent
 *   coalComponent  = gerHouseholdShare * 270   (the REDUCIBLE part)
 * City average is population-weighted over districts.
 *
 * Policy levers (ScenarioParams):
 *   coalToElectric  — MAIN lever; removes fraction f of every district's coal.
 *   evAdoption      — small cut to the traffic share of background.
 *   electricBuses + addBuses — small cut to the traffic share of background.
 *   remoteWorkDays  — fewer commutes, small cut to traffic share of background.
 *
 * Pure & deterministic: no Math.random, no Date.now, no side effects.
 */
import type {
  Scenario,
  CityData,
  DistrictMeta,
  DomainResult,
  Metric,
  ChoroplethOverlay,
  HeatOverlay,
  ImpactLevel,
  Insight,
  MetricFormat,
} from "@/lib/types";
import { TOTAL_POPULATION } from "@/lib/city";

/** Background PM2.5 floor (traffic + dust + regional transport), µg/m³. */
const BACKGROUND = 45;
/** Full coal component when 100% of households burn raw coal, µg/m³. */
const COAL_FULL = 270;
/** Hazardous-air threshold for population exposure, µg/m³. */
const HAZARD_PM = 100;
/**
 * Healthcare cost per person per µg/m³ of annual average PM2.5, in ₮.
 * Rough public-health proxy: respiratory/cardio admissions, lost workdays.
 */
const HEALTH_COST_PER_PERSON_PER_UG = 5200;

/** Clamp a value into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Signed % change vs baseline, guarding divide-by-zero. */
function pct(baseline: number, predicted: number): number {
  if (baseline === 0) return predicted === 0 ? 0 : 100;
  return ((predicted - baseline) / baseline) * 100;
}

/** Choropleth level thresholds for a PM2.5 value. */
function pmLevel(pm: number): ImpactLevel {
  if (pm > 150) return "bad";
  if (pm >= 75) return "warn";
  return "good";
}

/** Build a fully-populated Metric, deriving delta/direction/sentiment. */
function metric(
  key: string,
  label: string,
  baseline: number,
  predicted: number,
  unit: string,
  format: MetricFormat,
  // For most air metrics a DROP is good; savings invert this.
  lowerIsBetter: boolean,
): Metric {
  const delta = predicted - baseline;
  const direction = delta > 0.0001 ? "up" : delta < -0.0001 ? "down" : "flat";
  let sentiment: ImpactLevel = "neutral";
  if (direction !== "flat") {
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    sentiment = improved ? "good" : "bad";
  }
  return {
    key,
    label,
    baseline,
    predicted,
    unit,
    delta,
    deltaPct: pct(baseline, predicted),
    direction,
    sentiment,
    format,
  };
}

/** Baseline PM2.5 for a district from its ger-heating share. */
function baselinePM(d: DistrictMeta): number {
  return BACKGROUND + d.gerHouseholdShare * COAL_FULL;
}

export function simulatePollution(scenario: Scenario, city: CityData): DomainResult {
  const p = scenario.params;
  const districts = city.districts;

  // ── Read levers, clamped to sane ranges ──────────────────────────────────
  const coalToElectric = clamp(p.coalToElectric ?? 0, 0, 1); // MAIN lever
  const evAdoption = clamp(p.evAdoption ?? 0, 0, 1);
  const remoteWorkDays = clamp(p.remoteWorkDays ?? 0, 0, 5);
  const addBuses = Math.max(0, p.addBuses ?? 0);
  const electricBuses = p.electricBuses === true;

  // ── Background (traffic) reduction: a few % from EV / e-buses / remote work ──
  // Each lever shaves a small slice of the 45 µg/m³ background floor. Capped so
  // these secondary levers never dominate the coal story.
  const evCut = evAdoption * 0.06; // up to 6% of background at full EV adoption
  const busCut = electricBuses ? clamp(addBuses / 1000, 0, 1) * 0.03 : 0; // up to 3%
  const remoteCut = (remoteWorkDays / 5) * 0.04; // up to 4% at 5 remote days
  const backgroundFactor = clamp(1 - (evCut + busCut + remoteCut), 0, 1);

  // ── Per-district prediction ──────────────────────────────────────────────
  // Coal component shrinks by `coalToElectric`; background shrinks by the
  // small traffic-side levers. At f=0.30 the city avg drops ~22% (coal is the
  // bulk of PM2.5 in ger-heavy districts).
  let baseWeighted = 0;
  let predWeighted = 0;
  let baselinePeak = 0;
  let predictedPeak = 0;
  let popHazardBase = 0;
  let popHazardPred = 0;

  const cells: HeatOverlay["cells"] = [];
  const choro: ChoroplethOverlay["values"] = [];

  // First pass: compute predicted PM per district + the smog-cell maximum.
  const rows = districts.map((d) => {
    const coalComponent = d.gerHouseholdShare * COAL_FULL;
    const base = BACKGROUND + coalComponent;
    const predicted =
      BACKGROUND * backgroundFactor + coalComponent * (1 - coalToElectric);
    return { d, base, predicted };
  });

  const maxPredPM = rows.reduce((m, r) => Math.max(m, r.predicted), 1);

  for (const { d, base, predicted } of rows) {
    baseWeighted += base * d.population;
    predWeighted += predicted * d.population;
    baselinePeak = Math.max(baselinePeak, base);
    predictedPeak = Math.max(predictedPeak, predicted);
    if (base > HAZARD_PM) popHazardBase += d.population;
    if (predicted > HAZARD_PM) popHazardPred += d.population;

    // Choropleth value = predicted PM2.5, colored by absolute air-quality bands.
    choro.push({
      slug: d.slug,
      value: round(predicted),
      level: pmLevel(predicted),
      note: `${round(predicted)} µg/m³ predicted (was ${round(base)})`,
    });

    // Winter-smog heat cell over the district centre, intensity ∝ predicted PM.
    cells.push({
      lat: d.center.lat,
      lng: d.center.lng,
      intensity: clamp(predicted / maxPredPM, 0, 1),
    });
  }

  const totalPop = TOTAL_POPULATION || districts.reduce((s, d) => s + d.population, 0) || 1;
  const cityBase = baseWeighted / totalPop;
  const cityPred = predWeighted / totalPop;

  // ── Healthcare savings: avoided annual cost from the avg PM2.5 reduction ──
  // Savings scale with how much cleaner the air gets × the exposed population.
  const avgDrop = Math.max(0, cityBase - cityPred); // µg/m³ improvement
  const savings = round(avgDrop * totalPop * HEALTH_COST_PER_PERSON_PER_UG);

  // ── Metrics (4) ───────────────────────────────────────────────────────────
  const metrics: Metric[] = [
    metric(
      "city-avg-pm25",
      "City avg PM2.5",
      round1(cityBase),
      round1(cityPred),
      "µg/m³",
      "number",
      true,
    ),
    metric(
      "peak-district-pm25",
      "Peak district PM2.5",
      round1(baselinePeak),
      round1(predictedPeak),
      "µg/m³",
      "number",
      true,
    ),
    metric(
      "pop-hazardous-air",
      "Population in hazardous air (>100 µg/m³)",
      popHazardBase,
      popHazardPred,
      "people",
      "number",
      true,
    ),
    // Savings: baseline 0 (status quo spend reference), predicted = savings.
    // Higher savings is GOOD for the city, so lowerIsBetter = false.
    metric(
      "healthcare-savings",
      "Est. annual healthcare savings",
      0,
      savings,
      "₮",
      "currency",
      false,
    ),
  ];

  // ── Overlays: one choropleth + one winter-smog heat layer ─────────────────
  const choropleth: ChoroplethOverlay = {
    kind: "choropleth",
    id: "pm25-choropleth",
    title: "Predicted winter PM2.5 by district",
    metricLabel: "PM2.5",
    unit: "µg/m³",
    values: choro,
  };
  const heat: HeatOverlay = {
    kind: "heat",
    id: "pm25-smog",
    title: "Winter smog intensity",
    cells,
    level: "bad", // winter smog is hazardous citywide even after mitigation
  };

  // ── Insights: always tie back to ger-district raw-coal heating ────────────
  const insights = buildInsights(
    coalToElectric,
    cityBase,
    cityPred,
    popHazardBase,
    popHazardPred,
    districts,
  );

  const pctDrop = Math.abs(pct(cityBase, cityPred));
  const headline =
    coalToElectric > 0
      ? `Converting ${Math.round(coalToElectric * 100)}% of ger coal heat cuts city PM2.5 ~${Math.round(pctDrop)}% to ${round1(cityPred)} µg/m³`
      : `No clean-heating action: city PM2.5 holds at ${round1(cityPred)} µg/m³, ${Math.round(cityPred / 15)}× WHO`;

  return {
    domain: "pollution",
    headline,
    metrics,
    overlays: [choropleth, heat],
    insights,
  };
}

/** Compose 1–2 insights, anchored on the raw-coal ger-heating source. */
function buildInsights(
  coalToElectric: number,
  cityBase: number,
  cityPred: number,
  popHazardBase: number,
  popHazardPred: number,
  districts: DistrictMeta[],
): Insight[] {
  const out: Insight[] = [];
  // Identify the most coal-dependent district to make it concrete.
  const worst = districts.reduce((a, b) =>
    b.gerHouseholdShare > a.gerHouseholdShare ? b : a,
  );

  if (coalToElectric <= 0) {
    out.push({
      kind: "finding",
      title: "Raw-coal ger heating dominates winter smog",
      detail:
        `With no clean-heating intervention, city PM2.5 stays near ${round1(cityPred)} µg/m³ — ` +
        `roughly ${Math.round(cityPred / 15)}× the WHO guideline. ${worst.name} (~${Math.round(worst.gerHouseholdShare * 100)}% ger coal heating) remains the worst hotspot.`,
    });
    out.push({
      kind: "recommendation",
      title: "Target ger-district heating to move the needle",
      detail:
        "Background traffic/dust is only ~45 µg/m³; the reducible bulk is raw-coal ger heating. " +
        "Converting even 30% of ger households to electric/clean heat would cut city PM2.5 by roughly a fifth.",
    });
    return out;
  }

  const peopleOut = popHazardBase - popHazardPred;
  out.push({
    kind: "finding",
    title: `Clean-heat conversion clears ger-district smog`,
    detail:
      `Switching ${Math.round(coalToElectric * 100)}% of raw-coal ger heating drops city PM2.5 from ` +
      `${round1(cityBase)} to ${round1(cityPred)} µg/m³` +
      (peopleOut > 0
        ? `, pulling ~${Math.round(peopleOut).toLocaleString("en-US")} people out of hazardous (>100 µg/m³) air.`
        : `. Heaviest gains land in ${worst.name}, the most coal-dependent ger district.`),
  });
  if (cityPred > 50) {
    out.push({
      kind: "tradeoff",
      title: "Cleaner, but still above WHO limits",
      detail:
        `Even after conversion, predicted PM2.5 (${round1(cityPred)} µg/m³) stays ~${Math.round(cityPred / 15)}× the WHO ` +
        "guideline. Full winter relief needs near-total ger-district heating conversion plus grid capacity to serve it.",
    });
  }
  return out;
}

/** Round to whole µg/m³ / people. */
function round(v: number): number {
  return Math.round(v);
}
/** Round to one decimal. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
