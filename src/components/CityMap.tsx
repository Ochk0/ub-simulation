"use client";

/**
 * The live city map (Leaflet). Renders the real OSM base network + districts
 * and paints simulation overlays on top:
 *  - RoadOverlay      → recolors arterial segments by impact level
 *  - ChoroplethOverlay→ fills districts by metric value
 *  - PointOverlay     → station / hazard / facility markers
 *  - CoverageOverlay  → reach circles
 *  - HeatOverlay      → diffuse intensity cells
 *
 * Loaded via next/dynamic({ ssr:false }) from the page, so Leaflet never runs
 * during SSR. Uses CircleMarker/Circle (no marker image assets needed).
 */
import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  CircleMarker,
  Circle,
  Popup,
  useMap,
} from "react-leaflet";
import type { Feature } from "geojson";
import type { PathOptions } from "leaflet";
import type { CityData, MapOverlay, ImpactLevel, DistrictMeta } from "@/lib/types";
import { BASEMAP, IMPACT_COLORS, MAP_DEFAULT } from "@/lib/constants";
import { compact } from "@/lib/format";

type Geo = CityData["geo"];

interface Props {
  geo: Geo | null;
  overlays: MapOverlay[];
  focus?: { lat: number; lng: number; zoom: number };
  /** District metadata, for click-to-inspect popups. */
  districts?: DistrictMeta[];
  /** Brighten the bus-route network (transit scenarios). */
  highlightBusRoutes?: boolean;
}

function FocusController({ focus }: { focus?: Props["focus"] }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom, { duration: 1.1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.lat, focus?.lng, focus?.zoom]);
  return null;
}

export function CityMap({ geo, overlays, focus, districts, highlightBusRoutes }: Props) {
  const sig = useMemo(() => overlays.map((o) => o.id).join("|"), [overlays]);

  const districtMeta = useMemo(() => {
    const m = new Map<string, DistrictMeta>();
    for (const d of districts ?? []) m.set(d.slug, d);
    return m;
  }, [districts]);

  const roadStatus = useMemo(() => {
    const m = new Map<string, ImpactLevel>();
    for (const o of overlays)
      if (o.kind === "roads") for (const s of o.statuses) m.set(String(s.featureId), s.level);
    return m;
  }, [overlays]);

  const choro = useMemo(() => {
    const m = new Map<string, { value: number; level: ImpactLevel; note?: string }>();
    for (const o of overlays)
      if (o.kind === "choropleth")
        for (const v of o.values) m.set(v.slug, { value: v.value, level: v.level, note: v.note });
    return m;
  }, [overlays]);

  const points = overlays.filter((o) => o.kind === "points") as Extract<MapOverlay, { kind: "points" }>[];
  const coverages = overlays.filter((o) => o.kind === "coverage") as Extract<MapOverlay, { kind: "coverage" }>[];
  const heats = overlays.filter((o) => o.kind === "heat") as Extract<MapOverlay, { kind: "heat" }>[];

  const roadStyle = (f?: Feature): PathOptions => {
    const id = String(f?.properties?.id ?? "");
    const lvl = roadStatus.get(id);
    if (lvl) return { color: IMPACT_COLORS[lvl], weight: lvl === "bad" ? 4 : 3, opacity: 0.95 };
    return { color: "#334155", weight: 1, opacity: 0.3 };
  };

  const districtStyle = (f?: Feature): PathOptions => {
    const slug = String(f?.properties?.slug ?? "");
    const c = choro.get(slug);
    if (c)
      return {
        color: IMPACT_COLORS[c.level],
        weight: 1.2,
        opacity: 0.7,
        fillColor: IMPACT_COLORS[c.level],
        fillOpacity: 0.18,
      };
    return { color: "#475569", weight: 1, opacity: 0.35, fillColor: "#0f172a", fillOpacity: 0.05 };
  };

  const onDistrict = (
    f: Feature,
    layer: {
      bindTooltip: (s: string, o?: unknown) => void;
      bindPopup: (s: string, o?: unknown) => void;
    }
  ) => {
    const name = (f.properties?.name as string) ?? "District";
    const slug = String(f.properties?.slug ?? "");
    const c = choro.get(slug);
    layer.bindTooltip(c ? `${name} — ${Math.round(c.value)}${c.note ? ` ${c.note}` : ""}` : name, {
      sticky: true,
      direction: "top",
      opacity: 0.95,
    });

    // Click a district to inspect its real stats.
    const m = districtMeta.get(slug);
    if (m) {
      const dens = m.areaKm2 ? Math.round(m.population / m.areaKm2) : 0;
      layer.bindPopup(
        `<div style="min-width:178px">
          <div style="font-weight:600;font-size:13px;color:#e2e8f0">${m.name} <span style="color:#64748b;font-weight:400">${m.nameMn}</span></div>
          <div style="margin-top:7px;display:grid;grid-template-columns:1fr auto;gap:3px 14px;font-size:11px;color:#94a3b8">
            <span>Population</span><span style="text-align:right;color:#e2e8f0">${compact(m.population)}</span>
            <span>Area</span><span style="text-align:right;color:#e2e8f0">${m.areaKm2.toLocaleString()} km²</span>
            <span>Density</span><span style="text-align:right;color:#e2e8f0">${dens.toLocaleString()}/km²</span>
            <span>Ger heating</span><span style="text-align:right;color:#e2e8f0">${Math.round(m.gerHouseholdShare * 100)}%</span>
            ${c ? `<span>This scenario</span><span style="text-align:right;color:#38bdf8">${Math.round(c.value)}${c.note ? " " + c.note : ""}</span>` : ""}
          </div>
          <div style="margin-top:8px;font-size:9px;color:#475569">pop: ${m.populationSource ?? "estimate"}</div>
        </div>`
      );
    }
  };

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[MAP_DEFAULT.center.lat, MAP_DEFAULT.center.lng]}
        zoom={MAP_DEFAULT.zoom}
        className="h-full w-full"
        zoomControl
        preferCanvas
        scrollWheelZoom
      >
        <TileLayer
          url={BASEMAP.url}
          attribution={BASEMAP.attribution}
          subdomains={BASEMAP.subdomains}
          maxZoom={BASEMAP.maxZoom}
        />

        {/* District fills / choropleth */}
        {geo && (
          <GeoJSON
            key={`dist-${sig}`}
            data={geo.districts}
            style={districtStyle as PathOptions}
            onEachFeature={onDistrict as never}
          />
        )}

        {/* Real bus-route network — subtle underlay, brightened on transit scenarios */}
        {geo?.busroutes && (
          <GeoJSON
            key={`busroutes-${highlightBusRoutes ? "hi" : "lo"}`}
            data={geo.busroutes}
            style={
              (() =>
                highlightBusRoutes
                  ? { color: "#34d399", weight: 2.2, opacity: 0.72 }
                  : { color: "#818cf8", weight: 1.2, opacity: 0.32 }) as PathOptions
            }
          />
        )}

        {/* Arterial road network, recolored by traffic overlay */}
        {geo && (
          <GeoJSON key={`roads-${sig}`} data={geo.roads} style={roadStyle as PathOptions} />
        )}

        {/* Context: real fire / ambulance stations */}
        {geo?.fire?.features.map((f, i) => {
          const coords = (f.geometry as { coordinates: number[] }).coordinates;
          const [lng, lat] = coords;
          return (
            <CircleMarker
              key={`fire-${i}`}
              center={[lat, lng]}
              radius={3}
              pathOptions={{ color: "#fca5a5", weight: 1, fillColor: "#ef4444", fillOpacity: 0.6 }}
            >
              <Popup>{(f.properties?.name as string) ?? "Emergency station"}</Popup>
            </CircleMarker>
          );
        })}

        {/* Heat cells (drawn under points) */}
        {heats.flatMap((o) =>
          o.cells.map((c, i) => (
            <CircleMarker
              key={`${o.id}-heat-${i}`}
              center={[c.lat, c.lng]}
              radius={6 + c.intensity * 18}
              pathOptions={{
                stroke: false,
                fillColor: IMPACT_COLORS[o.level],
                fillOpacity: 0.04 + c.intensity * 0.14,
              }}
            />
          ))
        )}

        {/* Coverage / reach circles */}
        {coverages.flatMap((o) =>
          o.circles.map((c, i) => (
            <Circle
              key={`${o.id}-cov-${i}`}
              center={[c.lat, c.lng]}
              radius={c.radiusM}
              pathOptions={{
                color: IMPACT_COLORS[c.level],
                weight: c.level === "good" ? 1.5 : 1,
                opacity: 0.7,
                fillColor: IMPACT_COLORS[c.level],
                fillOpacity: 0.08,
                dashArray: c.level === "neutral" ? "4 6" : undefined,
              }}
            >
              {c.label && <Popup>{c.label}</Popup>}
            </Circle>
          ))
        )}

        {/* Discrete overlay points (new stations, hazards) */}
        {points.flatMap((o) =>
          o.points.map((p, i) => {
            const big = p.glyph === "station" || p.glyph === "flag";
            return (
              <CircleMarker
                key={`${o.id}-pt-${i}`}
                center={[p.lat, p.lng]}
                radius={big ? 9 : 6}
                pathOptions={{
                  color: "#fff",
                  weight: big ? 2 : 1,
                  fillColor: IMPACT_COLORS[p.level],
                  fillOpacity: 0.95,
                }}
              >
                <Popup>{p.label}</Popup>
              </CircleMarker>
            );
          })
        )}

        <FocusController focus={focus} />
      </MapContainer>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-xl border border-white/10 bg-ink-950/80 px-3 py-2 text-[10px] backdrop-blur">
        <div className="mb-1 font-mono uppercase tracking-[0.18em] text-slate-500">Impact</div>
        <div className="flex gap-3">
          {(
            [
              ["good", "Improved"],
              ["warn", "Watch"],
              ["bad", "Stressed"],
            ] as [ImpactLevel, string][]
          ).map(([lvl, label]) => (
            <span key={lvl} className="flex items-center gap-1 text-slate-300">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: IMPACT_COLORS[lvl] }}
              />
              {label}
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-white/5 pt-1.5 text-slate-300">
          <span className="inline-block h-[2px] w-4 rounded" style={{ background: "#818cf8" }} />
          Bus routes
        </div>
      </div>

      {!geo && (
        <div className="absolute inset-0 z-[600] grid place-items-center bg-ink-950/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading the city…
          </div>
        </div>
      )}
    </div>
  );
}
