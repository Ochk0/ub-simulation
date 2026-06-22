/**
 * Fetch real district population for Ulaanbaatar from Wikidata (sourced from
 * Mongolia's NSO census/estimates) via the REST entity API — more reliable than
 * the rate-limited SPARQL endpoint.
 *
 * For each düüreg: wbsearchentities → pick the entity described as being in
 * Ulaanbaatar → Special:EntityData/{QID}.json → newest P1082 (population).
 * Writes src/lib/data/population.json keyed by our district slug.
 *
 * Usage: npm run fetch-population
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "lib", "data", "population.json");
const UA = "UB-Twin-AI/1.0 (smart-city hackathon)";

// slug → candidate search terms (match our SEED in city.ts).
const DISTRICTS = [
  { slug: "bayanzurkh", names: ["Bayanzürkh", "Bayanzurkh district"] },
  { slug: "songinokhairkhan", names: ["Songinokhairkhan", "Songino Khairkhan"] },
  { slug: "khan-uul", names: ["Khan-Uul", "Khan Uul district"] },
  { slug: "bayangol", names: ["Bayangol", "Bayangol district"] },
  { slug: "sukhbaatar", names: ["Sükhbaatar district", "Sukhbaatar district Ulaanbaatar"] },
  { slug: "chingeltei", names: ["Chingeltei", "Chingeltei district"] },
  { slug: "nalaikh", names: ["Nalaikh", "Nalaikh district"] },
  { slug: "baganuur", names: ["Baganuur", "Baganuur district"] },
  { slug: "bagakhangai", names: ["Bagakhangai", "Bagakhangai district"] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Find the QID for a UB district (description mentions Ulaanbaatar). */
async function findQID(names) {
  for (const name of names) {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=7&origin=*`;
    const d = await getJSON(url);
    const hit =
      (d.search || []).find((x) => /ulaanbaatar/i.test(x.description || "")) ||
      (d.search || []).find((x) => /district|düüreg|duureg/i.test(x.description || ""));
    if (hit) return hit.id;
    await sleep(300);
  }
  return null;
}

/** Newest population value (by P585 point-in-time, preferring 'preferred' rank). */
function latestPopulation(entity) {
  const claims = entity?.claims?.P1082;
  if (!Array.isArray(claims) || !claims.length) return null;
  let best = null;
  for (const c of claims) {
    const amount = Number(c?.mainsnak?.datavalue?.value?.amount);
    if (!Number.isFinite(amount)) continue;
    const t = c?.qualifiers?.P585?.[0]?.datavalue?.value?.time || "+0000-00-00T00:00:00Z";
    const year = Number(t.slice(1, 5));
    if (year && year < 2018) continue; // reject stale census figures (e.g. 2009)
    const rank = c?.rank === "preferred" ? 2 : c?.rank === "normal" ? 1 : 0;
    const key = `${rank}|${t}`;
    if (!best || key > best.key) best = { key, amount, asOf: t.slice(1, 5) };
  }
  return best;
}

async function main() {
  const out = {};
  for (const d of DISTRICTS) {
    try {
      const qid = await findQID(d.names);
      if (!qid) {
        console.warn(`• ${d.slug}: no QID found`);
        continue;
      }
      const data = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
      const entity = data?.entities?.[qid];
      const pop = latestPopulation(entity);
      if (pop) {
        out[d.slug] = { population: pop.amount, asOf: pop.asOf, qid, source: "Wikidata P1082 (NSO Mongolia)" };
        console.log(`• ${d.slug}: ${pop.amount.toLocaleString()} (${pop.asOf}) ${qid}`);
      } else {
        console.warn(`• ${d.slug}: ${qid} has no population claim`);
      }
      await sleep(400);
    } catch (e) {
      console.warn(`• ${d.slug}: ${e.message}`);
    }
  }
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${Object.keys(out).length}/9 districts → ${OUT}`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
