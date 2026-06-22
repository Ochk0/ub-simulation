/**
 * UB Twin AI — Public transit (bus) simulation domain.
 *
 * Models how bus-fleet and scheduling policies ripple through Ulaanbaatar's
 * peak-hour transit: peak capacity utilization (the city's buses run ~96%
 * full — painfully overcrowded), average wait, daily ridership, and fleet
 * CO2. Baselines reflect a ~1100-bus fleet moving ~560k trips/day.
 *
 * The route network is read from the REAL OSM data the client also renders
 * (`city.geo.busroutes` — ~16 route=bus relations) and `city.geo.busstops`,
 * so the simulation and the map agree on how many routes, route-km and stops
 * the city actually runs. A new trunk route extends that measured network.
 *
 * Pure + deterministic: every output is a closed-form function of the
 * scenario params and the real city geometry. No randomness, no clock.
 */
import type {
  Scenario,
  CityData,
  DomainResult,
  Metric,
  Insight,
  MapOverlay,
  PointOverlay,
  ChoroplethOverlay,
  ImpactLevel,
  MetricFormat,
} from "@/lib/types";
import type { Position } from "geojson";
import { MAP_DEFAULT } from "@/lib/constants";

/* Peak-hour baselines for the current Ulaanbaatar bus system. */
const BASE_FLEET = 1100; // buses in service at peak
const BASE_UTIL = 96; // % of capacity used at peak (>85 = overcrowded)
const BASE_WAIT = 12; // avg wait between buses (min)
const BASE_RIDERSHIP = 560000; // daily boardings (trips)
const BASE_CO2 = 900; // diesel fleet CO2 (tons/day)

/** Round to a fixed number of decimals (keeps metrics tidy + deterministic). */
function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Earth radius (km) for haversine over GeoJSON [lng,lat] positions. */
const EARTH_KM = 6371;

/** Great-circle distance (km) between two [lng,lat] positions. */
function haversineKm(a: Position, b: Position): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Summed length (km) of a single [lng,lat] polyline. */
function lineLengthKm(coords: Position[]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += haversineKm(coords[i - 1], coords[i]);
  return sum;
}

/**
 * Measure the REAL bus-route network from the rendered OSM features:
 * route count, total route-km (haversine over every LineString and every line
 * of a MultiLineString), and stop count. Geometry is the same FeatureCollection
 * the map draws, so the model and the map never disagree.
 */
function measureNetwork(city: CityData): {
  routeCount: number;
  networkKm: number;
  stopsCount: number;
  avgRouteKm: number;
} {
  const routes = city.geo.busroutes?.features ?? [];
  const routeCount = routes.length;
  let networkKm = 0;
  for (const f of routes) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      networkKm += lineLengthKm(g.coordinates);
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) networkKm += lineLengthKm(line);
    }
  }
  const stopsCount = city.geo.busstops?.features?.length ?? 0;
  const avgRouteKm = routeCount > 0 ? networkKm / routeCount : 0;
  return { routeCount, networkKm: round(networkKm, 1), stopsCount, avgRouteKm };
}

/** Assemble a Metric, deriving delta / deltaPct / direction from the pair. */
function metric(
  key: string,
  label: string,
  baseline: number,
  predicted: number,
  unit: string,
  format: MetricFormat,
  /** Does a DROP help the city? (true for crowding, wait, CO2.) */
  lowerIsGood: boolean
): Metric {
  const delta = round(predicted - baseline, 1);
  const deltaPct = baseline === 0 ? 0 : round((delta / baseline) * 100, 1);
  const direction: Metric["direction"] = delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  // A change is "good" when it moves in the beneficial direction; tiny moves stay neutral.
  let sentiment: ImpactLevel = "neutral";
  if (Math.abs(deltaPct) >= 0.5) {
    const improving = lowerIsGood ? delta < 0 : delta > 0;
    sentiment = improving ? "good" : "bad";
  }
  return { key, label, baseline, predicted, unit, delta, deltaPct, direction, sentiment, format };
}

export function simulateTransit(scenario: Scenario, city: CityData): DomainResult {
  const p = scenario.params;

  // ── Read params (all optional; clamp to sane ranges) ────────────────────
  const addBuses = Math.max(0, Math.floor(p.addBuses ?? 0));
  const electric = p.electricBuses === true;
  const newRoute = p.newBusRoute === true;
  const bikeShift = Math.min(1, Math.max(0, p.modalShiftToBike ?? 0)); // 0..1
  const shiftHours = Math.min(4, Math.max(0, p.scheduleShiftHours ?? 0)); // peak-spreading

  // Fleet growth ratio drives capacity relief + a touch of induced demand.
  const fleetRatio = addBuses / BASE_FLEET;

  // ── Real route network (from the OSM geometry the map also renders) ──────
  // routeCount + networkKm + stopsCount are measured, not assumed, so the
  // simulation and the rendered route lines stay consistent.
  const net = measureNetwork(city);
  // A new trunk route extends the measured network by one route of average
  // length. With no real routes loaded, fall back to a representative 11 km.
  const avgRouteKm = net.avgRouteKm > 0 ? net.avgRouteKm : 11;
  const predRouteCount = net.routeCount + (newRoute ? 1 : 0);
  const predNetworkKm = round(net.networkKm + (newRoute ? avgRouteKm : 0), 1);
  // Relative network growth lightly improves coverage/ridership beyond the
  // generic +3% the existing model already applies for a new route.
  const networkGrowth = net.networkKm > 0 ? (predNetworkKm - net.networkKm) / net.networkKm : 0;

  // ── Peak capacity utilization ───────────────────────────────────────────
  // More buses divide the same riders across more capacity; a new trunk route
  // and peak-spreading both pull crowding down further.
  let util = BASE_UTIL / (1 + fleetRatio * 0.9);
  if (newRoute) util *= 0.96; // dedicated corridor offloads the busiest lines
  util *= 1 - networkGrowth * 0.3; // longer network spreads load a touch more
  util -= Math.min(12, shiftHours * 6); // schedule shift flattens the peak
  util -= bikeShift * 4; // bikes peel a few % off bus load
  util = Math.max(35, util); // never below a realistic floor

  // ── Average wait ────────────────────────────────────────────────────────
  // More buses ⇒ tighter headways; a new route trims a little more.
  let wait = BASE_WAIT / (1 + fleetRatio * 0.8);
  if (newRoute) wait *= 0.95;
  wait = Math.max(2.5, wait);

  // ── Daily ridership ─────────────────────────────────────────────────────
  // Added buses induce demand (~half the relative fleet growth); a new route
  // adds reach; bikes pull trips off the bus network.
  let ridership = BASE_RIDERSHIP * (1 + fleetRatio * 0.5);
  if (newRoute) ridership *= 1.03;
  ridership *= 1 + networkGrowth * 0.4; // extra route-km extends coverage/reach
  ridership *= 1 - bikeShift * 0.15; // f * 15% leave the bus
  ridership = Math.max(0, ridership);

  // ── Fleet CO2 ───────────────────────────────────────────────────────────
  // Diesel buses emit ~BASE_CO2/BASE_FLEET tons each per day. Added diesel
  // buses add tailpipe load. Going electric removes the new buses' emissions
  // AND retires an equal number of the dirtiest in-service diesels — so even
  // with no net fleet growth, electrifying a batch cleans up that share.
  const perBus = BASE_CO2 / BASE_FLEET;
  let co2: number;
  if (electric) {
    // The new buses are zero-tailpipe; they also displace up to an equal count
    // of existing diesels. With addBuses=0, treat it as a pilot electrifying a
    // standard 100-bus batch of the current fleet.
    const electrified = Math.min(addBuses > 0 ? addBuses : 100, BASE_FLEET);
    co2 = BASE_CO2 - electrified * perBus; // share of fleet now clean
  } else {
    co2 = BASE_CO2 + addBuses * perBus; // more diesel buses ⇒ more CO2
  }
  co2 = Math.max(0, co2);

  const metrics: Metric[] = [
    metric("peak_util", "Peak capacity utilization", BASE_UTIL, round(util, 1), "%", "percent", true),
    metric("avg_wait", "Avg wait", BASE_WAIT, round(wait, 1), "min", "minutes", true),
    metric("ridership", "Daily ridership", BASE_RIDERSHIP, Math.round(ridership), "trips", "number", false),
    metric("fleet_co2", "Fleet CO2", BASE_CO2, round(co2, 1), "tons/day", "number", true),
    // Real route network: baseline measured from OSM, predicted extended by a
    // new trunk route. More route-km = wider coverage, so up is good here.
    metric("route_network", "Route network", net.networkKm, predNetworkKm, "route-km", "number", false),
  ];

  // ── Overlays ────────────────────────────────────────────────────────────
  const overlays: MapOverlay[] = [];
  const touched = addBuses > 0 || electric || newRoute || bikeShift > 0 || shiftHours > 0;

  // PointOverlay: ~80 real stops nearest the centre, flagged "improved
  // frequency". Sorted by distance to the map centre so the densest core of
  // the network is highlighted; deterministic (stable sort over real coords).
  const c = MAP_DEFAULT.center;
  const stops = city.geo.busstops.features
    .filter((f) => f.geometry?.type === "Point")
    .map((f) => {
      const [lng, lat] = f.geometry.coordinates as [number, number]; // GeoJSON is [lng,lat]
      const dlat = lat - c.lat;
      const dlng = lng - c.lng;
      return { lat, lng, name: (f.properties?.name as string) ?? "Bus stop", d2: dlat * dlat + dlng * dlng };
    })
    .sort((a, b) => a.d2 - b.d2 || a.lat - b.lat || a.lng - b.lng)
    .slice(0, 80);

  if (stops.length > 0) {
    const stopLevel: ImpactLevel = touched ? "good" : "neutral";
    overlays.push({
      kind: "points",
      id: "transit-stops",
      title: touched
        ? "Improved frequency"
        : `Bus network — ${net.routeCount} routes, ${net.stopsCount} stops`,
      points: stops.map((s) => ({
        lat: s.lat,
        lng: s.lng,
        label: "Improved frequency",
        level: stopLevel,
        glyph: "facility",
      })),
    } satisfies PointOverlay);
  }

  // ChoroplethOverlay: relative transit access by district. Access improves
  // with crowding relief / shorter waits; denser core districts already have
  // the most stops, so they gain the most from frequency upgrades.
  const stopCount = new Map<string, number>();
  for (const f of city.geo.busstops.features) {
    if (f.geometry?.type !== "Point") continue;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    // Assign each stop to its nearest district centre (cheap point-in-region).
    let best = city.districts[0]?.slug ?? "";
    let bestD2 = Infinity;
    for (const d of city.districts) {
      const dl = lat - d.center.lat;
      const dn = lng - d.center.lng;
      const dd = dl * dl + dn * dn;
      if (dd < bestD2) {
        bestD2 = dd;
        best = d.slug;
      }
    }
    stopCount.set(best, (stopCount.get(best) ?? 0) + 1);
  }
  // Frequency uplift factor (>1 means better service than baseline).
  const uplift = (BASE_WAIT / Math.max(wait, 0.1) + BASE_UTIL / Math.max(util, 1)) / 2;
  const values = city.districts.map((d) => {
    const stopsHere = stopCount.get(d.slug) ?? 0;
    // Access index: stops per 100k residents, scaled by the frequency uplift.
    const per100k = (stopsHere / Math.max(d.population, 1)) * 100000;
    const access = round(per100k * uplift, 1);
    const level: ImpactLevel =
      stopsHere === 0 ? "bad" : per100k >= 10 ? "good" : per100k >= 4 ? "warn" : "bad";
    return { slug: d.slug, value: access, level, note: `${stopsHere} stops` };
  });
  overlays.push({
    kind: "choropleth",
    id: "transit-access",
    title: "Transit access by district",
    metricLabel: "Access index",
    unit: "stops/100k · freq",
    values,
  } satisfies ChoroplethOverlay);

  // ── Insights (tied to the computed numbers) ─────────────────────────────
  const insights: Insight[] = [];
  const utilDrop = round(BASE_UTIL - util, 1);
  const waitDrop = round(BASE_WAIT - wait, 1);

  if (addBuses > 0) {
    insights.push({
      kind: electric ? "recommendation" : "finding",
      title: `${addBuses} buses ease peak crowding`,
      detail: electric
        ? `Adding ${addBuses} electric buses cuts peak utilization ${utilDrop} pts (to ${round(
            util,
            0
          )}%) and trims waits by ${waitDrop} min, while replacing diesels drops fleet CO2 to ${round(
            co2,
            0
          )} t/day.`
        : `Adding ${addBuses} diesel buses cuts peak utilization ${utilDrop} pts and waits by ${waitDrop} min, but raises fleet CO2 to ${round(
            co2,
            0
          )} t/day — electrifying the fleet would reverse that.`,
    });
  } else if (electric) {
    insights.push({
      kind: "recommendation",
      title: "Electrifying buses cuts emissions",
      detail: `Electrifying a batch of the fleet drops fleet CO2 to ${round(
        co2,
        0
      )} t/day from ${BASE_CO2} with no loss of service.`,
    });
  }

  if (bikeShift > 0) {
    insights.push({
      kind: "tradeoff",
      title: "Bike modal shift relieves buses but cuts fares",
      detail: `A ${round(bikeShift * 100, 0)}% shift to bikes pulls ~${Math.round(
        BASE_RIDERSHIP * bikeShift * 0.15
      ).toLocaleString()} trips/day off buses, easing crowding to ${round(util, 0)}% but lowering ridership.`,
    });
  } else if (shiftHours > 0) {
    insights.push({
      kind: "finding",
      title: "Staggering start times flattens the peak",
      detail: `Shifting schedules ${shiftHours}h spreads demand, dropping peak utilization ${utilDrop} pts to ${round(
        util,
        0
      )}%.`,
    });
  }

  if (newRoute) {
    insights.push({
      kind: "recommendation",
      title: "New trunk route widens coverage",
      detail: `A new line extends the network from ${net.routeCount} routes / ${net.networkKm} route-km to ${predRouteCount} routes / ${predNetworkKm} route-km (~${round(
        avgRouteKm,
        0
      )} km), offloading the busiest corridors to ${round(util, 0)}% peak load and reaching more of the ${net.stopsCount} stops.`,
    });
  }

  // Always ground the result in the real, measured network so the panel and
  // the rendered route lines tell the same story.
  if (net.routeCount > 0) {
    insights.push({
      kind: "finding",
      title: "Grounded in UB's real bus network",
      detail: `UB runs ${net.routeCount} bus routes over ~${net.networkKm} route-km serving ${net.stopsCount} stops (OSM route=bus relations) — the same network drawn on the map.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      kind: "finding",
      title: "Transit largely unchanged",
      detail: `Buses still run ${round(util, 0)}% full at peak with ~${round(
        wait,
        0
      )} min waits — this scenario barely touches the transit network.`,
    });
  }

  // ── Headline ────────────────────────────────────────────────────────────
  const headline = newRoute
    ? `New route extends UB's network to ${predRouteCount} routes / ${predNetworkKm} route-km, peak load ${round(
        util,
        0
      )}%`
    : utilDrop >= 1
    ? `Peak crowding eases ${utilDrop} pts to ${round(util, 0)}% with ${round(wait, 0)} min waits`
    : addBuses > 0 && !electric
    ? `${addBuses} added buses cut waits but raise fleet CO2 to ${round(co2, 0)} t/day`
    : `Transit holds near baseline: ${round(util, 0)}% peak load, ${round(wait, 0)} min waits across ${net.routeCount} routes`;

  return { domain: "transit", headline, metrics, overlays, insights };
}
