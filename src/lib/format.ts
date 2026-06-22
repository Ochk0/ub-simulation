/**
 * Formatting helpers shared by every UI panel and the chart, so numbers,
 * deltas and signs render identically everywhere.
 */
import type { Metric, MetricFormat } from "./types";

const nf = (max = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: max });

/** Format a raw metric value according to its declared format. */
export function formatValue(value: number, format: MetricFormat, unit = ""): string {
  switch (format) {
    case "percent":
      return `${nf(1).format(value)}%`;
    case "minutes": {
      const m = Math.round(value);
      if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
      return `${m} min`;
    }
    case "index":
      return nf(0).format(value);
    case "currency":
      return `₮${compact(value)}`;
    case "number":
    default:
      return unit ? `${compact(value)} ${unit}`.trim() : compact(value);
  }
}

/** Compact large numbers: 32000 → "32K", 1600000 → "1.6M". */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${nf(1).format(value / 1e9)}B`;
  if (abs >= 1e6) return `${nf(2).format(value / 1e6)}M`;
  if (abs >= 1e4) return `${nf(0).format(value / 1e3)}K`;
  if (abs >= 1e3) return `${nf(1).format(value / 1e3)}K`;
  return nf(value % 1 === 0 ? 0 : 1).format(value);
}

/** Signed percent string, e.g. "+12.0%" / "−18.0%". */
export function signedPct(deltaPct: number): string {
  const sign = deltaPct > 0 ? "+" : deltaPct < 0 ? "−" : "";
  return `${sign}${nf(1).format(Math.abs(deltaPct))}%`;
}

/** Signed absolute delta in the metric's units. */
export function signedDelta(metric: Metric): string {
  const { delta, format, unit } = metric;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${formatValue(Math.abs(delta), format, unit)}`;
}

/** Arrow glyph for a metric direction. */
export function directionArrow(direction: Metric["direction"]): string {
  return direction === "up" ? "▲" : direction === "down" ? "▼" : "—";
}
