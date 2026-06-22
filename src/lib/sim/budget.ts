/**
 * UB Twin AI — indicative cost–benefit engine.
 *
 * Turns a {@link Scenario} (the levers a policy pulls) and its
 * {@link SimulationResult} (the modelled outcomes) into a back-of-the-envelope
 * {@link BudgetEstimate} in Mongolian tögrög (₮ / MNT; ≈3,500₮ = $1).
 *
 * Costs are derived from the scenario parameters (what we're *doing*); benefits
 * are scanned out of the simulated metrics (what we *get*). Everything is pure
 * and deterministic — no Math.random, no Date, no I/O — so the same inputs
 * always yield the same case. Figures are indicative, sized to UB at city
 * scale, and meant to frame a decision rather than to budget a tender.
 */
import type {
  Scenario,
  SimulationResult,
  Metric,
  BudgetEstimate,
  BudgetLine,
} from "@/lib/types";
import { TOTAL_HOUSEHOLDS } from "@/lib/city";

/* ── Cost constants (₮, MNT) ─────────────────────────────────────────────── */

/** Adaptive signal control: city-wide controller + detector rollout. */
const SIGNALS_CAPITAL = 14_000_000_000;
const SIGNALS_ANNUAL = 1_200_000_000;

/** Per-bus capital, by drivetrain, and per-bus annual operating. */
const BUS_CAPITAL_ELECTRIC = 1_300_000_000;
const BUS_CAPITAL_DIESEL = 700_000_000;
const BUS_ANNUAL = 120_000_000;

/** Emergency station (ambulance/fire): build + standing crew & vehicles. */
const STATION_CAPITAL = 5_000_000_000;
const STATION_ANNUAL = 1_800_000_000;

/** Coal→electric heat conversion (per converted household). */
const GER_SHARE = 0.55; // ≈ share of households on raw-coal ger heating
const CONVERT_CAPITAL_PER_HH = 6_000_000; // heat-pump + retrofit subsidy
const CONVERT_ANNUAL_PER_HH = 250_000; // grid / electricity support

/** Protected bike-lane network: ₮ per (f×100) km-equivalent of network. */
const BIKE_CAPITAL_PER_UNIT = 900_000_000;
const BIKE_ANNUAL_RATE = 0.1; // maintenance ≈ 10% of capital / yr

/** A single new bus route (vehicles + depot allocation + operations). */
const ROUTE_CAPITAL = 2_500_000_000;
const ROUTE_ANNUAL = 800_000_000;

/** Road closure: no capital; an annual economic-disruption operating cost. */
const ROAD_CLOSURE_ANNUAL = 9_000_000_000;

/* ── Benefit constants ───────────────────────────────────────────────────── */

/** Motorised commute trips affected by travel-time changes (city-wide /day). */
const MOTOR_TRIPS = 300_000;
/** Value of an hour of a citizen's time (₮/hr). */
const VALUE_OF_TIME = 5_500;
/** Working days monetised per year. */
const WORKDAYS = 250;
/** Shadow price of avoided CO₂ (₮/ton). */
const CARBON_PRICE = 90_000;
/** Horizon for the cost–benefit case. */
const HORIZON_YEARS = 5;

const round = (n: number): number => Math.round(n);

/* ── Cost derivation ─────────────────────────────────────────────────────── */

interface CostBuild {
  capital: number;
  annual: number;
  lines: BudgetLine[];
}

/** Build capital + operating lines from the levers present in the scenario. */
function buildCosts(scenario: Scenario): CostBuild {
  const p = scenario.params;
  const lines: BudgetLine[] = [];
  let capital = 0;
  let annual = 0;

  const capLine = (label: string, amount: number, note?: string) => {
    if (amount <= 0) return;
    capital += amount;
    lines.push({ label, amount: round(amount), kind: "capital", note });
  };
  const opLine = (label: string, amount: number, note?: string) => {
    if (amount <= 0) return;
    annual += amount;
    lines.push({ label, amount: round(amount), kind: "operating", note });
  };

  // Adaptive traffic signals.
  if (p.adaptiveSignals) {
    capLine("Adaptive signal system (city-wide)", SIGNALS_CAPITAL);
    opLine("Signal system maintenance", SIGNALS_ANNUAL);
  }

  // Added buses.
  const buses = typeof p.addBuses === "number" ? Math.max(0, Math.round(p.addBuses)) : 0;
  if (buses > 0) {
    const electric = Boolean(p.electricBuses);
    const perBus = electric ? BUS_CAPITAL_ELECTRIC : BUS_CAPITAL_DIESEL;
    const drivetrain = electric ? "electric" : "diesel";
    capLine(
      `${buses} ${drivetrain} buses`,
      buses * perBus,
      `${(perBus / 1e9).toFixed(2)}B₮ per bus`,
    );
    opLine(`Operating ${buses} buses`, buses * BUS_ANNUAL);
  }

  // Emergency station.
  if (p.addStation) {
    const kind = p.addStation.kind === "fire" ? "fire" : "ambulance";
    const where = p.addStation.place ?? p.addStation.district;
    const note = where ? `Serving ${where}` : undefined;
    capLine(`New ${kind} station`, STATION_CAPITAL, note);
    opLine(`${kind[0].toUpperCase()}${kind.slice(1)} station crew & vehicles`, STATION_ANNUAL);
  }

  // Coal → electric heating conversion.
  if (typeof p.coalToElectric === "number" && p.coalToElectric > 0) {
    const f = Math.min(1, Math.max(0, p.coalToElectric));
    const converted = round(TOTAL_HOUSEHOLDS * GER_SHARE * f);
    if (converted > 0) {
      capLine(
        `Clean-heat conversion (${converted.toLocaleString("en-US")} households)`,
        converted * CONVERT_CAPITAL_PER_HH,
        "Heat-pump + retrofit subsidy",
      );
      opLine(
        "Electricity / grid support for converted homes",
        converted * CONVERT_ANNUAL_PER_HH,
      );
    }
  }

  // Modal shift to bikes → protected lane network.
  if (typeof p.modalShiftToBike === "number" && p.modalShiftToBike > 0) {
    const f = Math.min(1, Math.max(0, p.modalShiftToBike));
    const bikeCapital = f * 100 * BIKE_CAPITAL_PER_UNIT;
    if (bikeCapital > 0) {
      capLine(
        "Protected bike-lane network",
        bikeCapital,
        `${Math.round(f * 100)} km-equivalent`,
      );
      opLine("Bike-lane upkeep & enforcement", bikeCapital * BIKE_ANNUAL_RATE);
    }
  }

  // New bus route.
  if (p.newBusRoute) {
    capLine("New bus route (vehicles + depot)", ROUTE_CAPITAL);
    opLine("New route operations", ROUTE_ANNUAL);
  }

  // Road closure — no capital, but an annual economic disruption cost.
  if (typeof p.roadClosure === "string" && p.roadClosure.trim().length > 0) {
    opLine(
      `Economic disruption from closing ${p.roadClosure}`,
      ROAD_CLOSURE_ANNUAL,
      "Rerouting, lost access, delivery delays",
    );
  }

  // Policy-only levers (schedule shift, remote work) carry no modelled ₮ cost.

  return { capital, annual, lines };
}

/* ── Benefit derivation ──────────────────────────────────────────────────── */

interface BenefitBuild {
  annual: number;
  lines: BudgetLine[];
}

/** Monetise the simulated outcomes into annual benefit lines (₮). */
function buildBenefits(result: SimulationResult): BenefitBuild {
  const metrics: Metric[] = result.domains.flatMap((d) => d.metrics);
  const lines: BudgetLine[] = [];
  let annual = 0;

  const benLine = (label: string, amount: number, note?: string) => {
    if (amount <= 0) return;
    annual += amount;
    lines.push({ label, amount: round(amount), kind: "benefit", note });
  };

  // 1) Currency metrics (healthcare / economic savings) with a positive value.
  for (const m of metrics) {
    if (m.format === "currency" && m.predicted > 0) {
      benLine(m.label || "Annual economic savings", m.predicted);
    }
  }

  // 2) Travel-time saved → value of time across motorised commute trips.
  //    A reduction is a negative delta (predicted faster than baseline).
  for (const m of metrics) {
    if (
      m.format === "minutes" &&
      /travel time/i.test(m.label) &&
      m.delta < 0
    ) {
      const minutesSaved = Math.abs(m.delta);
      const benefit =
        MOTOR_TRIPS * (minutesSaved / 60) * VALUE_OF_TIME * WORKDAYS;
      benLine(
        "Commuter time saved",
        benefit,
        `${minutesSaved.toFixed(1)} min × ${MOTOR_TRIPS.toLocaleString("en-US")} trips/day`,
      );
    }
  }

  // 3) CO₂ avoided → carbon shadow price. Units like "tons/day"; drop = good.
  for (const m of metrics) {
    if (typeof m.unit === "string" && m.unit.includes("tons/day") && m.delta < 0) {
      const tonsPerDay = Math.abs(m.delta);
      const benefit = tonsPerDay * 365 * CARBON_PRICE;
      benLine(
        `CO₂ avoided (${m.label || "emissions"})`,
        benefit,
        `${tonsPerDay.toFixed(1)} tons/day × ₮${CARBON_PRICE.toLocaleString("en-US")}/ton`,
      );
    }
  }

  return { annual, lines };
}

/* ── Verdict ─────────────────────────────────────────────────────────────── */

function buildVerdict(
  annualBenefit: number,
  annualCost: number,
  capitalCost: number,
  net: number,
  paybackYears: number | null,
  benefitCostRatio: number,
): string {
  if (annualBenefit <= 0) {
    if (capitalCost <= 0 && annualCost <= 0) {
      return "Negligible cost and no monetised benefit — a low-stakes policy nudge.";
    }
    return "Net cost with no monetised benefit — justify on public-safety or quality-of-life grounds.";
  }

  if (net <= 0) {
    return `Operating costs outrun annual benefits (B/C ${benefitCostRatio.toFixed(
      2,
    )} over ${HORIZON_YEARS}y) — viable only as a strategic or public-good investment.`;
  }

  if (paybackYears === null) {
    return `Net-positive annually with no capital outlay; benefit–cost ratio ${benefitCostRatio.toFixed(
      2,
    )} — costs itself off quickly.`;
  }

  const strength =
    benefitCostRatio >= 2
      ? "very strong economic case"
      : benefitCostRatio >= 1
        ? "strong economic case"
        : "modest economic case";
  return `Indicative payback ~${paybackYears.toFixed(1)} years; ${strength}.`;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Estimate an indicative cost–benefit case for a scenario.
 *
 * @param scenario the policy and its parsed levers (the cost drivers)
 * @param result   the simulated outcome (the benefit source)
 * @returns a deterministic {@link BudgetEstimate} in ₮ (MNT)
 */
export function estimateBudget(
  scenario: Scenario,
  result: SimulationResult,
): BudgetEstimate {
  const costs = buildCosts(scenario);
  const benefits = buildBenefits(result);

  const capitalCost = round(costs.capital);
  const annualCost = round(costs.annual);
  const annualBenefit = round(benefits.annual);

  const net = annualBenefit - annualCost;

  // Years to recoup capital from net annual benefit; null if it never recoups.
  let paybackYears: number | null = null;
  if (net > 0) {
    paybackYears = capitalCost <= 0 ? 0 : Math.round((capitalCost / net) * 10) / 10;
  }

  // Benefit over the horizon ÷ total cost over the horizon (guarded divide).
  const totalCost = Math.max(1, capitalCost + annualCost * HORIZON_YEARS);
  const benefitCostRatio =
    Math.round(((annualBenefit * HORIZON_YEARS) / totalCost) * 100) / 100;

  // Ordering: capital first, then operating, then benefits — reads top-down.
  const order: Record<BudgetLine["kind"], number> = {
    capital: 0,
    operating: 1,
    benefit: 2,
  };
  const lines: BudgetLine[] = [...costs.lines, ...benefits.lines].sort(
    (a, b) => order[a.kind] - order[b.kind],
  );

  const verdict = buildVerdict(
    annualBenefit,
    annualCost,
    capitalCost,
    net,
    paybackYears,
    benefitCostRatio,
  );

  return {
    capitalCost,
    annualCost,
    annualBenefit,
    paybackYears,
    benefitCostRatio,
    horizonYears: HORIZON_YEARS,
    lines,
    verdict,
  };
}
