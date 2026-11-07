import { env } from "cloudflare:workers";
import { snapshotSchema } from "@/lib/contracts";

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Storage is unavailable." }, { status: 503 });
  // The private site's dispatch validates OAI-Sites-Authorization before this route.
  // Browser writes must also come from this origin.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid origin." }, { status: 403 });
  const body = await request.text();
  if (body.length > 240_000) return Response.json({ error: "Snapshot too large." }, { status: 413 });
  let parsed: ReturnType<typeof snapshotSchema.safeParse>;
  try { parsed = snapshotSchema.safeParse(JSON.parse(body)); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Invalid MT5 snapshot." }, { status: 400 });
  const snapshot = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  if (snapshot.generatedAt > now + 300)
    return Response.json({ error: "Check the Windows system clock." }, { status: 400 });
  const statements = [
    env.DB.prepare(
      "INSERT INTO streams (id,payload,snapshot_at,received_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,snapshot_at=excluded.snapshot_at,received_at=excluded.received_at " +
      "WHERE excluded.snapshot_at >= streams.snapshot_at"
    ).bind(snapshot.streamId, JSON.stringify(snapshot), snapshot.generatedAt, now),
    ...snapshot.signals.map(signal => env.DB!.prepare(
      "INSERT INTO signals (id,stream_id,payload,confirmed_at,received_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING"
    ).bind(signal.id, snapshot.streamId, JSON.stringify({
      ...signal, streamId: snapshot.streamId, symbol: snapshot.symbol, timeframe: snapshot.timeframe, digits: snapshot.digits,
    }), signal.confirmedAt, now)),
  ];
  await env.DB.batch(statements);
  return Response.json({ ok: true, receivedAt: now }, { headers: { "Cache-Control": "no-store" } });
}
