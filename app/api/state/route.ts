import { env } from "cloudflare:workers";

export async function GET() {
  if (!env.DB) return Response.json({ error: "Storage is unavailable." }, { status: 503 });
  const [streamResult] = await env.DB.batch<{ id: string; payload: string; received_at: number }>([
    env.DB.prepare("SELECT id,payload,received_at FROM streams ORDER BY received_at DESC LIMIT 20"),
  ]);
  const streams = streamResult.results.map(row => ({
    ...JSON.parse(row.payload), receivedAt: row.received_at,
  }));
  if (!streamResult.results.length)
    return Response.json({ streams, signals: [] }, { headers: { "Cache-Control": "no-store" } });

  const placeholders = streamResult.results.map(() => "?").join(",");
  // Give every monitored stream its own 100-signal window.
  const [signalResult] = await env.DB.batch<{ payload: string; received_at: number }>([
    env.DB.prepare(
      "WITH ranked AS (" +
      "SELECT payload,received_at,confirmed_at,id," +
      "ROW_NUMBER() OVER (PARTITION BY stream_id ORDER BY confirmed_at DESC,id DESC) AS signal_rank " +
      "FROM signals WHERE stream_id IN (" + placeholders + ")) " +
      "SELECT payload,received_at FROM ranked WHERE signal_rank<=100 ORDER BY confirmed_at DESC,id DESC"
    ).bind(...streamResult.results.map(row => row.id)),
  ]);
  return Response.json({
    streams,
    signals: signalResult.results.map(row => ({ ...JSON.parse(row.payload), receivedAt: row.received_at })),
  }, { headers: { "Cache-Control": "no-store" } });
}
