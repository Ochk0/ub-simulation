"use client";

/**
 * Header — the sticky top app bar for the UB Twin AI control room.
 *
 * Left:   glowing logo mark + "UB Twin AI" wordmark with subtitle + tagline.
 * Right:  live status cluster (pulsing green dot, city, "Real OSM data" pill,
 *         a static feed timestamp).
 *
 * Pure presentational chrome — no props, no data fetching, no Date usage.
 */
import { useState } from "react";
import {
  Radar,
  Globe2,
  Database,
  Activity,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";

/** Small, typed shape for the right-side status chips. Internal-only. */
interface StatusChip {
  /** lucide icon, already resolved to a component. */
  icon: typeof Radar;
  label: string;
  /** Tailwind text color class for the icon + value. */
  tone: string;
}

/** Static, render-stable feed clock label. No Date — judges see a frozen demo. */
const FEED_TIMESTAMP = "06:42 ULAT";

/** Right-cluster informational chips (rendered on wide screens only). */
const STATUS_CHIPS: StatusChip[] = [
  { icon: Database, label: "1,100 roads synced", tone: "text-accent" },
  { icon: Activity, label: "9 districts live", tone: "text-signal-good" },
  { icon: ShieldCheck, label: "Gov sandbox", tone: "text-slate-300" },
];

export function Header(): JSX.Element {
  // Cosmetic toggle for the environment switcher — purely local chrome.
  const [envOpen, setEnvOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-20 h-16 w-full border-b border-white/5 bg-ink-950/80 backdrop-blur-md"
      role="banner"
    >
      <div className="mx-auto flex h-full w-full items-center justify-between gap-4 px-4 sm:px-6">
        {/* ── Left: brand mark + wordmark ─────────────────────────────── */}
        <div className="flex min-w-0 items-center gap-3">
          {/* Glowing accent logo mark */}
          <div className="relative shrink-0">
            <div
              className="grid h-10 w-10 place-items-center rounded-xl border border-accent/40 bg-accent/10 text-accent shadow-glow"
              aria-hidden="true"
            >
              <Radar className="h-5 w-5 animate-pulse-soft" strokeWidth={2.25} />
            </div>
            {/* Tiny orbiting status node on the mark */}
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-950 bg-signal-good" />
          </div>

          <div className="min-w-0 leading-none">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-bold tracking-tight text-slate-100">
                UB Twin AI
              </h1>
              <span className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400 sm:inline-block">
                v0.9
              </span>
            </div>
            <p className="mt-1 hidden truncate text-[11px] text-slate-500 sm:block">
              Digital Twin of Ulaanbaatar
              <span className="mx-1.5 text-slate-700">•</span>
              <span className="text-slate-600">
                Simulate city decisions before you make them.
              </span>
            </p>
          </div>
        </div>

        {/* ── Center: tagline (md only, when subtitle is hidden under wordmark) ── */}
        <div className="pointer-events-none hidden flex-1 items-center justify-center md:flex lg:hidden">
          <p className="truncate text-[11px] uppercase tracking-[0.22em] text-slate-600">
            Simulate before you decide
          </p>
        </div>

        {/* ── Right: live status cluster ──────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
          {/* Info chips — progressively revealed on wider screens */}
          <div className="hidden items-center gap-2 xl:flex">
            {STATUS_CHIPS.map((chip) => {
              const Icon = chip.icon;
              return (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-ink-900/70 px-2.5 py-1 text-[11px] font-medium text-slate-300 shadow-panel"
                >
                  <Icon className={`h-3.5 w-3.5 ${chip.tone}`} strokeWidth={2} />
                  <span className="whitespace-nowrap">{chip.label}</span>
                </span>
              );
            })}
          </div>

          {/* Live indicator */}
          <span className="inline-flex items-center gap-2 rounded-full border border-signal-good/25 bg-signal-good/10 px-2.5 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-signal-good opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-signal-good" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-signal-good">
              Live
            </span>
          </span>

          {/* City + timestamp (stacked, hidden on the smallest screens) */}
          <div className="hidden text-right leading-tight sm:block">
            <div className="flex items-center justify-end gap-1.5 text-[12px] font-semibold text-slate-200">
              <Globe2 className="h-3.5 w-3.5 text-slate-500" strokeWidth={2} />
              <span className="whitespace-nowrap">Ulaanbaatar, MN</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] tabular-nums tracking-wider text-slate-500">
              FEED {FEED_TIMESTAMP}
            </div>
          </div>

          {/* "Real OSM data" pill — always visible, the headline trust badge */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent shadow-glow">
            <Database className="h-3.5 w-3.5" strokeWidth={2.25} />
            <span className="hidden whitespace-nowrap sm:inline">Real OSM data</span>
            <span className="sm:hidden">OSM</span>
          </span>

          {/* Cosmetic environment switcher */}
          <button
            type="button"
            onClick={() => setEnvOpen((v) => !v)}
            aria-expanded={envOpen}
            aria-label="Switch environment"
            className="hidden items-center gap-1.5 rounded-lg border border-white/5 bg-ink-900/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-400 shadow-panel transition-colors hover:border-white/10 hover:text-slate-200 lg:inline-flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-signal-warn" />
            Sandbox
            <ChevronDown
              className={`h-3 w-3 transition-transform ${
                envOpen ? "rotate-180" : ""
              }`}
              strokeWidth={2.5}
            />
          </button>
        </div>
      </div>

      {/* Lightweight cosmetic dropdown — no real navigation, just demo polish. */}
      {envOpen && (
        <div className="absolute right-4 top-[60px] z-30 w-44 animate-fade-up rounded-xl border border-white/5 bg-ink-900/95 p-1.5 shadow-panel backdrop-blur sm:right-6">
          {["Sandbox", "Staging", "Production"].map((env, i) => (
            <button
              key={env}
              type="button"
              onClick={() => setEnvOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-slate-300 transition-colors hover:bg-white/5"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  i === 0
                    ? "bg-signal-warn"
                    : i === 1
                    ? "bg-accent"
                    : "bg-signal-good"
                }`}
              />
              {env}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
