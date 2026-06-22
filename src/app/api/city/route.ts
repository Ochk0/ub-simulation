/**
 * Serves the city knowledge layer (real OSM geometry + district metadata) to
 * the client map. Static — the geometry never changes at runtime — so it's
 * cached aggressively and keeps the browser JS bundle light.
 */
import { NextResponse } from "next/server";
import { getCityData } from "@/lib/city";

export const dynamic = "force-static";

export function GET() {
  const city = getCityData();
  return NextResponse.json(
    { districts: city.districts, geo: city.geo },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
