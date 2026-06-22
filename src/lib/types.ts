/**
 * UB Twin AI — shared type contracts.
 *
 * This file is the frozen interface between the simulation engine, the API
 * layer, and the UI. Simulation domain modules consume a {@link Scenario} +
 * {@link CityData} and return a {@link DomainResult}; the orchestrator merges
 * those into a {@link SimulationResult} that the dashboard renders.
 */
import type { FeatureCollection, Feature, Point } from "geojson";

/* ──────────────────────────────────────────────────────────────────────────
 * City knowledge layer
 * ────────────────────────────────────────────────────────────────────────── */

/** One of the simulation domains the engine reasons about. */
export type SimDomain = "traffic" | "pollution" | "emergency" | "energy" | "transit";

/** Curated metadata per district (düüreg), joined to OSM geometry by slug. */
export interface DistrictMeta {
  /** Stable kebab-case id, also used to join to GeoJSON features. */
  slug: string;
  /** English display name. */
  name: string;
  /** Mongolian (Cyrillic) name. */
  nameMn: string;
  population: number;
  households: number;
  /** Real administrative area in km², computed from the OSM boundary polygon. */
  areaKm2: number;
  /** Share of households heating with raw coal in ger areas (0..1) — PM2.5 driver. */
  gerHouseholdShare: number;
  /** Representative centroid for labels / map focus. */
  center: LatLng;
  /** Provenance of the population figure (real dataset vs calibrated estimate). */
  populationSource?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Everything the simulation engine needs about the city, loaded once. */
export interface CityData {
  districts: DistrictMeta[];
  /** OSM layers. Geometry only — joined to metadata where relevant. */
  geo: {
    boundary: FeatureCollection;
    districts: FeatureCollection;
    roads: FeatureCollection;
    hospitals: FeatureCollection<Point>;
    fire: FeatureCollection<Point>;
    schools: FeatureCollection<Point>;
    busstops: FeatureCollection<Point>;
    /** Real bus route lines (OSM route=bus relations). */
    busroutes: FeatureCollection;
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Scenarios
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Structured parameters extracted from a natural-language prompt by the
 * (rule-based, AI-swappable) scenario parser. All optional; each simulation
 * module reads only the fields it understands.
 */
export interface ScenarioParams {
  // Traffic
  adaptiveSignals?: boolean;
  /** Road name / corridor to close, e.g. "Peace Avenue". */
  roadClosure?: string;
  /** Fraction of car commuters switching to bikes (0..1). */
  modalShiftToBike?: number;
  /** Hours by which school/work start is shifted (e.g. +1). */
  scheduleShiftHours?: number;

  // Transit
  /** Number of buses added to the fleet. */
  addBuses?: number;
  /** New buses are electric (affects emissions). */
  electricBuses?: boolean;
  newBusRoute?: boolean;

  // Emergency
  addStation?: {
    kind: "ambulance" | "fire";
    /** District slug the station serves, when specified by name. */
    district?: string;
    /** Explicit location, when known. */
    at?: LatLng;
    /** Human label for the place, e.g. "Yarmag". */
    place?: string;
  };

  // Pollution / energy
  /** Fraction of coal-heated households switching to electric/clean heat (0..1). */
  coalToElectric?: number;
  /** Government remote-work days per week (0..5). */
  remoteWorkDays?: number;
  /** EV adoption fraction among private cars (0..1). */
  evAdoption?: number;

  /** Free-form extras the parser couldn't type but wants to surface. */
  [k: string]: unknown;
}

export interface Scenario {
  id: string;
  /** Short human title for the run. */
  title: string;
  /** The original natural-language prompt. */
  prompt: string;
  /** Domains this scenario primarily affects (first = primary). */
  domains: SimDomain[];
  params: ScenarioParams;
  /** How confidently the parser understood the prompt (0..1). */
  parseConfidence: number;
}

/** A clickable preset shown in the scenario library. */
export interface ScenarioPreset {
  id: string;
  title: string;
  prompt: string;
  /** lucide-react icon name, resolved in the UI. */
  icon: string;
  /** Primary domain, used for grouping/coloring. */
  domain: SimDomain;
  /** One-line teaser of the expected outcome. */
  teaser: string;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Results
 * ────────────────────────────────────────────────────────────────────────── */

/** Qualitative impact level — drives color across UI and map. */
export type ImpactLevel = "good" | "warn" | "bad" | "neutral";

export type MetricFormat = "number" | "percent" | "minutes" | "index" | "currency";

export interface Metric {
  key: string;
  label: string;
  baseline: number;
  predicted: number;
  unit: string;
  /** predicted − baseline. */
  delta: number;
  /** Signed percentage change vs baseline. */
  deltaPct: number;
  direction: "up" | "down" | "flat";
  /** Whether the change is good/bad/neutral for the city. */
  sentiment: ImpactLevel;
  format: MetricFormat;
}

export interface Insight {
  kind: "recommendation" | "tradeoff" | "finding" | "caution";
  title: string;
  detail: string;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Cost / ROI
 * ────────────────────────────────────────────────────────────────────────── */

export interface BudgetLine {
  label: string;
  /** Magnitude in ₮ (MNT); the sign is implied by `kind`. */
  amount: number;
  kind: "capital" | "operating" | "benefit";
  note?: string;
}

/** Indicative cost–benefit case for a scenario (₮ MNT). */
export interface BudgetEstimate {
  capitalCost: number;
  annualCost: number;
  annualBenefit: number;
  /** Years to recoup capital from net annual benefit; null if it never pays back. */
  paybackYears: number | null;
  /** Benefit ÷ cost over the horizon. */
  benefitCostRatio: number;
  horizonYears: number;
  lines: BudgetLine[];
  verdict: string;
}

/** Future-risk prediction — the proactive "what's coming" feed. */
export interface RiskPrediction {
  id: string;
  kind: "traffic" | "pollution" | "transit" | "accident" | "flood" | "energy";
  severity: ImpactLevel; // good = all clear, warn, bad = high risk
  /** Minutes from now until the predicted event window. */
  etaMinutes: number;
  title: string;
  detail: string;
  location?: LatLng & { label?: string };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Map overlays — geometry-light instructions the client renders against its
 * locally-loaded GeoJSON. The server returns ids / values / coordinates only.
 * ────────────────────────────────────────────────────────────────────────── */

/** Color a subset of road features by their OSM feature id. */
export interface RoadOverlay {
  kind: "roads";
  id: string;
  title: string;
  statuses: Array<{ featureId: string | number; level: ImpactLevel; note?: string }>;
}

/** Choropleth over districts, joined by district slug. */
export interface ChoroplethOverlay {
  kind: "choropleth";
  id: string;
  title: string;
  metricLabel: string;
  unit: string;
  values: Array<{ slug: string; value: number; level: ImpactLevel; note?: string }>;
}

/** Discrete points (new stations, hazards, facilities). */
export interface PointOverlay {
  kind: "points";
  id: string;
  title: string;
  points: Array<
    LatLng & {
      label: string;
      level: ImpactLevel;
      glyph: "station" | "hazard" | "facility" | "flag";
    }
  >;
}

/** Coverage / reach circles (e.g. emergency response radius). */
export interface CoverageOverlay {
  kind: "coverage";
  id: string;
  title: string;
  circles: Array<LatLng & { radiusM: number; level: ImpactLevel; label?: string }>;
}

/** Heat cells for diffuse phenomena (pollution plume, jam risk). */
export interface HeatOverlay {
  kind: "heat";
  id: string;
  title: string;
  /** intensity 0..1 per cell. */
  cells: Array<LatLng & { intensity: number }>;
  level: ImpactLevel;
}

export type MapOverlay =
  | RoadOverlay
  | ChoroplethOverlay
  | PointOverlay
  | CoverageOverlay
  | HeatOverlay;

/* ──────────────────────────────────────────────────────────────────────────
 * Domain + top-level results
 * ────────────────────────────────────────────────────────────────────────── */

/** Output of a single simulation domain module. */
export interface DomainResult {
  domain: SimDomain;
  /** One-line summary of this domain's outcome. */
  headline: string;
  metrics: Metric[];
  overlays: MapOverlay[];
  insights: Insight[];
}

/** The full result returned by the engine / API and rendered by the dashboard. */
export interface SimulationResult {
  scenario: Scenario;
  /** Narrative, AI-style summary paragraph (template-generated for now). */
  summary: string;
  /** Headline stat cards (curated from domain metrics). */
  primaryMetrics: Metric[];
  domains: DomainResult[];
  /** Flattened overlays to draw, in render order. */
  overlays: MapOverlay[];
  insights: Insight[];
  risks: RiskPrediction[];
  /** Overall confidence (0..1). */
  confidence: number;
  /** Where the map should fly to highlight the result. */
  mapFocus?: LatLng & { zoom: number };
  /** True when the summary/recommendations were written by the LLM analyst. */
  aiPowered?: boolean;
  /** What citizens are already saying about this policy (tsaaguur.mn). */
  publicSignal?: import("@/lib/social/types").PublicSignal;
  /** Indicative cost / ROI case for the policy. */
  budget?: BudgetEstimate;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Engine signatures (for reference by module authors)
 * ────────────────────────────────────────────────────────────────────────── */

/** Signature every domain module exposes. */
export type DomainSimulator = (scenario: Scenario, city: CityData) => DomainResult;

/** Re-export GeoJSON helpers used across modules. */
export type { FeatureCollection, Feature, Point };
