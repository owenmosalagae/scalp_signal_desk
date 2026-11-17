import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { riskSchema } from '@/lib/robot-contract';
import { browserOrigin, json, ready, view } from '@/lib/robot-store';
const command = z.object({ saveOnly: z.boolean().optional(),
  accountMode: z.enum(['demo', 'real']).default('demo'), confirmReal: z.boolean().optional(),
  realAccountLogin: z.string().max(30).optional(), enabled: z.boolean(), revision: z.number().int().nonnegative(),
  runnerId: z.string().uuid().optional(), accountKey: z.string().max(150).optional(), risk: riskSchema.optional(), symbols: z.array(z.string().min(1).max(64)).min(1).max(20).optional() }).strict();
export async function GET() {
  if (!ready()) return json({ error: 'Robot storage is unavailable.' }, 503);
  return json(await view());
}
export async function POST(request: Request) {
  if (!ready()) return json({ error: 'Robot storage is unavailable.' }, 503);
  if (!browserOrigin(request)) return json({ error: 'Invalid origin.' }, 403);
  const text = await request.text();
  if (text.length > 4000) return json({ error: 'Command too large.' }, 413);
  let parsed;
  try { parsed = command.safeParse(JSON.parse(text)); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!parsed.success) return json({ error: 'Check your risk settings.' }, 400);
  const c = parsed.data;
  // Seed once. Revision comparison and runner freshness are checked inside the write.
  await env.DB!.batch([env.DB!.prepare("INSERT OR IGNORE INTO robot_control VALUES ('main',0,0,'','',?,'[]')").bind(JSON.stringify((await view()).risk))]);
  if (c.saveOnly) {
    const current = await view();
    if (!c.risk || !c.symbols || !c.runnerId || !c.accountKey || !current.online || current.report?.runnerId !== c.runnerId || current.report.accountKey !== c.accountKey || (current.report.accountMode ?? 'demo') !== c.accountMode)
      return json({ error: 'Connect the intended account before saving its setup.' }, 409);
    if (c.symbols.some(symbol => !current.report?.symbols.includes(symbol)))
      return json({ error: 'Choose markets monitored by this runner.' }, 400);
    const [saved] = await env.DB!.batch<{ id: string }>([env.DB!.prepare(
      "INSERT INTO robot_control (id,revision,enabled,runner_id,account_key,payload,symbols) " +
      "SELECT ?,0,0,'',?,?,? WHERE EXISTS (SELECT 1 FROM robot_runner WHERE id='main' AND runner_id=? AND account_key=? AND received_at>? AND COALESCE(json_extract(payload,'$.accountMode'),'demo')=?) " +
      "AND EXISTS (SELECT 1 FROM robot_control WHERE id='main' AND revision=?) " +
      "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,symbols=excluded.symbols RETURNING id"
    ).bind('profile:'+c.accountKey,c.accountKey,JSON.stringify({...c.risk,accountMode:c.accountMode}),JSON.stringify(c.symbols),c.runnerId,c.accountKey,Math.floor(Date.now()/1000)-45,c.accountMode,c.revision)]);
    if (!saved.results.length) return json({ error: 'Connection or settings changed. Refresh before saving.' }, 409);
    return json(await view());
  }
  if (!c.enabled) {
    // Pause is unconditional: a stale browser must always be able to stop new entries.
    await env.DB!.batch([env.DB!.prepare("UPDATE robot_control SET enabled=0,revision=revision+1 WHERE id='main'")]);
  } else {
    if (!c.runnerId || !c.accountKey || !c.risk || !c.symbols) return json({ error: 'Choose a connected runner and risk limits.' }, 400);
    const current = await view();
    if (!current.online || current.report?.runnerId !== c.runnerId || current.report.accountKey !== c.accountKey)
      return json({ error: 'Connect the intended runner before starting.' }, 409);
    const reportMode = current.report.accountMode ?? 'demo';
    if (c.accountMode !== reportMode)
      return json({ error: 'The selected account mode does not match the connected MT5 runner.' }, 409);
    if (c.accountMode === 'real' && (current.report.protocolVersion < 2 || c.confirmReal !== true || c.realAccountLogin !== current.report.login))
      return json({ error: 'Confirm real-money trading and type the connected MT5 account number.' }, 400);
    if (c.symbols.some(symbol => !current.report?.symbols.includes(symbol)))
      return json({ error: 'Choose markets monitored by this runner.' }, 400);
    const [result] = await env.DB!.batch<{ revision: number }>([env.DB!.prepare(
      "UPDATE robot_control SET enabled=1,revision=revision+1,runner_id=?,account_key=?,payload=?,symbols=? " +
      "WHERE id='main' AND revision=? AND EXISTS (SELECT 1 FROM robot_runner WHERE id='main' AND runner_id=? AND account_key=? AND received_at>? AND COALESCE(json_extract(payload,'$.accountMode'),'demo')=? " +
      "AND (?='demo' OR COALESCE(json_extract(payload,'$.protocolVersion'),1)>=2)) RETURNING revision"
    ).bind(c.runnerId, c.accountKey, JSON.stringify({ ...c.risk, accountMode: c.accountMode }), JSON.stringify(c.symbols), c.revision, c.runnerId, c.accountKey, Math.floor(Date.now()/1000)-45, c.accountMode, c.accountMode),
    env.DB!.prepare(
      "INSERT INTO robot_control (id,revision,enabled,runner_id,account_key,payload,symbols) " +
      "SELECT 'profile:' || account_key,0,0,'',account_key,payload,symbols FROM robot_control " +
      "WHERE id='main' AND revision=? AND runner_id=? AND account_key=? " +
      "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,symbols=excluded.symbols"
    ).bind(c.revision+1,c.runnerId,c.accountKey)]);
    if (!result.results.length) return json({ error: 'Runner disconnected or settings changed. Refresh before starting.' }, 409);
  }
  return json(await view());
}
