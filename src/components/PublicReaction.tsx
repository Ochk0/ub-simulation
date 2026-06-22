"use client";

/**
 * Public Reaction — bridges the physical simulation and real public opinion.
 * For the active scenario it shows what citizens are ALREADY saying (matched
 * tsaaguur.mn trends), so a planner sees both projected impact AND political
 * reality before acting.
 */
import { Megaphone, MessageSquare, TrendingUp } from "lucide-react";
import type { PublicSignal, Sentiment } from "@/lib/social/types";
import { compact } from "@/lib/format";

const MOOD: Record<string, { text: string; ring: string; dot: string; label: string }> = {
  positive: { text: "text-signal-good", ring: "border-signal-good/30 bg-signal-good/10", dot: "bg-signal-good", label: "Supportive" },
  neutral: { text: "text-slate-300", ring: "border-white/10 bg-white/5", dot: "bg-slate-400", label: "Watching" },
  negative: { text: "text-signal-bad", ring: "border-signal-bad/30 bg-signal-bad/10", dot: "bg-signal-bad", label: "Opposition" },
  mixed: { text: "text-signal-warn", ring: "border-signal-warn/30 bg-signal-warn/10", dot: "bg-signal-warn", label: "Divided" },
  none: { text: "text-slate-400", ring: "border-white/10 bg-white/5", dot: "bg-slate-500", label: "Quiet" },
};

const SENT_DOT: Record<Sentiment, string> = {
  positive: "bg-signal-good",
  neutral: "bg-slate-400",
  negative: "bg-signal-bad",
};

export function PublicReaction({ signal }: { signal?: PublicSignal | null }): JSX.Element | null {
  if (!signal) return null;
  const mood = MOOD[signal.mood] ?? MOOD.none;
  const hasMatches = signal.matched.length > 0;

  return (
    <section className="glass rounded-2xl p-4 animate-fade-up">
      <div className="mb-2 flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-orange-400" strokeWidth={2} />
        <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
          Public Reaction
        </span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${mood.ring} ${mood.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${mood.dot}`} />
          {mood.label}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-slate-300">{signal.headline}</p>

      {hasMatches && (
        <>
          <div className="mt-3 space-y-1.5">
            {signal.matched.map((m) => (
              <div
                key={m.topic.id}
                className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-ink-900/50 px-2.5 py-1.5"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${SENT_DOT[m.topic.sentiment]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-slate-200">{m.topic.title}</p>
                  <p className="truncate text-[10px] text-slate-500">{m.relevance}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                  <MessageSquare className="h-3 w-3" strokeWidth={2} />
                  {compact(m.topic.reactions)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-500">
            <TrendingUp className="h-3 w-3" strokeWidth={2} />
            {compact(signal.engagement)} reactions across matched topics · real signal from tsaaguur.mn
          </div>
        </>
      )}

      {signal.quote && (
        <blockquote className="mt-3 border-l-2 border-orange-400/50 pl-3">
          <p className="line-clamp-3 text-[12px] italic leading-relaxed text-slate-300">
            “{signal.quote.text}”
          </p>
          <footer className="mt-1 text-[10px] text-slate-500">
            — {signal.quote.author} · {compact(signal.quote.likes)} reactions
          </footer>
        </blockquote>
      )}
    </section>
  );
}
