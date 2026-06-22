/**
 * Shared visual + domain constants. Single source of truth for the colors that
 * map overlays, stat cards, badges and charts all key off of, so the map and
 * the panels never drift apart.
 */
import type { ImpactLevel, SimDomain } from "./types";

/** Hex colors per impact level — used by Leaflet (no Tailwind there) and charts. */
export const IMPACT_COLORS: Record<ImpactLevel, string> = {
  good: "#34d399", // emerald
  warn: "#fbbf24", // amber
  bad: "#f87171", // red
  neutral: "#64748b", // slate
};

/** Slightly translucent fills for polygons / circles. */
export const IMPACT_FILL: Record<ImpactLevel, string> = {
  good: "rgba(52, 211, 153, 0.35)",
  warn: "rgba(251, 191, 36, 0.35)",
  bad: "rgba(248, 113, 113, 0.38)",
  neutral: "rgba(100, 116, 139, 0.25)",
};

/** Tailwind text classes per impact level for badges / numbers. */
export const IMPACT_TEXT: Record<ImpactLevel, string> = {
  good: "text-signal-good",
  warn: "text-signal-warn",
  bad: "text-signal-bad",
  neutral: "text-slate-400",
};

export interface DomainMeta {
  key: SimDomain;
  label: string;
  /** lucide-react icon name. */
  icon: string;
  color: string;
  blurb: string;
}

export const DOMAINS: Record<SimDomain, DomainMeta> = {
  traffic: {
    key: "traffic",
    label: "Traffic",
    icon: "Car",
    color: "#38bdf8",
    blurb: "Congestion, travel time, road throughput",
  },
  pollution: {
    key: "pollution",
    label: "Air Quality",
    icon: "Wind",
    color: "#a78bfa",
    blurb: "PM2.5, winter smog, health exposure",
  },
  emergency: {
    key: "emergency",
    label: "Emergency",
    icon: "Siren",
    color: "#f87171",
    blurb: "Ambulance & fire response coverage",
  },
  energy: {
    key: "energy",
    label: "Energy",
    icon: "Zap",
    color: "#fbbf24",
    blurb: "Heating & electricity demand",
  },
  transit: {
    key: "transit",
    label: "Transit",
    icon: "Bus",
    color: "#34d399",
    blurb: "Bus capacity, ridership, reliability",
  },
};

/** Map default view — central Ulaanbaatar. */
export const MAP_DEFAULT = {
  center: { lat: 47.918, lng: 106.917 },
  zoom: 12,
} as const;

/** Free, no-token dark basemap (CARTO). {s} subdomain, retina @2x. */
export const BASEMAP = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
} as const;

/** Labeled basemap variant, toggled on for "report" views. */
export const BASEMAP_LABELS = {
  url: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
  subdomains: "abcd",
} as const;

/** Well-known UB places the parser can resolve by name. */
export const PLACES: Record<string, { lat: number; lng: number; label: string }> = {
  yarmag: { lat: 47.8826, lng: 106.8186, label: "Yarmag" },
  "peace avenue": { lat: 47.9185, lng: 106.9176, label: "Peace Avenue" },
  "sukhbaatar square": { lat: 47.9186, lng: 106.9176, label: "Sükhbaatar Square" },
  zaisan: { lat: 47.8836, lng: 106.9106, label: "Zaisan" },
  bayanzurkh: { lat: 47.9135, lng: 106.9806, label: "Bayanzürkh" },
  tolgoit: { lat: 47.9279, lng: 106.8036, label: "Tolgoit" },
  songinokhairkhan: { lat: 47.9259, lng: 106.7806, label: "Songinokhairkhan" },
};
