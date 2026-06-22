/**
 * UB Twin AI — natural-language scenario layer.
 *
 * Turns a free-form policy prompt ("close Peace Avenue for a week", "add 50
 * electric buses") into a structured {@link Scenario} the simulation engine can
 * run. This is the rule-based baseline parser: a clean, pure, deterministic
 * function that an LLM parser can later drop in behind the same signature.
 *
 * It does NOT touch geometry or run any simulation — it only extracts intent
 * (numbers + keywords) into {@link ScenarioParams} and decides which domains
 * are affected. The domain simulators read those params and build the real
 * map overlays from CityData.
 *
 * Pure & deterministic: no Math.random, no Date, no I/O. Every value (including
 * the id suffix) is derived from the input prompt.
 */
import type { Scenario, ScenarioParams, ScenarioPreset, SimDomain } from "@/lib/types";
import { PLACES } from "@/lib/constants";

/* ──────────────────────────────────────────────────────────────────────────
 * Preset library — the clickable scenarios shown in the UI. Each prompt is
 * phrased so parseScenario() resolves it to the intended primary domain.
 * ────────────────────────────────────────────────────────────────────────── */
export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "adaptive-signals-peace-ave",
    title: "Adaptive AI Traffic Lights On Peace Avenue",
    prompt: "Install adaptive AI traffic lights on Peace Avenue",
    icon: "TrafficCone",
    domain: "traffic",
    teaser: "Smart green-waves smooth the city's busiest east-west arterial.",
  },
  {
    id: "ambulance-station-yarmag",
    title: "Add An Ambulance Station In Yarmag",
    prompt: "Add an ambulance station in Yarmag",
    icon: "Siren",
    domain: "emergency",
    teaser: "New base cuts response times for the city's fast-growing south-west.",
  },
  {
    id: "coal-to-electric-30",
    title: "30% Of Coal Heating Switches To Electric",
    prompt: "30% of coal-heated households switch to electric heating",
    icon: "Wind",
    domain: "pollution",
    teaser: "Fewer raw-coal stoves means a real dent in winter PM2.5.",
  },
  {
    id: "add-50-electric-buses",
    title: "Add 50 Electric Buses",
    prompt: "Add 50 electric buses to the fleet",
    icon: "Bus",
    domain: "transit",
    teaser: "More capacity, zero tailpipe emissions on busy corridors.",
  },
  {
    id: "close-peace-avenue-week",
    title: "Close Peace Avenue For One Week",
    prompt: "Close Peace Avenue for one week",
    icon: "Construction",
    domain: "traffic",
    teaser: "Stress-test the network when the main artery goes dark.",
  },
  {
    id: "bike-shift-20",
    title: "20% Of Commuters Switch To Bicycles",
    prompt: "20% of commuters switch to bicycles",
    icon: "Bike",
    domain: "traffic",
    teaser: "Fewer cars in the core ease both congestion and emissions.",
  },
  {
    id: "schools-start-one-hour-later",
    title: "Schools Start One Hour Later",
    prompt: "Schools start one hour later",
    icon: "Clock",
    domain: "traffic",
    teaser: "Peak-spreading flattens the morning rush.",
  },
  {
    id: "remote-fridays",
    title: "Government Offices Go Remote Every Friday",
    prompt: "Government offices go remote every Friday",
    icon: "Building2",
    domain: "energy",
    teaser: "One fewer commute day trims energy use and downtown traffic.",
  },
];

/* ──────────────────────────────────────────────────────────────────────────
 * Number extraction
 * ────────────────────────────────────────────────────────────────────────── */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** First percentage in the text ("30%" / "30 percent") as a bare integer. */
function firstPercent(text: string): number | undefined {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  return m ? Number(m[1]) : undefined;
}

/** First plain integer in the text (ignores ones glued to %). */
function firstInt(text: string): number | undefined {
  const m = text.replace(/\d+(?:\.\d+)?\s*(?:%|percent)/g, " ").match(/\b(\d+)\b/);
  return m ? Number(m[1]) : undefined;
}

/** First word-number (one..twelve) in the text. */
function firstWordNumber(text: string): number | undefined {
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return n;
  }
  return undefined;
}

/** A count from digits OR word-numbers, with a fallback default. */
function count(text: string, fallback: number): number {
  return firstInt(text) ?? firstWordNumber(text) ?? fallback;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Place + helper resolution
 * ────────────────────────────────────────────────────────────────────────── */
/** Match any known PLACES key mentioned in the text. */
function findPlace(text: string): { key: string; label: string } | undefined {
  for (const key of Object.keys(PLACES)) {
    if (text.includes(key)) return { key, label: PLACES[key].label };
  }
  return undefined;
}

/** Title Case a phrase ("peace avenue" -> "Peace Avenue"). */
function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Kebab-slug + deterministic suffix derived from the prompt length. */
function makeId(title: string, prompt: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Suffix is purely a function of the prompt (length) — stable, no clock/random.
  return `${base}-${prompt.length.toString(36)}`;
}

/** Push a domain once, preserving primary-first order. */
function addDomain(domains: SimDomain[], d: SimDomain): void {
  if (!domains.includes(d)) domains.push(d);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Parser
 * ────────────────────────────────────────────────────────────────────────── */
export function parseScenario(prompt: string): Scenario {
  const text = prompt.toLowerCase();
  const params: ScenarioParams = {};
  const domains: SimDomain[] = [];
  let title = "";
  let confidence = 0.5; // weak/generic match default

  // ── Road closure: "close/shut <road>". Capture the road phrase. ──────────
  const closeMatch = text.match(/(?:clos\w*|shut\w*)\s+(?:down\s+|off\s+)?(?:the\s+)?([a-z][a-z\s]*?)(?:\s+(?:for|down|street|road|avenue\b)|$|,|\.)/);
  if (/clos\w*|shut\w*/.test(text)) {
    const place = findPlace(text);
    let road = place?.label ?? (closeMatch ? titleCase(closeMatch[1]) : "");
    if (!road && /peace/.test(text)) road = "Peace Avenue";
    if (road) {
      params.roadClosure = road;
      addDomain(domains, "traffic");
      addDomain(domains, "pollution"); // diverted idling traffic shifts emissions
      title = `Close ${road}`;
      confidence = 0.9;
    }
  }

  // ── Adaptive / smart / AI signals. ───────────────────────────────────────
  if (/(adaptive|smart|ai)\b/.test(text) && /(light|signal)/.test(text)) {
    params.adaptiveSignals = true;
    addDomain(domains, "traffic");
    const place = findPlace(text);
    title = place ? `Adaptive Signals On ${place.label}` : "Adaptive AI Traffic Signals";
    confidence = 0.9;
  }

  // ── Modal shift to bikes: "<pct>% ... bike/cycle". ───────────────────────
  if (/(bicycle|bike|cycl)/.test(text)) {
    const pct = firstPercent(text);
    if (pct !== undefined) params.modalShiftToBike = pct / 100;
    addDomain(domains, "traffic");
    addDomain(domains, "pollution");
    title = `${pct ?? ""}% Commuters Switch To Bicycles`.replace(/^%/, "Commuters Switch To Bicycles").trim();
    confidence = pct !== undefined ? 0.9 : 0.6;
  }

  // ── Schedule shift: school/work start "later" / "one hour". ──────────────
  if (/(school|work|office|start)/.test(text) && /(later|hour)/.test(text)) {
    const hours = /hour/.test(text) ? count(text, 1) : count(text, 1);
    params.scheduleShiftHours = hours;
    addDomain(domains, "traffic");
    addDomain(domains, "transit");
    const who = /school/.test(text) ? "Schools" : "Offices";
    title = `${who} Start ${hours} Hour${hours === 1 ? "" : "s"} Later`;
    confidence = 0.85;
  }

  // ── Buses: "add N buses", electric / new route flags. ────────────────────
  if (/\bbus(es)?\b/.test(text) && /(add|new|more|extra|introduce|deploy)/.test(text)) {
    const n = count(text, 0);
    if (n > 0) params.addBuses = n;
    if (/electric/.test(text)) params.electricBuses = true;
    if (/new bus route|new route/.test(text)) params.newBusRoute = true;
    addDomain(domains, "transit");
    if (params.electricBuses) addDomain(domains, "pollution");
    const kind = params.electricBuses ? "Electric Buses" : "Buses";
    title = params.newBusRoute && !n ? "New Bus Route" : `Add ${n} ${kind}`;
    confidence = 0.9;
  }

  // ── Emergency station: ambulance / fire station at a place. ──────────────
  if (/(ambulance|fire)/.test(text) && /\bstation\b/.test(text)) {
    const kind: "ambulance" | "fire" = /fire/.test(text) ? "fire" : "ambulance";
    const place = findPlace(text);
    params.addStation = {
      kind,
      ...(place ? { place: place.label, at: { lat: PLACES[place.key].lat, lng: PLACES[place.key].lng } } : {}),
    };
    addDomain(domains, "emergency");
    const where = place ? ` In ${place.label}` : "";
    title = `Add ${kind === "fire" ? "Fire" : "Ambulance"} Station${where}`;
    confidence = 0.9;
  }

  // ── Coal → electric heating: the main winter PM2.5 lever. ────────────────
  if (/(coal|heating|electric heating)/.test(text) && firstPercent(text) !== undefined) {
    const pct = firstPercent(text)!;
    params.coalToElectric = pct / 100;
    addDomain(domains, "pollution");
    addDomain(domains, "energy");
    title = `${pct}% Coal Heating Switches To Electric`;
    confidence = 0.9;
  }

  // ── Remote work: "remote/WFH" + a day count (friday = 1 day). ────────────
  if (/(remote|work from home|telework|work-from-home)/.test(text)) {
    let days = 1;
    if (/\bday/.test(text)) days = count(text, 1);
    else if (/(friday|monday|tuesday|wednesday|thursday)/.test(text)) days = 1;
    params.remoteWorkDays = Math.min(5, Math.max(0, days));
    addDomain(domains, "energy");
    addDomain(domains, "traffic");
    addDomain(domains, "pollution");
    title = days === 1 && /friday/.test(text)
      ? "Government Offices Remote On Fridays"
      : `Remote Work ${params.remoteWorkDays} Day${params.remoteWorkDays === 1 ? "" : "s"} Per Week`;
    confidence = 0.85;
  }

  // ── EV adoption: "<pct>% ... electric car/vehicle / ev". ─────────────────
  if ((/\bev\b/.test(text) || /electric (car|vehicle)/.test(text)) && firstPercent(text) !== undefined) {
    const pct = firstPercent(text)!;
    params.evAdoption = pct / 100;
    addDomain(domains, "pollution");
    addDomain(domains, "traffic");
    if (!title) title = `${pct}% EV Adoption`;
    confidence = Math.max(confidence, 0.85);
  }

  // ── Fallback: nothing recognized → generic, low-confidence traffic run. ──
  if (domains.length === 0) {
    addDomain(domains, "traffic");
    title = titleCase(prompt.trim()).slice(0, 60) || "Custom Traffic Scenario";
    confidence = 0.4;
  }

  return {
    id: makeId(title, prompt),
    title,
    prompt,
    domains,
    params,
    parseConfidence: confidence,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Preset → Scenario: reuse the parser, then pin the curated id/title/domain.
 * ────────────────────────────────────────────────────────────────────────── */
export function presetToScenario(preset: ScenarioPreset): Scenario {
  const parsed = parseScenario(preset.prompt);
  // Ensure the preset's declared primary domain leads the list.
  const domains = [preset.domain, ...parsed.domains.filter((d) => d !== preset.domain)];
  return {
    ...parsed,
    id: preset.id,
    title: preset.title,
    domains,
  };
}
