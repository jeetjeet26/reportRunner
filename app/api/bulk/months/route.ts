export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { listAvailableRecapMonths } from "@/lib/notion";

export async function GET(_req: NextRequest) {
  void env; // validate
  try {
    const months = await listAvailableRecapMonths();
    return new Response(JSON.stringify({ months }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message || e) || "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}


