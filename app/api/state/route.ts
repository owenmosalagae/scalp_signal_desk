import { env } from "cloudflare:workers";
export async function GET() {
  if (!env.DB) return Response.json({ error: "Storage is unavailable." }, { status: 503 });
  const result = await env.DB.batch<{ payload: string; received_at: number }>([
    env.DB.prepare("SELECT payload,received_at FROM streams ORDER BY received_at DESC LIMIT 20"),
    env.DB.prepare("SELECT payload,received_at FROM signals ORDER BY confirmed_at DESC,id DESC LIMIT 300"),
  ]);
  return Response.json({
    streams: result[0].results.map(row => ({ ...JSON.parse(row.payload as string), receivedAt: row.received_at })),
    signals: result[1].results.map(row => ({ ...JSON.parse(row.payload as string), receivedAt: row.received_at })),
  }, { headers: { "Cache-Control": "no-store" } });
}
