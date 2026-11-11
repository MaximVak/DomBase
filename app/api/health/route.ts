import { isDatabaseReady } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  let ready = false;
  try {
    ready = await isDatabaseReady();
  } catch {
    // Readiness exposes no records, SQL errors, credentials, or binding details.
  }
  return Response.json(
    { status: ready ? "ok" : "unavailable", database: ready ? "ok" : "unavailable" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
