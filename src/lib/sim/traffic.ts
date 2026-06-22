/**
 * UB Twin AI — Traffic domain simulator.
 *
 * Models how a policy scenario reshapes Ulaanbaatar's notorious central
 * congestion: peak congestion index, cross-town travel time, bus punctuality
 * and road-transport CO2. Effects compose multiplicatively where it makes
 * physical sense (a closure and a bike shift both scale the same congestion
 * base), and the result is grounded in real OSM arterial geometry so the map
 * highlights the actual corridors that change.
 *
 * Pure & deterministic: no randomness, clock, or I/O. Every number is derived
 * from the scenario params + the loaded CityData.
 */
import type {
  Scenario,
  CityData,
  DomainResult,
  Metric,
  MetricFormat,
  ImpactLevel,
  Insight,
  RoadOverlay,
  LatLng,
} from "@/lib/types";
import { PLACES, MAP_DEFAULT } from "@/lib/constants";
import type { Feature } from "geojson";

/* Peak baselines for central Ulaanbaatar. */
const BASE = {
  congestion: 100, // composite index (100 = today's bad peak)
  travelTime: 38, // minutes, cross-town at peak
  busDelay: 14, // % of bus trips arriving late
  co2: 4200, // tons/day from road transport
};

/* ── geometry helpers ─────────────────────────────────────────────────────
 * GeoJSON coords are [lng, lat]; our LatLng is {lat, lng}. Keep the swap in
 * one place so the proximity math can't get the order wrong.
 */
function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t;
  const dLng = (b.lng - a.lng) * t;
  const la1 = a.lat * t;
  const la2 = b.lat * t;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Approximate a LineString feature by the lat/lng of its middle vertex. */
function featureMidpoint(f: Feature): LatLng | null {
  const g = f.geometry;
  if (!g || g.type !== "LineString" || g.coordinates.length === 0) return null;
  const c = g.coordinates[Math.floor(g.coordinates.length / 2)] as number[];
  return { lat: c[1], lng: c[0] };
}

/** Any localized name we can match a corridor query against. */
function featureName(f: Feature): string {
  const p = f.properties ?? {};
  return [p["name"], p["name:en"], p["name:mn"], p["ref"]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Resolve a corridor name to a focus point (known PLACES, else city centre). */
function resolveCorridor(name: string): { center: LatLng; label: string } {
  const key = name.trim().toLowerCase();
  const hit = PLACES[key] ?? PLACES["peace avenue"];
  // Direct PLACES hit, or fuzzy contains (e.g. "close peace avenue downtown").
  for (const [k, v] of Object.entries(PLACES)) {
    if (key.includes(k)) return { center: { lat: v.lat, lng: v.lng }, label: v.label };
  }
  return { center: { lat: hit.lat, lng: hit.lng }, label: hit.label };
}

const PEACE = { lat: PLACES["peace avenue"].lat, lng: PLACES["peace avenue"].lng };

function metric(
  key: string,
  label: string,
  baseline: number,
  predicted: number,
  unit: string,
  format: MetricFormat,
): Metric {
  // All four traffic metrics are "lower is better", so sentiment keys off sign.
  const delta = predicted - baseline;
  const deltaPct = baseline === 0 ? 0 : (delta / baseline) * 100;
  const direction = Math.abs(delta) < 1e-6 ? "flat" : delta > 0 ? "up" : "down";
  const sentiment: ImpactLevel =
    direction === "flat" ? "neutral" : delta < 0 ? "good" : "bad";
  return { key, label, baseline, predicted, unit, delta, deltaPct, direction, sentiment, format };
}

export function simulateTraffic(scenario: Scenario, city: CityData): DomainResult {
  const p = scenario.params;

  // Multiplicative factors start neutral; each present lever nudges them.
  let congestionF = 1;
  let travelTimeDelta = 0; // absolute minutes (signals give a fixed cut)
  let travelTimeF = 1; // proportional scaling (closure / bike shift)
  let busDelayF = 1;
  let co2F = 1;

  const roads = city.geo.roads.features;
  const overlayStatuses: RoadOverlay["statuses"] = [];
  let mapFocus: LatLng & { label: string } = {
    lat: MAP_DEFAULT.center.lat,
    lng: MAP_DEFAULT.center.lng,
    label: "Central Ulaanbaatar",
  };
  let corridorColored = false;

  // ── Adaptive signals: smarter green-waves on the main arterials. ─────────
  if (p.adaptiveSignals) {
    congestionF *= 1 - 0.18;
    travelTimeDelta -= 12;
    busDelayF *= 1 - 0.09;
    co2F *= 1 - 0.06;
    // Color the Peace Avenue corridor + nearby arterials GREEN (improved flow).
    for (const f of roads) {
      const mid = featureMidpoint(f);
      const id = f.properties?.id;
      if (!mid || id == null) continue;
      const onPeace = featureName(f).includes("энх тайв"); // Энх тайвны өргөн чөлөө
      const near = haversineM(PEACE, mid) <= 1500;
      if (onPeace || near) {
        overlayStatuses.push({ featureId: id, level: "good", note: "smart-signal corridor" });
      }
    }
    corridorColored = true;
    mapFocus = { ...PEACE, label: "Peace Avenue corridor" };
  }

  // ── Road closure: divert traffic citywide, jam the affected corridor. ────
  if (p.roadClosure) {
    travelTimeF *= 1 + 0.25;
    congestionF *= 1 + 0.22;
    busDelayF *= 1 + 0.2; // detoured buses fall further behind
    const corridor = resolveCorridor(p.roadClosure);
    const closureKey = p.roadClosure.trim().toLowerCase();
    for (const f of roads) {
      const mid = featureMidpoint(f);
      const id = f.properties?.id;
      if (!mid || id == null) continue;
      const nameHit =
        closureKey.length > 2 &&
        (featureName(f).includes(closureKey) || featureName(f).includes("энх тайв"));
      const d = haversineM(corridor.center, mid);
      if (nameHit || d <= 700) {
        overlayStatuses.push({ featureId: id, level: "bad", note: "closed / gridlocked" });
      } else if (d <= 1500) {
        overlayStatuses.push({ featureId: id, level: "warn", note: "spillover congestion" });
      }
    }
    corridorColored = true;
    mapFocus = { ...corridor.center, label: corridor.label };
  }

  // ── Modal shift to bikes: fewer cars in the core. ───────────────────────
  const bike = clamp01(p.modalShiftToBike);
  if (bike > 0) {
    congestionF *= 1 - bike * 0.6;
    travelTimeF *= 1 - bike * 0.45; // remaining car trips speed up
    co2F *= 1 - bike * 0.55;
  }

  // ── Schedule shift: spread the morning/evening peak. ────────────────────
  const shift = Math.max(0, Number(p.scheduleShiftHours) || 0);
  if (shift > 0) {
    congestionF *= 1 - Math.min(16, shift * 8) / 100;
    travelTimeF *= 1 - Math.min(0.06, shift * 0.03); // modest time relief
  }

  // ── Extra buses: marginally pull cars off the road. ─────────────────────
  const buses = Math.max(0, Number(p.addBuses) || 0);
  if (buses > 0) {
    congestionF *= 1 - Math.min(8, (buses / 50) * 4) / 100;
    busDelayF *= 1 - Math.min(0.05, (buses / 50) * 0.03); // less crowding, fewer late trips
  }

  // ── EV adoption: cleaner tailpipes, same number of cars. ────────────────
  const ev = clamp01(p.evAdoption);
  if (ev > 0) {
    co2F *= 1 - ev * 0.4;
  }

  // Compose predicted values from base × factors (+ absolute signal cut).
  const congestion = round1(BASE.congestion * congestionF);
  const travelTime = round1(BASE.travelTime * travelTimeF + travelTimeDelta);
  const busDelay = round1(BASE.busDelay * busDelayF);
  const co2 = round1(BASE.co2 * co2F);

  // If nothing colored a corridor (e.g. a pure-EV scenario), highlight a
  // representative subset of central arterials neutrally so the map isn't blank.
  if (!corridorColored) {
    let added = 0;
    for (const f of roads) {
      if (added >= 160) break;
      const mid = featureMidpoint(f);
      const id = f.properties?.id;
      if (!mid || id == null) continue;
      if (haversineM(PEACE, mid) <= 4000) {
        overlayStatuses.push({ featureId: id, level: "neutral" });
        added++;
      }
    }
  }

  const overlay: RoadOverlay = {
    kind: "roads",
    id: "traffic-roads",
    title: "Arterial network impact",
    statuses: overlayStatuses,
  };

  const metrics: Metric[] = [
    metric("congestionIndex", "Congestion index", BASE.congestion, congestion, "index", "index"),
    metric("avgTravelTime", "Avg peak travel time", BASE.travelTime, travelTime, "min", "minutes"),
    metric("busDelay", "Bus punctuality delay", BASE.busDelay, busDelay, "% late", "percent"),
    metric("trafficCO2", "Traffic CO₂", BASE.co2, co2, "tons/day", "number"),
  ];

  const insights = buildInsights(metrics, p, mapFocus.label);
  const headline = buildHeadline(metrics[0], metrics[1]);

  return { domain: "traffic", headline, metrics, overlays: [overlay], insights };
}

/* ── small utilities ──────────────────────────────────────────────────── */
function clamp01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildHeadline(congestion: Metric, travel: Metric): string {
  if (congestion.direction === "flat" && travel.direction === "flat") {
    return "Negligible traffic impact — congestion holds near today's peak.";
  }
  const cWord = congestion.delta < 0 ? "eases" : "worsens";
  const cPct = Math.abs(Math.round(congestion.deltaPct));
  const tWord = travel.delta < 0 ? "drops" : "rises";
  const tAbs = Math.abs(round1(travel.delta));
  return `Peak congestion ${cWord} ${cPct}%; cross-town travel time ${tWord} ${tAbs} min.`;
}

function buildInsights(
  metrics: Metric[],
  p: Scenario["params"],
  corridorLabel: string,
): Insight[] {
  const [cong, travel, , co2] = metrics;
  const out: Insight[] = [];

  if (p.roadClosure) {
    out.push({
      kind: "tradeoff",
      title: `Closing ${corridorLabel} backs up the network`,
      detail: `Cross-town travel time climbs to ${travel.predicted} min (+${Math.round(
        travel.deltaPct,
      )}%) and congestion to index ${cong.predicted}. Pair the closure with a parallel detour and signal retiming to absorb the spillover.`,
    });
  }

  if (cong.delta < -0.5) {
    out.push({
      kind: "recommendation",
      title: "Congestion relief is meaningful",
      detail: `The mix cuts the congestion index by ${Math.abs(
        Math.round(cong.deltaPct),
      )}% and CO₂ by ${Math.abs(Math.round(co2.deltaPct))}% (${Math.abs(
        round1(co2.delta),
      )} tons/day). Lock in the gains by prioritising the ${corridorLabel} first.`,
    });
  } else if (cong.delta > 0.5 && !p.roadClosure) {
    out.push({
      kind: "caution",
      title: "This scenario adds congestion",
      detail: `Expect the congestion index to rise ${Math.round(
        cong.deltaPct,
      )}% — consider pairing it with adaptive signals or peak-spreading to offset the load.`,
    });
  }

  if (p.evAdoption && (!p.modalShiftToBike || co2.delta < cong.delta)) {
    out.push({
      kind: "finding",
      title: "EVs cut emissions, not jams",
      detail: `EV adoption lowers traffic CO₂ to ${co2.predicted} tons/day but leaves the congestion index unchanged — cars still occupy the same road space.`,
    });
  }

  if (out.length === 0) {
    out.push({
      kind: "finding",
      title: "Traffic effect is marginal",
      detail: `Congestion stays near index ${cong.predicted} and travel time near ${travel.predicted} min; this scenario barely touches road flow.`,
    });
  }

  return out.slice(0, 2);
}
