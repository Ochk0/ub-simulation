"use client";

/**
 * Future Risk Radar — the proactive "what's coming" feed.
 *
 * Renders the engine's {@link RiskPrediction} list as an urgent, live-feeling
 * vertical timeline: severity-coded dots, per-kind glyphs, ETA chips and
 * locations. Purely presentational — no data fetching.
 */
import {
  Radar,
  Car,
  Wind,
  Bus,
  TriangleAlert,
  Zap,
  Droplets,
  MapPin,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { IMPACT_COLORS } from "../lib/constants";
import type { ImpactLevel, RiskPrediction } from "../lib/types";

interface RiskFeedProps {
  risks: RiskPrediction[];
}

/** Per-kind lucide glyphs (explicit map — no dynamic resolution). */
const KIND_ICON: Record<RiskPrediction["kind"], LucideIcon> = {
  traffic: Car,
  pollution: Wind,
  transit: Bus,
  accident: TriangleAlert,
  energy: Zap,
  flood: Droplets,
};

/** Human label per kind, shown as a faint tag. */
const KIND_LABEL: Record<RiskPrediction["kind"], string> = {
  traffic: "Traffic",
  pollution: "Air",
  transit: "Transit",
  accident: "Accident",
  energy: "Energy",
  flood: "Flood",
};

/** Sort weight so the worst risks surface first. */
const SEVERITY_RANK: Record<ImpactLevel, number> = {
  bad: 0,
  warn: 1,
  neutral: 2,
  good: 3,
};

/** Format minutes-from-now into a compact ETA, e.g. "in 45 min" / "in 1h 30m" / "in 1d". */
function formatEta(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "now";
  if (m < 60) return `in ${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `in ${h}h ${rem}m` : `in ${h}h`;
  }
  const d = Math.floor(m / 1440);
  const remH = Math.floor((m % 1440) / 60);
  return remH ? `in ${d}d ${remH}h` : `in ${d}d`;
}

/** True when an ETA is imminent enough to flag as pressing. */
function isImminent(minutes: number): boolean {
  return minutes <= 60;
}

function RiskRow({ risk, last }: { risk: RiskPrediction; last: boolean }): JSX.Element {
  const KindIcon = KIND_ICON[risk.kind];
  const color = IMPACT_COLORS[risk.severity];
  const urgent = risk.severity === "bad";
  const soon = isImminent(risk.etaMinutes);

  return (
    <li className="relative flex gap-3 pl-1 animate-fade-up">
      {/* Timeline rail + severity dot */}
      <div className="relative flex w-5 shrink-0 flex-col items-center">
        <span
          className={`mt-1.5 h-3 w-3 rounded-full ring-4 ring-ink-900/80 ${
            urgent ? "animate-pulse-soft" : ""
          }`}
          style={{ backgroundColor: color, boxShadow: `0 0 10px -1px ${color}` }}
          aria-hidden
        />
        {!last && (
          <span className="mt-1 w-px flex-1 bg-gradient-to-b from-white/15 to-transparent" />
        )}
      </div>

      {/* Card body */}
      <div className="min-w-0 flex-1 pb-5">
        <div className="rounded-xl border border-white/5 bg-ink-850/50 px-3 py-2.5 transition-colors hover:border-white/10 hover:bg-ink-850/80">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border"
              style={{
                color,
                borderColor: `${color}33`,
                backgroundColor: `${color}14`,
              }}
            >
              <KindIcon className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h4 className="truncate text-sm font-semibold text-slate-100">
                  {risk.title}
                </h4>
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  {KIND_LABEL[risk.kind]}
                </span>
                <span
                  className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                    soon ? "ring-1" : ""
                  }`}
                  style={{
                    color,
                    backgroundColor: `${color}1a`,
                    boxShadow: soon ? `inset 0 0 0 1px ${color}40` : undefined,
                  }}
                >
                  {formatEta(risk.etaMinutes)}
                </span>
              </div>

              <p className="mt-1 text-sm leading-snug text-slate-400">{risk.detail}</p>

              {risk.location?.label && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
                  <MapPin className="h-3 w-3" strokeWidth={2} aria-hidden />
                  <span className="truncate">{risk.location.label}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export function RiskFeed(props: { risks: RiskPrediction[] }): JSX.Element {
  const { risks } = props as RiskFeedProps;

  const sorted = [...risks].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return a.etaMinutes - b.etaMinutes;
  });

  const elevated = sorted.filter(
    (r) => r.severity === "bad" || r.severity === "warn"
  ).length;
  const hasRisks = sorted.length > 0;

  return (
    <section className="glass rounded-2xl p-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent ${
              elevated > 0 ? "animate-pulse-soft" : ""
            }`}
          >
            <Radar className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Predictive
            </p>
            <h3 className="text-base font-semibold text-slate-100">Future Risk Radar</h3>
            <p className="text-xs text-slate-500">What the city should brace for</p>
          </div>
        </div>

        {hasRisks && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
              elevated > 0
                ? "border border-signal-bad/30 bg-signal-bad/10 text-signal-bad"
                : "border border-signal-good/30 bg-signal-good/10 text-signal-good"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full bg-current ${
                elevated > 0 ? "animate-pulse-soft" : ""
              }`}
              aria-hidden
            />
            {elevated > 0 ? `${elevated} elevated` : "stable"}
          </span>
        )}
      </div>

      {/* Feed */}
      <div className="mt-4">
        {hasRisks ? (
          <ul className="max-h-[26rem] overflow-y-auto pr-1">
            {sorted.map((risk, i) => (
              <RiskRow key={risk.id} risk={risk} last={i === sorted.length - 1} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-ink-850/40 px-4 py-10 text-center">
            <ShieldCheck className="h-7 w-7 text-signal-good" strokeWidth={1.75} aria-hidden />
            <p className="text-sm font-medium text-slate-300">
              All clear — no elevated risks predicted.
            </p>
            <p className="text-xs text-slate-500">
              The radar is live and monitoring all city domains.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
