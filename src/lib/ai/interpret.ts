/**
 * LLM scenario understanding (DeepSeek).
 *
 * Turns arbitrary natural language into a structured {@link Scenario}. The
 * rule-based parser already nails the preset prompts instantly, so we only pay
 * for an LLM round-trip when the rules are unsure (novel free-text). The LLM
 * output is strictly validated/coerced and merged over the rule-based result —
 * the LLM never injects untyped fields, and any failure falls back to rules.
 */
import type { Scenario, ScenarioParams, SimDomain } from "@/lib/types";
import { parseScenario } from "@/lib/scenarios";
import { PLACES } from "@/lib/constants";
import { deepseekJSON, isAIEnabled } from "./deepseek";

const DOMAINS: SimDomain[] = ["traffic", "pollution", "emergency", "energy", "transit"];

/** Rules at/above this confidence are trusted as-is (skip the LLM call). */
const TRUST_THRESHOLD = 0.85;

interface LLMScenario {
  title?: string;
  domains?: string[];
  params?: Record<string, unknown>;
  confidence?: number;
}

const SYSTEM = `You convert a citizen or official's natural-language question about Ulaanbaatar city policy into a STRUCTURED scenario for a simulation engine. Respond with JSON only.

Schema:
{
  "title": short Title Case label (<= 7 words),
  "domains": ordered array (primary first) from ["traffic","pollution","emergency","energy","transit"],
  "params": object containing ONLY the keys you are confident about:
     adaptiveSignals (boolean), roadClosure (road name string), modalShiftToBike (0..1),
     scheduleShiftHours (number), addBuses (integer), electricBuses (boolean), newBusRoute (boolean),
     addStation ({ "kind": "ambulance"|"fire", "place"?: string, "district"?: string }),
     coalToElectric (0..1), remoteWorkDays (0..5), evAdoption (0..1),
  "confidence": 0..1
}

Rules: convert percentages to fractions (30% -> 0.3). "one hour" -> 1. Pick at least one domain. A scenario can span multiple domains (e.g. switching coal heating to electric affects both "pollution" and "energy"). For a nonsensical request, still return best-effort with low confidence.`;

export async function interpretScenario(prompt: string): Promise<Scenario> {
  const rules = parseScenario(prompt);
  if (!isAIEnabled() || !prompt.trim() || rules.parseConfidence >= TRUST_THRESHOLD) {
    return rules;
  }

  const ai = await deepseekJSON<LLMScenario>(
    SYSTEM,
    `Question: """${prompt}"""\nReturn JSON.`,
    { maxTokens: 400, temperature: 0 }
  );
  if (!ai) return rules;

  const domains = (Array.isArray(ai.domains) ? ai.domains : []).filter(
    (d): d is SimDomain => (DOMAINS as string[]).includes(d)
  );
  const params: ScenarioParams = { ...rules.params, ...coerceParams(ai.params) };

  return {
    id: rules.id,
    title: typeof ai.title === "string" && ai.title.trim() ? ai.title.trim() : rules.title,
    prompt,
    domains: domains.length ? dedupe(domains) : rules.domains,
    params,
    parseConfidence: clamp01(typeof ai.confidence === "number" ? ai.confidence : rules.parseConfidence),
  };
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp01 = (v: unknown): number => Math.max(0, Math.min(1, num(v) ?? 0));
const dedupe = (ds: SimDomain[]): SimDomain[] => Array.from(new Set(ds));
const titleCase = (s: string) =>
  s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** Whitelist + clamp the LLM params so only known, well-typed fields survive. */
function coerceParams(p: unknown): ScenarioParams {
  const out: ScenarioParams = {};
  if (!p || typeof p !== "object") return out;
  const o = p as Record<string, unknown>;

  if (typeof o.adaptiveSignals === "boolean") out.adaptiveSignals = o.adaptiveSignals;
  if (typeof o.roadClosure === "string" && o.roadClosure.trim()) out.roadClosure = titleCase(o.roadClosure.trim());
  if (num(o.modalShiftToBike) != null) out.modalShiftToBike = clamp01(o.modalShiftToBike);
  if (num(o.scheduleShiftHours) != null) out.scheduleShiftHours = num(o.scheduleShiftHours)!;
  if (num(o.addBuses) != null) out.addBuses = Math.max(0, Math.round(num(o.addBuses)!));
  if (typeof o.electricBuses === "boolean") out.electricBuses = o.electricBuses;
  if (typeof o.newBusRoute === "boolean") out.newBusRoute = o.newBusRoute;
  if (num(o.coalToElectric) != null) out.coalToElectric = clamp01(o.coalToElectric);
  if (num(o.remoteWorkDays) != null) out.remoteWorkDays = Math.max(0, Math.min(5, num(o.remoteWorkDays)!));
  if (num(o.evAdoption) != null) out.evAdoption = clamp01(o.evAdoption);

  if (o.addStation && typeof o.addStation === "object") {
    const s = o.addStation as Record<string, unknown>;
    const kind = s.kind === "fire" ? "fire" : "ambulance";
    const place = typeof s.place === "string" ? s.place : undefined;
    const district = typeof s.district === "string" ? s.district : undefined;
    const known = place ? PLACES[place.toLowerCase()] : undefined;
    out.addStation = {
      kind,
      place,
      district,
      at: known ? { lat: known.lat, lng: known.lng } : undefined,
    };
  }
  return out;
}
