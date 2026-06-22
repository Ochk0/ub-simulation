"use client";

/**
 * Result modal — presents a finished simulation in a focused, spacious overlay
 * so the main view stays a clean map + console. Composes the existing result
 * components into a two-column layout. Closes on Esc / backdrop click; locks
 * body scroll while open.
 */
import { useEffect } from "react";
import { X, BarChart3, Sparkles } from "lucide-react";
import type { SimulationResult } from "@/lib/types";
import { DOMAINS } from "@/lib/constants";
import { ResultsPanel } from "./ResultsPanel";
import { ImpactChart } from "./ImpactChart";
import { RiskFeed } from "./RiskFeed";
import { PublicReaction } from "./PublicReaction";

interface Props {
  open: boolean;
  loading: boolean;
  result: SimulationResult | null;
  onClose: () => void;
}

export function ResultModal({ open, loading, result, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const showResult = !loading && !!result;
  const accent = result?.scenario.domains?.[0] ? DOMAINS[result.scenario.domains[0]].color : "#38bdf8";

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 animate-fade-in bg-ink-950/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex max-h-[92vh] w-full max-w-6xl animate-scale-in flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 shadow-glow">
        {/* accent bar */}
        <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />

        <header className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-accent" strokeWidth={2} />
            <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
              Simulation Result
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!showResult ? (
            <LoadingState />
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ResultsPanel result={result} loading={false} />
              </div>
              <div className="space-y-4 lg:col-span-1">
                <ImpactChart metrics={result.primaryMetrics} />
                <PublicReaction signal={result.publicSignal} />
                <RiskFeed risks={result.risks} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-5 px-6 py-20 text-center">
      <div className="relative h-14 w-14">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/25" />
        <span className="absolute inset-0 grid place-items-center rounded-full border border-accent/40 bg-accent/10">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </span>
      </div>
      <div className="max-w-sm">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-100">
          <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} />
          Running simulation…
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          Modeling traffic, air quality, emergency response, energy and public reaction across
          Ulaanbaatar&rsquo;s digital twin.
        </p>
      </div>
    </div>
  );
}
