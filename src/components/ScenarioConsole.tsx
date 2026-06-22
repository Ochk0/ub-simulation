"use client";

/**
 * ScenarioConsole — the left "Ask the city" console; the dashboard's primary
 * input surface.
 *
 * Top:    eyebrow + "Ask the city" heading, a large multiline prompt textarea
 *         (Cmd/Ctrl+Enter to submit) and a prominent accent "Simulate" button
 *         that streams a spinner while a run is in flight.
 * Below:  the curated example-scenario library — each {@link ScenarioPreset}
 *         rendered as a tinted, clickable card that fills the input and runs.
 *
 * Pure presentational input chrome: all state lives with the parent via
 * value/onChange/onRun. No data fetching, no Date usage.
 */
import { useRef, type KeyboardEvent } from "react";
import {
  Sparkles,
  Play,
  Loader2,
  ArrowRight,
  CornerDownLeft,
  Lightbulb,
  TrafficCone,
  Siren,
  Wind,
  Bus,
  Construction,
  Bike,
  Clock,
  Building2,
  type LucideIcon,
} from "lucide-react";
import type { ScenarioPreset, SimDomain } from "../lib/types";
import { DOMAINS } from "../lib/constants";

/** Props — owned by the parent dashboard shell. */
interface ScenarioConsoleProps {
  /** Curated example scenarios shown in the library below the input. */
  presets: ScenarioPreset[];
  /** Current prompt text (controlled). */
  value: string;
  /** Push prompt edits / preset selections back up. */
  onChange: (v: string) => void;
  /** Fire a simulation run for the given prompt. */
  onRun: (prompt: string) => void;
  /** A run is in flight — locks the input + presets, shows a spinner. */
  loading: boolean;
}

/**
 * Explicit lucide map for the icon *names* the presets reference. Kept local
 * (and exhaustive over the documented set) so an unknown name degrades to a
 * sensible fallback rather than crashing.
 */
const PRESET_ICONS: Record<string, LucideIcon> = {
  TrafficCone,
  Siren,
  Wind,
  Bus,
  Construction,
  Bike,
  Clock,
  Building2,
};

const FALLBACK_ICON: LucideIcon = Sparkles;

const PLACEHOLDER =
  "What happens if Peace Avenue becomes adaptive AI-controlled?";

/** Resolve a preset's lucide icon name to a component, with a safe fallback. */
function iconFor(name: string): LucideIcon {
  return PRESET_ICONS[name] ?? FALLBACK_ICON;
}

/** Tiny rgba helper so we can tint borders/fills from a domain hex at low alpha. */
function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ScenarioConsole(props: ScenarioConsoleProps): JSX.Element {
  const { presets, value, onChange, onRun, loading } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const canRun = trimmed.length > 0 && !loading;

  const handleRun = (): void => {
    if (!canRun) return;
    onRun(trimmed);
  };

  /** Cmd/Ctrl+Enter submits the active prompt. */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  };

  /** A preset click both fills the input and immediately runs it. */
  const handlePreset = (preset: ScenarioPreset): void => {
    if (loading) return;
    onChange(preset.prompt);
    onRun(preset.prompt);
  };

  return (
    <section
      className="glass flex h-full min-h-0 flex-col rounded-2xl"
      aria-label="Scenario console"
    >
      {/* ── Header + prompt input ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-b border-white/5 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-accent/40 bg-accent/10 text-accent shadow-glow">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
          <div className="leading-none">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Scenario Console
            </p>
            <h2 className="mt-1 text-[17px] font-bold tracking-tight text-slate-100">
              Ask the city
            </h2>
          </div>
        </div>

        {/* Prompt textarea */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={4}
            spellCheck={false}
            placeholder={PLACEHOLDER}
            aria-label="Scenario prompt"
            className="w-full resize-none rounded-xl border border-white/10 bg-ink-950/60 px-3.5 py-3 text-[13px] leading-relaxed text-slate-100 shadow-inner outline-none transition-colors placeholder:text-slate-600 focus:border-accent/50 focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
          />
          <span className="pointer-events-none absolute bottom-2.5 right-3 hidden items-center gap-1 rounded border border-white/5 bg-ink-900/80 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 sm:inline-flex">
            <CornerDownLeft className="h-3 w-3" strokeWidth={2} />
            ⌘↵
          </span>
        </div>

        {/* Simulate button */}
        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun}
          aria-busy={loading}
          className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-deep via-accent to-accent-soft px-4 py-2.5 text-[13px] font-bold tracking-tight text-ink-950 shadow-glow transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:from-ink-700 disabled:via-ink-700 disabled:to-ink-700 disabled:text-slate-500 disabled:shadow-none"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              Simulating…
            </>
          ) : (
            <>
              <Play
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2.5}
                fill="currentColor"
              />
              Simulate
            </>
          )}
        </button>
      </div>

      {/* ── Example scenario library ──────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pb-2 pt-3 sm:px-5">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-slate-500">
          <Lightbulb className="h-3 w-3 text-slate-600" strokeWidth={2.25} />
          Example scenarios
        </p>
        {presets.length > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-slate-600">
            {presets.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 sm:px-5">
        {presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
            <Sparkles className="h-5 w-5 text-slate-600" strokeWidth={1.75} />
            <p className="text-[12px] font-medium text-slate-400">
              No example scenarios loaded
            </p>
            <p className="max-w-[24ch] text-[11px] text-slate-600">
              Type a what-if question above and hit Simulate to query the twin.
            </p>
          </div>
        ) : (
          presets.map((preset, i) => {
            const domain: SimDomain = preset.domain;
            const color = DOMAINS[domain]?.color ?? "#38bdf8";
            const Icon = iconFor(preset.icon);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePreset(preset)}
                disabled={loading}
                title={preset.prompt}
                style={{
                  borderLeftColor: tint(color, 0.55),
                  animationDelay: `${Math.min(i, 8) * 40}ms`,
                }}
                className="group flex w-full animate-fade-up items-start gap-3 rounded-xl border border-white/5 border-l-2 bg-ink-900/50 px-3 py-2.5 text-left transition-all hover:border-white/10 hover:bg-ink-800/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors"
                  style={{
                    color,
                    borderColor: tint(color, 0.3),
                    backgroundColor: tint(color, 0.12),
                  }}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-slate-100">
                      {preset.title}
                    </span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color, backgroundColor: tint(color, 0.12) }}
                    >
                      {DOMAINS[domain]?.label ?? domain}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-slate-400">
                    {preset.teaser}
                  </span>
                </span>
                <ArrowRight
                  className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:text-slate-300"
                  strokeWidth={2.25}
                />
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
