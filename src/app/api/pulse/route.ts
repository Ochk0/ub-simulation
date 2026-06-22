/**
 * Civic-pulse endpoint. Serves the current tsaaguur.mn trend snapshot (live if
 * TSAAGUUR_API_URL is set, otherwise the bundled sample) to the dashboard.
 */
import { NextResponse } from "next/server";
import { getCitizenPulse } from "@/lib/social/tsaaguur";

export async function GET() {
  const pulse = await getCitizenPulse();
  return NextResponse.json(pulse, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=120" },
  });
}
