"use client";

/**
 * ImpactChart — diverging horizontal bar chart of each metric's SIGNED %
 * change vs baseline.
 *
 * Why signed % (deltaPct) and not a normalized baseline=100 bar: metrics whose
 * value crosses zero (e.g. grid headroom 11.5% → −16.2%) make a predicted/baseline
 * ratio meaningless (it renders a nonsensical −141% bar). The signed percentage
 * change is always well-defined, so we draw one bar per metric diverging from a
 * zero reference line — negative left, positive right.
 *
 * Robustness:
 *  - Bars are colored by metric.sentiment (good/bad/warn/neutral), NOT by sign,
 *    so "lower is better" metrics read correctly.
 *  - The x-domain is symmetric and outlier-robust: capped at
 *    clamp(maxAbsDelta, 20, 120). Bars beyond the cap are CLAMPED for display,
 *    but the true deltaPct is always shown as an end label and in the tooltip.
 */
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { IMPACT_COLORS } from "@/lib/constants";
import { formatValue, signedPct } from "@/lib/format";
import type { Metric } from "@/lib/types";

/** One row fed to the BarChart: clamped value for drawing, true metric for labels. */
interface ChartRow {
  key: string;
  label: string;
  /** deltaPct clamped to [-cap, cap] — what the bar actually draws. */
  clamped: number;
  fill: string;
  metric: Metric;
}

const ROW_PX = 46;

/** Trim long metric category labels so the vertical axis stays readable. */
function truncate(label: string, max = 22): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1).trimEnd()}…`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Symmetric, outlier-robust axis cap from the largest |deltaPct|. */
function axisCap(metrics: Metric[]): number {
  const maxAbs = metrics.reduce((m, metric) => {
    const d = metric.deltaPct;
    return Number.isFinite(d) ? Math.max(m, Math.abs(d)) : m;
  }, 0);
  return Math.min(120, Math.max(20, maxAbs));
}

function buildRows(metrics: Metric[], cap: number): ChartRow[] {
  return metrics.map((metric) => {
    const raw = Number.isFinite(metric.deltaPct) ? metric.deltaPct : 0;
    return {
      key: metric.key,
      label: metric.label,
      clamped: clamp(raw, -cap, cap),
      fill: IMPACT_COLORS[metric.sentiment] ?? IMPACT_COLORS.neutral,
      metric,
    };
  });
}

/** Custom dark tooltip: label + baseline → predicted + signed %. */
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const { metric } = row;
  const color = IMPACT_COLORS[metric.sentiment] ?? IMPACT_COLORS.neutral;

  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/95 px-3 py-2.5 shadow-panel backdrop-blur">
      <p className="mb-1.5 text-[12px] font-semibold text-slate-100">{metric.label}</p>
      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
        <span className="text-slate-400">
          {formatValue(metric.baseline, metric.format, metric.unit)}
        </span>
        <span className="text-slate-600">→</span>
        <span className="font-semibold text-slate-100">
          {formatValue(metric.predicted, metric.format, metric.unit)}
        </span>
      </div>
      <div className="mt-2 border-t border-white/5 pt-1.5 text-[11px]">
        <span className="text-slate-500">Change </span>
        <span className="font-mono font-semibold tabular-nums" style={{ color }}>
          {signedPct(metric.deltaPct)}
        </span>
      </div>
    </div>
  );
}

/** Tick renderer that truncates labels and keeps them on-theme. */
function YAxisTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
}): JSX.Element {
  return (
    <text
      x={x}
      y={y}
      dx={-6}
      dy={4}
      textAnchor="end"
      className="fill-slate-400"
      fontSize={11}
    >
      {truncate(payload?.value ?? "")}
    </text>
  );
}

/** End-of-bar label showing the TRUE signed % (even when the bar is clamped). */
function DeltaLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  index?: number;
  rows: ChartRow[];
}): JSX.Element | null {
  const { x, y, width, height, index, rows } = props;
  const row = typeof index === "number" ? rows[index] : undefined;
  if (!row || x == null || y == null) return null;

  const nx = Number(x);
  const ny = Number(y);
  const nw = Number(width ?? 0);
  const nh = Number(height ?? 0);
  // Positive bars grow right → label to the right; negative grow left → label left.
  const positive = row.metric.deltaPct >= 0;
  const cy = ny + nh / 2 + 4;
  const cx = positive ? nx + nw + 6 : nx - 6;

  return (
    <text
      x={cx}
      y={cy}
      fontSize={10}
      fontWeight={600}
      fill={row.fill}
      textAnchor={positive ? "start" : "end"}
    >
      {signedPct(row.metric.deltaPct)}
    </text>
  );
}

export function ImpactChart(props: { metrics: Metric[] }): JSX.Element {
  const { metrics } = props;
  const cap = useMemo(() => axisCap(metrics), [metrics]);
  const rows = useMemo(() => buildRows(metrics, cap), [metrics, cap]);

  // Dynamic height so 1 metric isn't lonely and 8 aren't crushed.
  const chartHeight = Math.max(180, rows.length * ROW_PX);

  return (
    <section className="glass animate-fade-up rounded-2xl p-4">
      <header className="mb-3">
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
          Projected change vs baseline
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="flex h-[140px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 text-center">
          <p className="text-sm text-slate-400">No metrics to compare yet</p>
          <p className="text-[11px] text-slate-500">
            Run a scenario to see projected impact.
          </p>
        </div>
      ) : (
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
              barCategoryGap="26%"
            >
              <ReferenceLine
                x={0}
                stroke="rgba(148,163,184,0.45)"
                strokeWidth={1}
              />
              <XAxis
                type="number"
                domain={[-cap, cap]}
                allowDataOverflow
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={132}
                tickLine={false}
                axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
                tick={<YAxisTick />}
                interval={0}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.07)" }}
                content={<ChartTooltip />}
              />
              <Bar
                dataKey="clamped"
                radius={[2, 2, 2, 2]}
                maxBarSize={18}
                isAnimationActive={false}
              >
                {rows.map((row) => (
                  <Cell key={row.key} fill={row.fill} />
                ))}
                <LabelList
                  dataKey="clamped"
                  content={(p) => <DeltaLabel {...p} rows={rows} />}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
