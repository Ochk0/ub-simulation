"use client";

/**
 * Citizen Pulse — the live civic-sentiment panel. Pulls real Facebook + news
 * trends from /api/pulse (tsaaguur.mn) so the twin reflects what the public is
 * actually talking about right now, alongside the physical simulation.
 */
import { useEffect, useState } from "react";
import { Flame, MessageSquare, TrendingUp, Dot } from "lucide-react";
import type { CitizenPulse as Pulse, Sentiment } from "@/lib/social/types";
import { compact } from "@/lib/format";

const SENT: Record<Sentiment, { dot: string; text: string; label: string }> = {
  positive: { dot: "bg-signal-good", text: "text-signal-good", label: "Эерэг" },
  neutral: { dot: "bg-slate-400", text: "text-slate-400", label: "Төвийг сахисан" },
  negative: { dot: "bg-signal-bad", text: "text-signal-bad", label: "Сөрөг" },
};

export function CitizenPulse(): JSX.Element {
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/pulse")
      .then((r) => r.json())
      .then((d: Pulse) => alive && setPulse(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const updated = pulse?.updatedAt?.slice(11, 16);
  const dist = sentimentDist(pulse);

  return (
    <section className="glass flex h-full min-h-0 flex-col rounded-2xl" aria-label="Citizen pulse">
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-400" strokeWidth={2.25} />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200">
              Citizen Pulse
            </p>
            <p className="text-[10px] text-slate-500">
              tsaaguur.mn · {pulse?.trends.length ?? 0} trends
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] ${
            pulse?.live
              ? "border-signal-good/30 bg-signal-good/10 text-signal-good"
              : "border-white/10 bg-white/5 text-slate-400"
          }`}
          title={pulse?.live ? "Live from tsaaguur.mn" : "Bundled sample — wire TSAAGUUR_API_URL for live"}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pulse?.live ? "bg-signal-good animate-pulse-soft" : "bg-slate-500"}`} />
          {pulse?.live ? "Live" : "Sample"}
        </span>
      </header>

      {/* Sentiment distribution bar */}
      {pulse && (
        <div className="flex h-1.5 w-full overflow-hidden">
          <span className="bg-signal-good" style={{ width: `${dist.positive}%` }} />
          <span className="bg-slate-500" style={{ width: `${dist.neutral}%` }} />
          <span className="bg-signal-bad" style={{ width: `${dist.negative}%` }} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!pulse && (
          <div className="grid h-full place-items-center text-xs text-slate-500">
            Loading public trends…
          </div>
        )}
        <ul className="space-y-0.5">
          {pulse?.trends.map((t) => {
            const s = SENT[t.sentiment];
            return (
              <li
                key={t.id}
                className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-500">
                  {t.rank}
                </span>
                <span className="shrink-0 text-sm leading-none">{t.emoji ?? "📊"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-slate-200">{t.title}</p>
                  {t.titleEn && (
                    <p className="truncate text-[10px] text-slate-500">{t.titleEn}</p>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500">
                  <MessageSquare className="h-3 w-3" strokeWidth={2} />
                  {compact(t.reactions)}
                </span>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`}
                  title={s.label}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <footer className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3 w-3" strokeWidth={2} />
          {pulse?.clusters.length ?? 0} themes
        </span>
        <span className="inline-flex items-center">
          <Dot className="h-4 w-4 text-signal-good" />
          {updated ? `Updated ${updated}` : "—"}
        </span>
      </footer>
    </section>
  );
}

function sentimentDist(pulse: Pulse | null): Record<Sentiment, number> {
  if (!pulse || !pulse.trends.length) return { positive: 34, neutral: 33, negative: 33 };
  const c = { positive: 0, neutral: 0, negative: 0 } as Record<Sentiment, number>;
  for (const t of pulse.trends) c[t.sentiment]++;
  const total = pulse.trends.length;
  return {
    positive: (c.positive / total) * 100,
    neutral: (c.neutral / total) * 100,
    negative: (c.negative / total) * 100,
  };
}
