"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import type { CityData, DistrictMeta, SimulationResult } from "@/lib/types";
import { SCENARIO_PRESETS } from "@/lib/scenarios";
import { Header } from "@/components/Header";
import { ScenarioConsole } from "@/components/ScenarioConsole";
import { CitizenPulse } from "@/components/CitizenPulse";
import { ResultModal } from "@/components/ResultModal";

// Leaflet must never render during SSR.
const CityMap = dynamic(() => import("@/components/CityMap").then((m) => m.CityMap), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-ink-950 text-sm text-slate-400">
      Initializing map…
    </div>
  ),
});

type Geo = CityData["geo"];

export default function Page() {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [districts, setDistricts] = useState<DistrictMeta[]>([]);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const autoRan = useRef(false);

  // Load the city knowledge layer once.
  useEffect(() => {
    let alive = true;
    fetch("/api/city")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setGeo(d.geo);
        setDistricts(d.districts ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async (prompt: string, openModal = true) => {
    if (!prompt.trim()) return;
    setValue(prompt);
    setLoading(true);
    if (openModal) setModalOpen(true);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as SimulationResult;
      setResult(data);
    } catch {
      /* keep prior result */
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run a flagship scenario once the city loads — applies to the map but
  // does NOT pop the modal, so the landing view stays calm (map + console).
  useEffect(() => {
    if (geo && !autoRan.current) {
      autoRan.current = true;
      run(SCENARIO_PRESETS[0].prompt, false);
    }
  }, [geo, run]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />

      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row">
        {/* Controls */}
        <aside className="flex min-h-0 shrink-0 flex-col gap-3 lg:w-[360px]">
          <div className="min-h-[360px] flex-[3] lg:min-h-0">
            <ScenarioConsole
              presets={SCENARIO_PRESETS}
              value={value}
              onChange={setValue}
              onRun={(p) => run(p)}
              loading={loading}
            />
          </div>
          <div className="min-h-[220px] flex-[2] lg:min-h-0">
            <CitizenPulse />
          </div>
        </aside>

        {/* Map canvas */}
        <main className="relative min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-white/5 shadow-panel">
          <CityMap
            geo={geo}
            overlays={result?.overlays ?? []}
            focus={result?.mapFocus}
            districts={districts}
            highlightBusRoutes={result?.scenario.domains.includes("transit") ?? false}
          />

          {result && !modalOpen && (
            <button
              onClick={() => setModalOpen(true)}
              className="absolute bottom-4 right-4 z-[600] inline-flex items-center gap-2.5 rounded-full border border-accent/40 bg-accent/15 px-4 py-2.5 text-sm font-semibold text-accent shadow-glow backdrop-blur-md transition hover:bg-accent/25"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              View analysis
              <span className="rounded-full bg-ink-950/40 px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
                {Math.round(result.confidence * 100)}%
              </span>
            </button>
          )}

          {!result && !loading && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-[600] -translate-x-1/2 rounded-full border border-white/10 bg-ink-950/70 px-4 py-2 text-xs text-slate-400 backdrop-blur">
              <BarChart3 className="mr-1.5 inline h-3.5 w-3.5 text-accent" strokeWidth={2} />
              Ask the city a “what if” to begin
            </div>
          )}
        </main>
      </div>

      <ResultModal
        open={modalOpen}
        loading={loading}
        result={result}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
