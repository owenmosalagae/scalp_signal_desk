import { env } from 'cloudflare:workers';
import { heartbeatSchema } from '@/lib/robot-contract';
import { json, ready, view } from '@/lib/robot-store';
// These routes inherit the existing owner-private Sites authentication boundary.
// The paired Windows connector uses its existing OAI-Sites-Authorization credential.
export async function GET(request: Request) {
  if (!ready()) return json({ error: 'Robot storage is unavailable.' }, 503);
  const v = await view(), q = new URL(request.url).searchParams;
  const bound = v.online && v.report?.runnerId === q.get('runnerId') && v.report?.accountKey === q.get('accountKey') &&
    v.runnerId === q.get('runnerId') && v.accountKey === q.get('accountKey') &&
    (v.report?.accountMode ?? 'demo') === v.accountMode && (v.accountMode !== 'real' || (v.report?.protocolVersion ?? 1) >= 2);
  return json({ enabled: v.enabled && bound, revision: v.revision, accountMode: v.accountMode, risk: v.risk, symbols: v.symbols });
}
export async function POST(request: Request) {
  if (!ready()) return json({ error: 'Robot storage is unavailable.' }, 503);
  const text = await request.text();
  if (text.length > 40000) return json({ error: 'Report too large.' }, 413);
  let parsed;
  try { parsed = heartbeatSchema.safeParse(JSON.parse(text)); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!parsed.success) return json({ error: 'Invalid runner account report.' }, 400);
  const r = parsed.data, now = Math.floor(Date.now()/1000);
  const [result] = await env.DB!.batch<{ runner_id: string }>([env.DB!.prepare(
    "INSERT INTO robot_runner VALUES ('main',?,?,?,?) ON CONFLICT(id) DO UPDATE SET " +
    "runner_id=excluded.runner_id,account_key=excluded.account_key,payload=excluded.payload,received_at=excluded.received_at " +
    "WHERE robot_runner.runner_id=excluded.runner_id OR robot_runner.received_at<=? RETURNING runner_id"
  ).bind(r.runnerId, r.accountKey, JSON.stringify(r), now, now-45)]);
  if (!result.results.length) return json({ error: 'Another robot holds the active runner lease.' }, 409);
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!ready()) return json({ error: 'Robot storage is unavailable.' }, 503);
  let data: { runnerId?: unknown; accountKey?: unknown };
  const text = await request.text();
  if (text.length > 1000) return json({ error: 'Request too large.' }, 413);
  try { data = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!data || typeof data.runnerId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.runnerId) || typeof data.accountKey !== 'string' || data.accountKey.length > 150)
    return json({ error: 'Invalid runner identity.' }, 400);
  await env.DB!.batch([
    env.DB!.prepare("UPDATE robot_runner SET received_at=0,payload=json_set(payload,'$.running',json('false'),'$.status','Runner stopped. Reconnect to continue.') WHERE id='main' AND runner_id=? AND account_key=?").bind(data.runnerId, data.accountKey),
    env.DB!.prepare("UPDATE robot_control SET enabled=0,revision=revision+1 WHERE id='main' AND enabled=1 AND runner_id=? AND account_key=?").bind(data.runnerId, data.accountKey),
  ]);
  return json({ ok: true });
}
