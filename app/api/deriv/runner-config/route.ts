import { env } from 'cloudflare:workers';
export async function POST(request:Request){
  // Deliberate owner action only. Service-access requests do not carry a visitor identity.
  if(!request.headers.get('oai-authenticated-user-id') || request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Sign in to download runner settings.'},{status:403});
  if(!env.MT5_SERVICE_TOKEN)return Response.json({error:'Service access is not configured.'},{status:503});
  const text='SCALP_SITE_URL='+new URL(request.url).origin+'\nSCALP_SITE_TOKEN='+env.MT5_SERVICE_TOKEN+'\n';
  return new Response(text,{headers:{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="scalp-runner.env"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
