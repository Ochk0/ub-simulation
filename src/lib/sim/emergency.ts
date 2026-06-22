/**
 * UB Twin AI — EMERGENCY RESPONSE domain.
 *
 * Response coverage from the REAL fire stations (`city.geo.fire`) + hospitals
 * (`city.geo.hospitals`, treated as secondary response nodes). Response time for
 * a point = 4 (dispatch) + distanceKm / 0.5  (≈30 km/h), clamped 4..28.
 *
 * A single centroid hides UB's real gap: the big peripheral düüregs (Khan-Uul/
 * Yarmag, Songino-Khairkhan, Bayanzürkh) sprawl for kilometres while every
 * formal station sits in the core. So each district is sampled as population-
 * weighted DEMAND ZONES — centroid + peripheral points anchored on real named
 * ger pockets — with weight pushed to the periphery as ger share rises. That
 * makes the outer ger areas correctly read slow, and lets a well-sited station
 * (`params.addStation`) pull tens of thousands into faster reach on recompute.
 */
import type {
  Scenario, CityData, DistrictMeta, DomainResult, Metric, MetricFormat,
  ImpactLevel, LatLng, MapOverlay, CoverageOverlay, PointOverlay,
  ChoroplethOverlay, Feature,
} from "@/lib/types";
import { PLACES, MAP_DEFAULT } from "@/lib/constants";
import { districtBySlug } from "@/lib/city";

/* ── Response-model tuning (deterministic, calibrated — no randomness). ─────── */
const DISPATCH_MIN = 4; // call-handling + roll-out
const SPEED_KM_PER_MIN = 0.5; // ≈30 km/h effective response speed
const MIN_RESPONSE = 4;
const MAX_RESPONSE = 28;
const REACH_RADIUS_M = 4500; // ~8-min reach circle at urban speed
const FAST_THRESHOLD = 1.5; // min saved to count a resident as "gaining access"
/**
 * Hospitals are care DESTINATIONS, not staffed first-responder stations, so a
 * unit rolls out slower from one. This per-node penalty (min) lets the ~15 real
 * stations drive the fast reach while the 278 hospitals only fill coverage near
 * the core — so peripheral ger areas (Yarmag, Nalaikh) realistically read as
 * underserved until a dedicated station is sited there.
 */
const HOSPITAL_NODE_PENALTY = 5.5;
const STATION_NODE_PENALTY = 0; // fire/ambulance stations + any newly-added station

/** A response origin with its dispatch handicap. */
interface Origin extends LatLng {
  penalty: number;
}

/** A weighted sample of where a district's people actually live. */
interface DemandZone {
  point: LatLng;
  population: number;
}

/** Haversine great-circle distance in km between two {lat,lng} points. */
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Pull [lng,lat] Point features into penalised origins (skip malformed). */
function pointOrigins(city: CityData): Origin[] {
  const out: Origin[] = [];
  const layers: Array<[typeof city.geo.fire, number]> = [
    [city.geo.fire, STATION_NODE_PENALTY],
    [city.geo.hospitals, HOSPITAL_NODE_PENALTY],
  ];
  for (const [fc, penalty] of layers) {
    for (const f of fc.features) {
      const c = f.geometry?.coordinates;
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        out.push({ lat: c[1], lng: c[0], penalty }); // GeoJSON is [lng,lat]
      }
    }
  }
  return out;
}

/** The staffed first-responder stations (fire/ambulance) — the fast nodes. */
function stationOrigins(origins: Origin[]): Origin[] {
  return origins.filter((o) => o.penalty === STATION_NODE_PENALTY);
}

/** Half-spans (deg) of a district polygon, used to place peripheral zones. */
function districtSpan(geo: Feature | undefined): { dLat: number; dLng: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(c)) {
      for (const v of c) walk(v);
    }
  };
  if (geo?.geometry && "coordinates" in geo.geometry) walk(geo.geometry.coordinates);
  if (!Number.isFinite(minX)) return { dLat: 0.04, dLng: 0.06 }; // fallback
  return { dLat: (maxY - minY) / 2, dLng: (maxX - minX) / 2 };
}

/**
 * Real named ger-area pockets (from PLACES) used to anchor a district's
 * peripheral demand zones. These are the sprawling, station-poor settlements
 * where UB's coverage gap actually bites, so grounding the periphery on them
 * (rather than a blind compass grid) keeps the model tied to real geography.
 */
const PERIPHERAL_PLACES: Record<string, string[]> = {
  "khan-uul": ["yarmag", "zaisan"],
  songinokhairkhan: ["tolgoit", "songinokhairkhan"],
  bayanzurkh: ["bayanzurkh"],
};

/**
 * Build population-weighted demand zones for a district: a central zone plus up
 * to four peripheral zones. Peripheral zones prefer real named ger pockets
 * (Yarmag, Tolgoit…) and otherwise fall back to N/S/E/W samples at ~70% of the
 * district half-span. Higher ger share ⇒ more people live on the sprawling
 * periphery, so we push population weight outward — exactly where formal
 * stations don't reach.
 */
function demandZones(d: DistrictMeta, geoBySlug: Map<string, Feature>): DemandZone[] {
  const { dLat, dLng } = districtSpan(geoBySlug.get(d.slug));
  const offLat = dLat * 0.7;
  const offLng = dLng * 0.7;
  const c = d.center;

  // Named ger pockets first, then compass fallbacks to reach four edge zones.
  const named = (PERIPHERAL_PLACES[d.slug] ?? [])
    .map((k) => PLACES[k])
    .filter(Boolean)
    .map((p) => ({ lat: p.lat, lng: p.lng }));
  const grid = [
    { lat: c.lat + offLat, lng: c.lng },
    { lat: c.lat - offLat, lng: c.lng },
    { lat: c.lat, lng: c.lng + offLng },
    { lat: c.lat, lng: c.lng - offLng },
  ];
  const edges = [...named, ...grid].slice(0, 4);

  // peripheryWeight 0.30 (urban) → 0.75 (heavily ger) of the population.
  const peripheryWeight = 0.3 + 0.45 * Math.min(1, Math.max(0, d.gerHouseholdShare));
  const centralPop = d.population * (1 - peripheryWeight);
  const edgePop = (d.population * peripheryWeight) / edges.length;

  return [
    { point: c, population: centralPop },
    ...edges.map((point) => ({ point, population: edgePop })),
  ];
}

/**
 * Response time (min) to a point = the best (travel + node penalty) across all
 * origins. The penalty lets staffed stations win the periphery while hospitals
 * still help near the core.
 */
function responseTime(point: LatLng, origins: Origin[]): number {
  if (origins.length === 0) return MAX_RESPONSE;
  let best = Infinity;
  for (const o of origins) {
    const t = DISPATCH_MIN + haversineKm(point, o) / SPEED_KM_PER_MIN + o.penalty;
    if (t < best) best = t;
  }
  return Math.max(MIN_RESPONSE, Math.min(MAX_RESPONSE, best));
}

/** Population-weighted average response time across a district's zones. */
function districtTime(zones: DemandZone[], origins: Origin[]): number {
  let pop = 0, sum = 0;
  for (const z of zones) {
    pop += z.population;
    sum += z.population * responseTime(z.point, origins);
  }
  return pop > 0 ? sum / pop : MAX_RESPONSE;
}

/** Resolve where the requested new station lands (explicit → place → district → centre). */
function resolveStation(add: NonNullable<Scenario["params"]["addStation"]>): LatLng {
  if (add.at && Number.isFinite(add.at.lat) && Number.isFinite(add.at.lng)) {
    return { lat: add.at.lat, lng: add.at.lng };
  }
  const place = add.place && PLACES[add.place.toLowerCase()];
  if (place) return { lat: place.lat, lng: place.lng };
  const dist = add.district && districtBySlug(add.district);
  if (dist) return { lat: dist.center.lat, lng: dist.center.lng };
  return { lat: MAP_DEFAULT.center.lat, lng: MAP_DEFAULT.center.lng };
}

/** Assemble a fully-populated Metric (delta / deltaPct / direction derived). */
function metric(
  key: string, label: string, baseline: number, predicted: number,
  unit: string, format: MetricFormat, betterWhenLower: boolean,
): Metric {
  const delta = predicted - baseline;
  const deltaPct = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : 0;
  const direction = delta > 0.01 ? "up" : delta < -0.01 ? "down" : "flat";
  let sentiment: ImpactLevel = "neutral";
  if (direction !== "flat") sentiment = (betterWhenLower ? delta < 0 : delta > 0) ? "good" : "bad";
  return { key, label, baseline, predicted, unit, delta, deltaPct, direction, sentiment, format };
}

/** Round to one decimal for stable, readable values. */
const r1 = (n: number) => Math.round(n * 10) / 10;

export function simulateEmergency(scenario: Scenario, city: CityData): DomainResult {
  const districts = city.districts;
  const baseOrigins = pointOrigins(city);

  // Map district slug → polygon feature so we can size each district's periphery.
  const geoBySlug = new Map<string, Feature>();
  for (const f of city.geo.districts.features) {
    const slug = f.properties?.slug as string | undefined;
    if (slug) geoBySlug.set(slug, f as Feature);
  }
  const zonesByDistrict = districts.map((d) => demandZones(d, geoBySlug));

  // Baseline times per district + population-weighted city average.
  const baseTimes = zonesByDistrict.map((z) => districtTime(z, baseOrigins));
  const totalPop = districts.reduce((s, d) => s + d.population, 0) || 1;
  const baseAvg = districts.reduce((s, d, i) => s + d.population * baseTimes[i], 0) / totalPop;

  // Population beyond 10 min: sum, per zone, the people whose nearest origin is slow.
  const beyondReach = (origins: Origin[]) => {
    let people = 0;
    for (const zones of zonesByDistrict)
      for (const z of zones)
        if (responseTime(z.point, origins) > 10) people += z.population;
    return Math.round(people);
  };
  // High-risk zones: count district-periphery samples slower than 13 min.
  const highRiskCount = (origins: Origin[]) => {
    let n = 0;
    for (const zones of zonesByDistrict)
      for (const z of zones)
        if (responseTime(z.point, origins) > 13) n++;
    return n;
  };

  const baseBeyond = beyondReach(baseOrigins);
  const baseHighRisk = highRiskCount(baseOrigins);

  // ── Apply the policy lever: add a station and recompute everything. ────────
  const add = scenario.params.addStation;
  let predOrigins = baseOrigins;
  let predTimes = baseTimes;
  let stationAt: LatLng | null = null;
  let gainAccess = 0;

  if (add) {
    stationAt = resolveStation(add);
    // A newly-built station is a staffed first-responder node (no penalty).
    predOrigins = [...baseOrigins, { ...stationAt, penalty: STATION_NODE_PENALTY }];
    predTimes = zonesByDistrict.map((z) => districtTime(z, predOrigins));
    // Residents gaining materially faster access, counted per demand zone.
    for (const zones of zonesByDistrict)
      for (const z of zones) {
        const before = responseTime(z.point, baseOrigins);
        const after = responseTime(z.point, predOrigins);
        if (before - after >= FAST_THRESHOLD) gainAccess += z.population;
      }
    gainAccess = Math.round(gainAccess);
  }

  const predAvg = districts.reduce((s, d, i) => s + d.population * predTimes[i], 0) / totalPop;
  const predBeyond = beyondReach(predOrigins);
  const predHighRisk = highRiskCount(predOrigins);

  // Served-area response: population-weighted over exactly the demand zones that
  // materially improve — i.e. the residents who actually gain access. A city-wide
  // average buries a targeted local fix; this is the honest "for those who
  // benefit, how much faster?" figure.
  let catchBase = baseAvg;
  let catchPred = predAvg;
  if (stationAt) {
    let bsum = 0, psum = 0, pop = 0;
    for (const zones of zonesByDistrict)
      for (const z of zones) {
        const before = responseTime(z.point, baseOrigins);
        const after = responseTime(z.point, predOrigins);
        if (before - after >= FAST_THRESHOLD) {
          bsum += z.population * before;
          psum += z.population * after;
          pop += z.population;
        }
      }
    if (pop > 0) {
      catchBase = bsum / pop;
      catchPred = psum / pop;
    }
  }

  // ── Metrics (lower-is-better except residents gaining access). ─────────────
  const metrics: Metric[] = [];
  if (stationAt) {
    metrics.push(
      metric("catchment_response", "Response time (served area)", r1(catchBase), r1(catchPred), "min", "minutes", true)
    );
  }
  metrics.push(
    metric("avg_response", "Avg city response time", r1(baseAvg), r1(predAvg), "min", "minutes", true),
    metric("beyond_10min", "Population beyond 10-min reach", baseBeyond, predBeyond, "people", "number", true),
    metric("high_risk_zones", "High-risk zones", baseHighRisk, predHighRisk, "zones", "number", true),
    metric("gain_access", "Residents gaining faster access", 0, gainAccess, "people", "number", false)
  );

  // ── Overlays from REAL geometry. ───────────────────────────────────────────
  const overlays: MapOverlay[] = [];

  // Coverage: the real staffed stations' ~8-min reach (neutral) + new one (good).
  // We draw the dedicated fire/ambulance stations, not all 278 hospital points,
  // so the map shows the actual first-responder footprint.
  const coverage: CoverageOverlay = {
    kind: "coverage",
    id: "emergency-coverage",
    title: "Emergency response reach (~8 min)",
    circles: stationOrigins(baseOrigins).map((o) => ({
      lat: o.lat, lng: o.lng, radiusM: REACH_RADIUS_M, level: "neutral" as ImpactLevel,
    })),
  };
  if (stationAt) {
    coverage.circles.push({
      lat: stationAt.lat, lng: stationAt.lng, radiusM: REACH_RADIUS_M,
      level: "good", label: "New station reach",
    });
  }
  overlays.push(coverage);

  // Point marker for the new station.
  if (stationAt && add) {
    const label =
      add.place ?? (add.district && districtBySlug(add.district)?.name) ?? `New ${add.kind} station`;
    const points: PointOverlay = {
      kind: "points",
      id: "emergency-new-station",
      title: "Proposed station",
      points: [{
        lat: stationAt.lat, lng: stationAt.lng,
        label: `New ${add.kind} station — ${label}`,
        level: "good", glyph: "station",
      }],
    };
    overlays.push(points);
  }

  // Choropleth of predicted response time per district (good/warn/bad bands).
  const choropleth: ChoroplethOverlay = {
    kind: "choropleth",
    id: "emergency-response-time",
    title: "Predicted response time by district",
    metricLabel: "Response time",
    unit: "min",
    values: districts.map((d, i) => {
      const t = predTimes[i];
      const level: ImpactLevel = t <= 8 ? "good" : t <= 13 ? "warn" : "bad";
      return { slug: d.slug, value: r1(t), level, note: `${r1(t)} min` };
    }),
  };
  overlays.push(choropleth);

  // ── Headline + insights. ───────────────────────────────────────────────────
  let headline: string;
  if (add && stationAt) {
    const placeName = add.place ?? (add.district && districtBySlug(add.district)?.name) ?? "the area";
    headline = `New ${add.kind} station near ${placeName} cuts served-area response ${r1(catchBase)}→${r1(catchPred)} min and speeds access for ${gainAccess.toLocaleString("en-US")} residents.`;
  } else {
    headline = `Current coverage from ${stationOrigins(baseOrigins).length} stations and ${baseOrigins.length - stationOrigins(baseOrigins).length} hospitals leaves ${baseBeyond.toLocaleString("en-US")} residents beyond a 10-min reach.`;
  }

  const insights: DomainResult["insights"] = [];
  if (add && stationAt) {
    insights.push({
      kind: "finding",
      title: "Coverage gap narrowed",
      detail: `Adding a ${add.kind} response node drops high-risk zones from ${baseHighRisk} to ${predHighRisk} and pulls ${Math.max(0, baseBeyond - predBeyond).toLocaleString("en-US")} people inside the 10-minute reach.`,
    });
    insights.push({
      kind: "recommendation",
      title: "Prioritise peripheral ger districts",
      detail: "Response nodes cluster downtown; siting stations in the sprawling ger areas (Yarmag, Songino-Khairkhan, Nalaikh) yields the largest minutes-saved per resident.",
    });
  } else {
    insights.push({
      kind: "caution",
      title: "Peripheral response gap",
      detail: `${baseHighRisk} demand zones sit beyond a 13-minute response window. Hospitals and fire stations cluster in the central core, leaving outer ger areas underserved.`,
    });
  }

  return { domain: "emergency", headline, metrics, overlays, insights };
}
