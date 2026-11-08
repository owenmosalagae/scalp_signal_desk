import { env } from 'cloudflare:workers';
import { derivConfigSchema as schema } from '@/lib/contracts';
import { DEFAULT_CONFIG } from '@/lib/deriv/types';
export async function GET(){
  if(!env.DB)return Response.json({error:'Storage is unavailable.'},{status:503});
  const [config,lease]=await env.DB.batch<{payload?:string;owner?:string;mode?:string;expires_at?:number;heartbeat_at?:number}>([
    env.DB.prepare("SELECT payload FROM deriv_config WHERE id='main'"),env.DB.prepare("SELECT mode,expires_at,heartbeat_at FROM deriv_lease WHERE id='main'")]);
  const row=lease.results[0],now=Math.floor(Date.now()/1000);
  let saved;try{saved=schema.safeParse(config.results[0]?.payload?JSON.parse(config.results[0].payload):DEFAULT_CONFIG);}catch{return Response.json({error:'Saved scanner settings are invalid.'},{status:503});}
  if(!saved.success)return Response.json({error:'Saved scanner settings are invalid.'},{status:503});
  return Response.json({config:saved.data,capabilities:{strategySwitching:1},
    scanner:row&&row.expires_at!>now?{mode:row.mode,heartbeatAt:row.heartbeat_at}:null},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
  if(!env.DB)return Response.json({error:'Storage is unavailable.'},{status:503});
  if(request.headers.get('origin') && request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403});
  const body=await request.text();if(body.length>20000)return Response.json({error:'Configuration too large.'},{status:413});
  let parsed;try{parsed=schema.safeParse(JSON.parse(body));}catch{return Response.json({error:'Invalid JSON.'},{status:400});}
  if(!parsed.success)return Response.json({error:'Invalid scanner settings.'},{status:400});
  if(parsed.data.scope==='watchlist'&&!parsed.data.symbols.length)return Response.json({error:'Select at least one market.'},{status:400});
  await env.DB.batch([env.DB.prepare("INSERT INTO deriv_config(id,payload,updated_at) VALUES('main',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(JSON.stringify(parsed.data),Math.floor(Date.now()/1000))]);
  return Response.json({ok:true,config:parsed.data,capabilities:{strategySwitching:1}});
}
