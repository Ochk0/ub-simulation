// Smoke test: verify /api/city and /api/simulate return sane data.
const BASE = "http://localhost:3000";

async function waitReady(ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE + "/api/city");
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server not ready");
}

const fmt = (m) =>
  `${m.label}: ${m.baseline}→${m.predicted}${m.unit ? " " + m.unit : ""} ` +
  `(${m.deltaPct >= 0 ? "+" : ""}${m.deltaPct.toFixed(1)}% ${m.sentiment} ${m.direction})`;

async function sim(prompt) {
  const r = await fetch(BASE + "/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const d = await r.json();
  if (d.error) {
    console.log(`\n### "${prompt}"\n  ERROR: ${d.error}`);
    return;
  }
  console.log(`\n### "${prompt}"`);
  console.log(`  title: ${d.scenario.title}  | domains: ${d.scenario.domains.join(", ")} | conf ${(d.confidence * 100).toFixed(0)}%`);
  console.log(`  summary: ${d.summary}`);
  console.log(`  primaryMetrics:`);
  for (const m of d.primaryMetrics) console.log(`    - ${fmt(m)}`);
  const kinds = d.overlays.map((o) => o.kind + (o.kind === "roads" ? `(${o.statuses.length})` : o.kind === "choropleth" ? `(${o.values.length})` : o.kind === "points" ? `(${o.points.length})` : o.kind === "coverage" ? `(${o.circles.length})` : ""));
  console.log(`  overlays: ${kinds.join(", ") || "none"}`);
  console.log(`  risks: ${d.risks.length} (${d.risks.map((x) => x.severity).join(",")})`);
  console.log(`  insights: ${d.insights.length}`);
}

async function main() {
  await waitReady();
  const city = await (await fetch(BASE + "/api/city")).json();
  const g = city.geo;
  console.log("=== /api/city ===");
  console.log(`  districts: ${city.districts.length}`);
  console.log(`  geo: roads=${g.roads.features.length} districts=${g.districts.features.length} hospitals=${g.hospitals.features.length} fire=${g.fire.features.length} busstops=${g.busstops.features.length}`);

  for (const p of [
    "Install adaptive AI traffic lights on Peace Avenue",
    "Add an ambulance station in Yarmag",
    "30% of coal-heated households switch to electric heating",
    "Add 50 electric buses to the fleet",
    "Close Peace Avenue for one week",
    "20% of commuters switch to bicycles",
    "What if a giant purple dinosaur visits the city?",
  ]) {
    await sim(p);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
