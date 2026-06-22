/**
 * City knowledge layer (server-side).
 *
 * Loads the real OSM GeoJSON bundled under ./data and joins curated district
 * metadata (population, households, heating profile) to the geometry by the
 * OSM English name. Consumed by the simulation engine and the /api/city and
 * /api/simulate routes. Not imported by client components — they receive
 * geometry over the wire to keep the browser bundle light.
 */
import type { CityData, DistrictMeta, FeatureCollection, Point } from "./types";

import boundary from "./data/boundary.json";
import districtsGeo from "./data/districts.json";
import roads from "./data/roads.json";
import hospitals from "./data/hospitals.json";
import fire from "./data/fire.json";
import schools from "./data/schools.json";
import busstops from "./data/busstops.json";
import busroutes from "./data/busroutes.json";
import populationData from "./data/population.json";

/**
 * Curated metadata for Ulaanbaatar's 9 districts (düüreg). Figures are
 * approximate 2024 public estimates; `osmName` matches the OSM `name:en`
 * used to join geometry. Heating share = households on raw-coal ger heating,
 * the dominant winter PM2.5 source.
 */
interface DistrictSeed extends Omit<DistrictMeta, "center"> {
  osmName: string;
  center: { lat: number; lng: number };
}

const SEED: DistrictSeed[] = [
  {
    slug: "bayanzurkh", osmName: "Bayanzürkh", name: "Bayanzürkh", nameMn: "Баянзүрх",
    population: 380000, households: 105000, areaKm2: 1244, gerHouseholdShare: 0.55,
    center: { lat: 47.915, lng: 106.978 },
  },
  {
    slug: "songinokhairkhan", osmName: "Songino Khairkhan", name: "Songino-Khairkhan", nameMn: "Сонгинохайрхан",
    population: 370000, households: 102000, areaKm2: 1200, gerHouseholdShare: 0.62,
    center: { lat: 47.922, lng: 106.78 },
  },
  {
    slug: "khan-uul", osmName: "Khan-Uul", name: "Khan-Uul", nameMn: "Хан-Уул",
    population: 220000, households: 61000, areaKm2: 484, gerHouseholdShare: 0.38,
    center: { lat: 47.882, lng: 106.905 },
  },
  {
    slug: "bayangol", osmName: "Bayangol", name: "Bayangol", nameMn: "Баянгол",
    population: 200000, households: 56000, areaKm2: 29, gerHouseholdShare: 0.18,
    center: { lat: 47.913, lng: 106.866 },
  },
  {
    slug: "sukhbaatar", osmName: "Sükhbaatar", name: "Sükhbaatar", nameMn: "Сүхбаатар",
    population: 160000, households: 45000, areaKm2: 208, gerHouseholdShare: 0.48,
    center: { lat: 47.948, lng: 106.93 },
  },
  {
    slug: "chingeltei", osmName: "Chingeltei", name: "Chingeltei", nameMn: "Чингэлтэй",
    population: 160000, households: 45000, areaKm2: 89, gerHouseholdShare: 0.6,
    center: { lat: 47.948, lng: 106.905 },
  },
  {
    slug: "nalaikh", osmName: "Nalaikh", name: "Nalaikh", nameMn: "Налайх",
    population: 45000, households: 12000, areaKm2: 687, gerHouseholdShare: 0.7,
    center: { lat: 47.772, lng: 107.255 },
  },
  {
    slug: "baganuur", osmName: "Baganuur", name: "Baganuur", nameMn: "Багануур",
    population: 32000, households: 9000, areaKm2: 620, gerHouseholdShare: 0.45,
    center: { lat: 47.83, lng: 108.36 },
  },
  {
    slug: "bagakhangai", osmName: "Bagakhangai", name: "Bagakhangai", nameMn: "Багахангай",
    population: 4500, households: 1300, areaKm2: 140, gerHouseholdShare: 0.55,
    center: { lat: 47.06, lng: 108.4 },
  },
];

const SEED_BY_OSM = new Map(SEED.map((s) => [s.osmName, s]));

/* ── Real district areas, computed from the OSM boundary polygons ─────────── */

/** Spherical-ish area (km²) of a lon/lat ring via an equirectangular projection. */
function ringAreaKm2(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const meanLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos((meanLat * Math.PI) / 180); // km per ° lng at this latitude
  const ky = 110.574; // km per ° lat
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(sum) / 2;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function polygonAreaKm2(geom: any): number {
  if (geom.type === "Polygon") {
    const [outer, ...holes] = geom.coordinates as number[][][];
    return holes.reduce((a, h) => a - ringAreaKm2(h), ringAreaKm2(outer));
  }
  if (geom.type === "MultiPolygon") {
    return (geom.coordinates as number[][][][]).reduce((a, poly) => {
      const [outer, ...holes] = poly;
      return a + holes.reduce((b, h) => b - ringAreaKm2(h), ringAreaKm2(outer));
    }, 0);
  }
  return 0;
}

const AREA_BY_SLUG: Record<string, number> = (() => {
  const fc = districtsGeo as unknown as FeatureCollection;
  const out: Record<string, number> = {};
  for (const f of fc.features) {
    if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) continue;
    const en = (f.properties?.["name:en"] as string) ?? "";
    const seed = SEED_BY_OSM.get(en);
    if (seed) out[seed.slug] = Math.round(polygonAreaKm2(f.geometry));
  }
  return out;
})();

const POP = populationData as Record<
  string,
  { population: number; asOf?: string; source?: string }
>;

/**
 * District metadata: real area (computed from the OSM polygon) and real
 * population where a published value exists (Wikidata/NSO), else a calibrated
 * NSO-based estimate. Households derived at UB's ≈3.6 persons/household.
 */
export const DISTRICTS: DistrictMeta[] = SEED.map(({ osmName, ...d }) => {
  const real = POP[d.slug];
  const population = real?.population ?? d.population;
  return {
    ...d,
    population,
    households: Math.round(population / 3.6),
    areaKm2: AREA_BY_SLUG[d.slug] ?? d.areaKm2,
    populationSource: real
      ? `${real.source ?? "Wikidata"}${real.asOf ? ` · ${real.asOf}` : ""}`
      : "NSO 2024 estimate",
  };
});

/** Join geometry → slug, dropping the stray admin-centre point features. */
function tagDistrictGeo(): FeatureCollection {
  const fc = districtsGeo as unknown as FeatureCollection;
  const features = fc.features
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map((f) => {
      const en = (f.properties?.["name:en"] as string) ?? "";
      const seed = SEED_BY_OSM.get(en);
      return {
        ...f,
        properties: {
          ...f.properties,
          slug: seed?.slug ?? en.toLowerCase().replace(/\s+/g, "-"),
          name: seed?.name ?? en,
          nameMn: seed?.nameMn ?? "",
          population: seed?.population ?? null,
        },
      };
    });
  return { type: "FeatureCollection", features };
}

let cached: CityData | null = null;

/** Load (and memoize) the full city knowledge layer. */
export function getCityData(): CityData {
  if (cached) return cached;
  cached = {
    districts: DISTRICTS,
    geo: {
      boundary: boundary as unknown as FeatureCollection,
      districts: tagDistrictGeo(),
      roads: roads as unknown as FeatureCollection,
      hospitals: hospitals as unknown as FeatureCollection<Point>,
      fire: fire as unknown as FeatureCollection<Point>,
      schools: schools as unknown as FeatureCollection<Point>,
      busstops: busstops as unknown as FeatureCollection<Point>,
      busroutes: busroutes as unknown as FeatureCollection,
    },
  };
  return cached;
}

/** Lookup helpers used by simulation modules. */
export function districtBySlug(slug: string): DistrictMeta | undefined {
  return DISTRICTS.find((d) => d.slug === slug);
}

export const TOTAL_POPULATION = DISTRICTS.reduce((s, d) => s + d.population, 0);
export const TOTAL_HOUSEHOLDS = DISTRICTS.reduce((s, d) => s + d.households, 0);
