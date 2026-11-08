import { env } from "cloudflare:workers";

export async function GET(request?: Request) {
  if (!env.DB) return Response.json({ error: "Storage is unavailable." }, { status: 503 });
  const [streamResult, leaseResult] = await env.DB.batch<{ id: string; payload: string; received_at: number; mode?: string; heartbeat_at?: number; expires_at?: number }>([
    env.DB.prepare("SELECT id,payload,received_at FROM streams ORDER BY received_at DESC LIMIT 250"),
    env.DB.prepare("SELECT mode,heartbeat_at,expires_at FROM deriv_lease WHERE id='main'"),
  ]);
  const lease = leaseResult.results[0];
  const scanner = lease?.mode && Number.isFinite(lease.heartbeat_at) && Number.isFinite(lease.expires_at)
    ? { mode: lease.mode, heartbeatAt: lease.heartbeat_at!, expiresAt: lease.expires_at! } : null;
  const query = request ? new URL(request.url).searchParams : null;
  const requested = query?.get("stream");
  const selected = streamResult.results.some(row => row.id === requested) ? requested : streamResult.results[0]?.id;
  const streams = streamResult.results.map(row => {
    const value = JSON.parse(row.payload);
    // Keep the watchlist compact. Only the selected chart needs its full candles.
    return { ...value, candles: !request || row.id === selected ? value.candles : [], signals: [], receivedAt: row.received_at };
  });
  if (!streamResult.results.length)
    return Response.json({ streams, signals: [], scanner }, { headers: { "Cache-Control": "no-store" } });

  const compact = !!request && query?.get("all") !== "1";
  // Give every monitored stream its own 100-signal window.
  const [signalResult] = await env.DB.batch<{ payload: string; received_at: number }>([
    env.DB.prepare(
      "WITH ranked AS (" +
      "SELECT payload,received_at,confirmed_at,id,stream_id," +
      "ROW_NUMBER() OVER (PARTITION BY stream_id ORDER BY confirmed_at DESC,id DESC) AS signal_rank " +
      "FROM signals WHERE stream_id IN (SELECT id FROM streams ORDER BY received_at DESC LIMIT 250)) " +
      "SELECT payload,received_at FROM ranked WHERE signal_rank<=100 " +
      (compact ? "AND (signal_rank=1 OR stream_id=?) " : "") +
      "ORDER BY confirmed_at DESC,id DESC"
    ).bind(...(compact ? [selected] : [])),
  ]);
  return Response.json({
    streams, scanner,
    signals: signalResult.results.map(row => ({ ...JSON.parse(row.payload), receivedAt: row.received_at })),
  }, { headers: { "Cache-Control": "no-store" } });
}
