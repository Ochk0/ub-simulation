/**
 * Fetch real OpenStreetMap data for Ulaanbaatar via the Overpass API and write
 * compact GeoJSON layers into src/lib/data/.
 *
 * HTTP is done through `curl` (robust against the header pickiness that makes
 * Node's fetch get 406'd by some Overpass mirrors). Line/polygon layers are
 * assembled with osmtogeojson; point layers are extracted directly.
 *
 * Layers:
 *   boundary.json   — UB administrative outline (relation 270090)
 *   districts.json  — düüreg boundaries (admin_level 6) for the choropleth
 *   roads.json      — arterial network (trunk/primary/secondary) incl. Peace Avenue
 *   hospitals.json  — hospitals + clinics
 *   fire.json       — fire / ambulance stations
 *   schools.json    — schools + universities
 *   busstops.json   — public transport stops
 *
 * Usage: npm run fetch-data
 */
import osmtogeojson from "osmtogeojson";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "lib", "data");

const UB_REL = 270090;
const UB_AREA = 3600000000 + UB_REL;

// Central, contiguous urban bounding box (S, W, N, E). Excludes far exclaves.
const BBOX = [47.8, 106.55, 48.0, 107.25];
const BB = BBOX.join(",");

const MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const UA = "UB-Twin-AI/1.0 (smart-city hackathon)";

// out geom → assembled with osmtogeojson (lines / polygons)
const GEOM_QUERIES = {
  boundary: `[out:json][timeout:120];relation(${UB_REL});out geom;`,
  districts: `[out:json][timeout:180];area(id:${UB_AREA})->.ub;relation(area.ub)["boundary"="administrative"]["admin_level"="6"];out geom;`,
  roads: `[out:json][timeout:180];way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary)$"](${BB});out geom;`,
  busroutes: `[out:json][timeout:180];relation["route"="bus"](${BB});out geom;`,
};

// Layers where we keep only line geometry (drop stop points from route relations).
const LINE_ONLY = new Set(["busroutes"]);

// out center / body → points extracted manually
const POINT_QUERIES = {
  hospitals: `[out:json][timeout:120];(nwr["amenity"="hospital"](${BB});nwr["amenity"="clinic"](${BB}););out center;`,
  fire: `[out:json][timeout:120];(nwr["amenity"="fire_station"](${BB});nwr["emergency"="ambulance_station"](${BB}););out center;`,
  schools: `[out:json][timeout:150];(nwr["amenity"="school"](${BB});nwr["amenity"="university"](${BB}););out center;`,
  busstops: `[out:json][timeout:150];(node["highway"="bus_stop"](${BB});node["public_transport"="platform"]["bus"="yes"](${BB}););out body;`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 1e5) / 1e5;

function curlOverpass(query, label) {
  let lastErr;
  for (let attempt = 0; attempt < MIRRORS.length * 2; attempt++) {
    const endpoint = MIRRORS[attempt % MIRRORS.length];
    try {
      const out = execFileSync(
        "curl",
        [
          "-s", "--max-time", "180", "--retry", "1",
          "-H", `User-Agent: ${UA}`,
          "-H", "Accept: application/json",
          "--data-urlencode", `data=${query}`,
          endpoint,
        ],
        { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }
      );
      if (!out || out.trimStart().startsWith("<")) {
        throw new Error(`non-JSON from ${endpoint}: ${(out || "").slice(0, 120).replace(/\s+/g, " ")}`);
      }
      const json = JSON.parse(out);
      if (!Array.isArray(json.elements)) throw new Error("no elements array");
      return json;
    } catch (err) {
      lastErr = err;
      const wait = 2500 * (attempt + 1);
      console.warn(`  [${label}] attempt ${attempt + 1} (${endpoint.split("/")[2]}) failed: ${err.message}; retry in ${wait}ms`);
      // crude synchronous backoff is fine for a one-shot script
      execFileSync("sleep", [String(wait / 1000)]);
    }
  }
  throw new Error(`[${label}] all attempts failed: ${lastErr?.message}`);
}

const KEEP_TAGS = [
  "name", "name:en", "name:mn", "amenity", "highway", "emergency",
  "admin_level", "boundary", "ref", "public_transport", "operator",
];
function pickTags(tags = {}) {
  const out = {};
  for (const k of KEEP_TAGS) if (tags[k] != null) out[k] = tags[k];
  return out;
}

function roundGeom(geom) {
  const walk = (c) => (typeof c[0] === "number" ? [round(c[0]), round(c[1])] : c.map(walk));
  if (geom && geom.coordinates) geom.coordinates = walk(geom.coordinates);
  return geom;
}

async function buildGeomLayer(name, query) {
  process.stdout.write(`• ${name} … `);
  const osm = curlOverpass(query, name);
  const gj = osmtogeojson(osm);
  gj.features = gj.features
    .filter((f) => f.geometry && f.geometry.coordinates)
    .filter((f) => !LINE_ONLY.has(name) || /LineString/.test(f.geometry.type))
    .map((f) => ({
      type: "Feature",
      id: f.id,
      properties: { id: f.id, ...pickTags(f.properties) },
      geometry: roundGeom(f.geometry),
    }));
  await writeFile(join(OUT_DIR, `${name}.json`), JSON.stringify(gj));
  console.log(`${gj.features.length} features`);
  return gj.features.length;
}

async function buildPointLayer(name, query) {
  process.stdout.write(`• ${name} … `);
  const osm = curlOverpass(query, name);
  const features = [];
  for (const el of osm.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    features.push({
      type: "Feature",
      id: `${el.type[0]}${el.id}`,
      properties: { id: `${el.type[0]}${el.id}`, ...pickTags(el.tags) },
      geometry: { type: "Point", coordinates: [round(lon), round(lat)] },
    });
  }
  const gj = { type: "FeatureCollection", features };
  await writeFile(join(OUT_DIR, `${name}.json`), JSON.stringify(gj));
  console.log(`${features.length} features`);
  return features.length;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Fetching real OSM data for Ulaanbaatar → ${OUT_DIR}\n`);
  const counts = {};
  for (const [name, query] of Object.entries(GEOM_QUERIES)) {
    counts[name] = await buildGeomLayer(name, query);
    await sleep(800);
  }
  for (const [name, query] of Object.entries(POINT_QUERIES)) {
    counts[name] = await buildPointLayer(name, query);
    await sleep(800);
  }
  console.log("\nDone:", counts);
}

main().catch((e) => {
  console.error("\nFETCH FAILED:", e);
  process.exit(1);
});
