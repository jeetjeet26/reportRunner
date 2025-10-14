export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { env } from "@/lib/env";

export async function POST(_req: NextRequest) {
  void env;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}




