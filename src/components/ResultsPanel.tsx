"use client";

/**
 * ResultsPanel — the simulation readout for the UB Twin AI control room.
 *
 * Three states:
 *   (1) loading      → shimmering skeleton cards
 *   (2) null result  → inviting empty state
 *   (3) result       → full, dense readout (summary, primary metrics,
 *                      per-domain breakdown with metrics + insights).
 *
 * Pure presentational — no data fetching. Colors are driven entirely by the
 * shared constants so the panel never drifts from the map overlays.
 */
import {
  Car,
  Wind,
  Siren,
  Zap,
  Bus,
  Brain,
  Sparkles,
  PlayCircle,
  Lightbulb,
  Scale,
  AlertTriangle,
  Search,
  type LucideIcon,
} from "lucide-react";
import { DOMAINS, IMPACT_COLORS, IMPACT_TEXT } from "../lib/constants";
import {
  formatValue,
  signedDelta,
  signedPct,
  directionArrow,
} from "../lib/format";
import type {
  SimulationResult,
  Metric,
  DomainResult,
  Insight,
  SimDomain,
  ImpactLevel,
  BudgetEstimate,
} from "../lib/types";

interface ResultsPanelProps {
  result: SimulationResult | null;
  loading: boolean;
}

/** Resolve a DOMAINS[d].icon name to an actual lucide component. */
const DOMAIN_ICONS: Record<string, LucideIcon> = {
  Car,
  Wind,
  Siren,
  Zap,
  Bus,
};

/** Insight kind → impact level (drives the tag color) + label + icon. */
const INSIGHT_META: Record<
  Insight["kind"],
  { level: ImpactLevel; label: string; icon: LucideIcon }
> = {
  recommendation: { level: "good", label: "Recommend", icon: Lightbulb },
  tradeoff: { level: "warn", label: "Trade-off", icon: Scale },
  caution: { level: "bad", label: "Caution", icon: AlertTriangle },
  finding: { level: "neutral", label: "Finding", icon: Search },
};

/** Confidence → tone, by threshold. */
function confidenceTone(pct: number): { text: string; ring: string; label: string } {
  if (pct >= 75)
    return { text: "text-signal-good", ring: "border-signal-good/30 bg-signal-good/10", label: "High" };
  if (pct >= 50)
    return { text: "text-signal-warn", ring: "border-signal-warn/30 bg-signal-warn/10", label: "Moderate" };
  return { text: "text-signal-bad", ring: "border-signal-bad/30 bg-signal-bad/10", label: "Low" };
}

const EYEBROW = "text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500";

export function ResultsPanel(props: ResultsPanelProps): JSX.Element {
  const { result, loading } = props;

  /* ── (1) Loading: skeleton shimmer ─────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4" aria-busy="true" aria-label="Running simulation">
        <div className="h-6 w-2/3 animate-pulse-soft rounded-lg bg-white/10" />
        <div className="glass space-y-2.5 rounded-2xl p-4">
          <div className="h-3 w-1/4 animate-pulse-soft rounded bg-white/10" />
          <div className="h-3 w-full animate-pulse-soft rounded bg-white/5" />
          <div className="h-3 w-5/6 animate-pulse-soft rounded bg-white/5" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass space-y-3 rounded-2xl p-4">
              <div className="h-2.5 w-1/2 animate-pulse-soft rounded bg-white/10" />
              <div className="h-7 w-3/4 animate-pulse-soft rounded bg-white/10" />
              <div className="h-2.5 w-2/3 animate-pulse-soft rounded bg-white/5" />
            </div>
          ))}
        </div>
        <div className="glass h-28 animate-pulse-soft rounded-2xl" />
      </div>
    );
  }

  /* ── (2) Empty: inviting call to action ────────────────────────────── */
  if (!result) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-glow">
          <PlayCircle className="h-8 w-8 animate-pulse-soft" strokeWidth={1.75} />
        </div>
        <div className="space-y-1.5">
          <p className="text-base font-semibold text-slate-200">
            Run a scenario to see the city respond
          </p>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-slate-500">
            Describe a policy or pick a preset. The digital twin will project the
            impact across traffic, air quality, emergency response and more.
          </p>
        </div>
      </div>
    );
  }

  /* ── (3) Full readout ──────────────────────────────────────────────── */
  const { scenario, summary, primaryMetrics, domains, confidence } = result;
  const confPct = Math.round(confidence * 100);
  const conf = confidenceTone(confPct);

  return (
    <div className="flex flex-col gap-5 p-4 animate-fade-up">
      {/* Header: title + confidence chip + domain tags */}
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={EYEBROW}>Simulation Result</p>
            <h2 className="mt-1 text-lg font-bold leading-tight tracking-tight text-slate-100">
              {scenario.title}
            </h2>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${conf.ring} ${conf.text}`}
            title={`Overall model confidence: ${conf.label}`}
          >
            <span className="tabular-nums">{confPct}%</span>
            <span className="font-medium uppercase tracking-[0.14em] opacity-80">
              {conf.label}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result.domains.map((d) => (
            <DomainTag key={d.domain} domain={d.domain} />
          ))}
        </div>
      </header>

      {/* Summary: AI analysis */}
      <section className="glass rounded-2xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" strokeWidth={2} />
          <span className={EYEBROW}>AI Analysis</span>
          <Sparkles className="h-3.5 w-3.5 text-accent/70" strokeWidth={2} />
          {result.aiPowered && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-accent">
              DeepSeek
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{summary}</p>
      </section>

      {/* Primary metrics grid */}
      {primaryMetrics.length > 0 && (
        <section className="space-y-2.5">
          <p className={EYEBROW}>Key Outcomes</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {primaryMetrics.map((m) => (
              <StatCard key={m.key} metric={m} />
            ))}
          </div>
        </section>
      )}

      {/* Cost & ROI */}
      {result.budget && <BudgetSection budget={result.budget} />}

      {/* Per-domain breakdown */}
      <section className="space-y-4">
        <p className={EYEBROW}>Domain Breakdown</p>
        {domains.map((d) => (
          <DomainBlock key={d.domain} domain={d} />
        ))}
      </section>
    </div>
  );
}

/* ── Small presentational building blocks ────────────────────────────── */

function DomainTag({ domain }: { domain: SimDomain }): JSX.Element {
  const meta = DOMAINS[domain];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-ink-800/60 px-2.5 py-1 text-[11px] font-medium text-slate-300">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

function StatCard({ metric }: { metric: Metric }): JSX.Element {
  const tone = IMPACT_TEXT[metric.sentiment];
  return (
    <div className="glass flex flex-col gap-1.5 rounded-2xl p-3.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
        {metric.label}
      </p>
      <p className="text-2xl font-bold tabular-nums text-slate-100">
        {formatValue(metric.predicted, metric.format, metric.unit)}
      </p>
      <p className={`flex items-center gap-1 text-[12px] font-semibold tabular-nums ${tone}`}>
        <span aria-hidden="true">{directionArrow(metric.direction)}</span>
        <span>{signedDelta(metric)}</span>
        <span className="opacity-80">({signedPct(metric.deltaPct)})</span>
      </p>
      <p className="text-[11px] text-slate-600">
        from {formatValue(metric.baseline, metric.format, metric.unit)}
      </p>
    </div>
  );
}

function BudgetSection({ budget }: { budget: BudgetEstimate }): JSX.Element {
  const t = (n: number) => formatValue(n, "currency");
  const net = budget.annualBenefit - budget.annualCost;
  return (
    <section className="space-y-2.5">
      <p className={EYEBROW}>
        Cost &amp; ROI <span className="ml-1 normal-case tracking-normal text-slate-600">· indicative</span>
      </p>
      <div className="glass space-y-3 rounded-2xl p-4">
        <div className="grid grid-cols-3 gap-3">
          <Fig label="Capital" value={t(budget.capitalCost)} />
          <Fig label="Annual benefit" value={t(budget.annualBenefit)} tone="text-signal-good" />
          <Fig
            label="Payback"
            value={budget.paybackYears == null ? "—" : `${budget.paybackYears} yr`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-bold text-accent">
            {budget.benefitCostRatio.toFixed(1)}× benefit/cost
          </span>
          <span className="text-slate-500">
            over {budget.horizonYears}y · net {t(net)}/yr
          </span>
        </div>
        <p className="text-[12px] leading-relaxed text-slate-400">{budget.verdict}</p>
        {budget.lines.length > 0 && (
          <div className="space-y-1 border-t border-white/5 pt-2">
            {budget.lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-slate-500">{l.label}</span>
                <span
                  className={`shrink-0 tabular-nums ${l.kind === "benefit" ? "text-signal-good" : "text-slate-300"}`}
                >
                  {l.kind === "benefit" ? "+" : "−"}
                  {t(l.amount)}
                  {l.kind === "operating" || l.kind === "benefit" ? "/yr" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-0.5 text-base font-bold tabular-nums ${tone ?? "text-slate-100"}`}>{value}</p>
    </div>
  );
}

function DomainBlock({ domain }: { domain: DomainResult }): JSX.Element {
  const meta = DOMAINS[domain.domain];
  const Icon = DOMAIN_ICONS[meta.icon] ?? Search;
  return (
    <div className="glass rounded-2xl p-4">
      {/* Domain header */}
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border"
          style={{
            color: meta.color,
            borderColor: `${meta.color}40`,
            backgroundColor: `${meta.color}18`,
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-slate-100">{meta.label}</p>
          <p className="truncate text-[12px] text-slate-400">{domain.headline}</p>
        </div>
      </div>

      {/* Compact metric rows */}
      {domain.metrics.length > 0 && (
        <div className="mt-3 divide-y divide-white/5 border-y border-white/5">
          {domain.metrics.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-3 py-2">
              <span className="truncate text-[12px] text-slate-400">{m.label}</span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">
                <span className="text-[13px] font-semibold text-slate-100">
                  {formatValue(m.predicted, m.format, m.unit)}
                </span>
                <span className={`text-[11px] font-medium ${IMPACT_TEXT[m.sentiment]}`}>
                  {directionArrow(m.direction)} {signedPct(m.deltaPct)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {domain.insights.length > 0 && (
        <ul className="mt-3 space-y-2">
          {domain.insights.map((ins, i) => (
            <InsightRow key={`${ins.kind}-${i}`} insight={ins} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightRow({ insight }: { insight: Insight }): JSX.Element {
  const meta = INSIGHT_META[insight.kind];
  const hex = IMPACT_COLORS[meta.level];
  const Icon = meta.icon;
  return (
    <li className="flex gap-2.5 rounded-xl border border-white/5 bg-ink-800/40 p-2.5">
      <span
        className="mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: hex, backgroundColor: `${hex}1f` }}
      >
        <Icon className="h-3 w-3" strokeWidth={2.5} />
        {meta.label}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-slate-200">{insight.title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-400">{insight.detail}</p>
      </div>
    </li>
  );
}
