import { env } from 'cloudflare:workers';
import { z } from 'zod';
const schema=z.object({owner:z.string().uuid(),mode:z.enum(['browser','cloud']),action:z.enum(['acquire','heartbeat','release'])});
export async function POST(request:Request){
  if(!env.DB)return Response.json({error:'Storage is unavailable.'},{status:503});
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403});
  const body=await request.text();if(body.length>2000)return Response.json({error:'Request too large.'},{status:413});
  let parsed;try{parsed=schema.safeParse(JSON.parse(body));}catch{return Response.json({error:'Invalid JSON.'},{status:400});}
  if(!parsed.success)return Response.json({error:'Invalid scanner request.'},{status:400});
  const {owner,mode,action}=parsed.data,now=Math.floor(Date.now()/1000);
  if(action==='release'){
    await env.DB.batch([env.DB.prepare("DELETE FROM deriv_lease WHERE id='main' AND owner=?").bind(owner)]);
    return Response.json({ok:true});
  }
  const sql=action==='acquire'?"INSERT INTO deriv_lease(id,owner,mode,expires_at,heartbeat_at) VALUES('main',?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,mode=excluded.mode,expires_at=excluded.expires_at,heartbeat_at=excluded.heartbeat_at WHERE deriv_lease.expires_at<=? OR deriv_lease.owner=excluded.owner RETURNING owner,mode,expires_at":
    "UPDATE deriv_lease SET expires_at=?,heartbeat_at=? WHERE id='main' AND owner=? AND expires_at>? RETURNING owner,mode,expires_at";
  const statement=action==='acquire'?env.DB.prepare(sql).bind(owner,mode,now+75,now,now):env.DB.prepare(sql).bind(now+75,now,owner,now);
  const [result]=await env.DB.batch([statement]);
  return Response.json({ok:result.results.length>0},{status:result.results.length?200:409,headers:{'Cache-Control':'no-store'}});
}
