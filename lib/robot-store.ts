import { env } from 'cloudflare:workers';
import { DEFAULT_RISK, type Heartbeat, type RobotView } from './robot-contract';
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const ready = () => !!env.DB;
export async function view(): Promise<RobotView> {
  const [controls, runners, profiles] = await env.DB!.batch<{ revision: number; enabled: number; runner_id: string; account_key: string; payload: string; symbols: string; received_at: number }>([
    env.DB!.prepare("SELECT * FROM robot_control WHERE id='main'"),
    env.DB!.prepare("SELECT * FROM robot_runner WHERE id='main'"),
    env.DB!.prepare("SELECT * FROM robot_control WHERE id=(SELECT 'profile:' || account_key FROM robot_runner WHERE id='main')"),
  ]);
  const c = controls.results[0], r = runners.results[0];
  const saved = c ? JSON.parse(c.payload) : DEFAULT_RISK;
  const { accountMode = 'demo', ...risk } = saved;
  const profile = profiles.results[0];
  const { accountMode: profileMode = 'demo', ...profileRisk } = profile ? JSON.parse(profile.payload) : DEFAULT_RISK;
  const savedProfile = profile ? { risk: profileRisk, symbols: JSON.parse(profile.symbols), accountMode: profileMode } : null;
  return { savedProfile, revision: c?.revision ?? 0, enabled: !!c?.enabled, runnerId: c?.runner_id ?? '',
    accountKey: c?.account_key ?? '', risk, accountMode,
    symbols: c ? JSON.parse(c.symbols) : [],
    online: !!r && Math.floor(Date.now()/1000) - r.received_at < 45,
    heartbeatAt: r?.received_at ?? 0, report: r ? JSON.parse(r.payload) as Heartbeat : null };
}
export function browserOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}
