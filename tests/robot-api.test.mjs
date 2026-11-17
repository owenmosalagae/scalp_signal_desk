import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
fs.mkdirSync('.sites-runtime', { recursive: true });
const database = new DatabaseSync(':memory:');
for (const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort()) database.exec(fs.readFileSync('drizzle/'+name,'utf8'));
globalThis.robotEnv = { DB: {
  prepare(sql) { return {sql,values:[],bind(...values){return {sql,values};}}; },
  async batch(statements) {
    database.exec('BEGIN');
    try { const results=statements.map(s=>{const q=database.prepare(s.sql);if (/^(SELECT|WITH)/i.test(s.sql)|| /\bRETURNING\b/i.test(s.sql))return {results:q.all(...s.values)};q.run(...s.values);return {results:[]};});database.exec('COMMIT');return results; }
    catch(e){database.exec('ROLLBACK');throw e;}
  }
}};
for (const [from,to] of [['lib/robot-contract.ts','robot-contract'],['lib/robot-store.ts','robot-store'],['app/api/robot/control/route.ts','robot-control'],['app/api/robot/runner/route.ts','robot-runner']]) {
  const source=fs.readFileSync(from,'utf8').replace(/import \{ env \} from ['"]cloudflare:workers['"];?/, 'const env=globalThis.robotEnv;')
    .replace(/['"](?:@\/lib\/|\.\/)(robot-(?:contract|store))['"]/g, '"./$1.mjs"');
  fs.writeFileSync('.sites-runtime/'+to+'.mjs',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
}
const control=await import('../.sites-runtime/robot-control.mjs'),runner=await import('../.sites-runtime/robot-runner.mjs');
const {DEFAULT_RISK}=await import('../.sites-runtime/robot-contract.mjs');
const origin='https://desk.test';
let clock=1794950000000; const realNow=Date.now;Date.now=()=>clock;
const request=(path,body,headers={origin})=>new Request(origin+'/api/robot/'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const accountKey='["Demo",7]',runnerId=randomUUID();
const report={runnerId,accountKey,demo:true,login:'7',server:'Demo',currency:'USD',equity:10000,balance:10000,symbols:['EURUSD','XAUUSD'],timeframe:'M5',status:'Paused',revision:0,running:false,positions:[],events:[]};
const start=(revision=0,overrides={})=>({enabled:true,revision,runnerId,accountKey,risk:DEFAULT_RISK,symbols:['XAUUSD'],...overrides});
const permission=async(id=runnerId,key=accountKey)=>(await runner.GET(new Request(origin+'/api/robot/runner?'+new URLSearchParams({runnerId:id,accountKey:key})))).json();
try {
 assert.equal((await control.GET()).status,200);
 assert.equal((await control.POST(request('control',start()))).status,409,'no runner cannot start');
 assert.equal((await runner.POST(request('runner',{...report,demo:false}))).status,400,'real reports rejected');
 assert.equal((await runner.POST(request('runner',report))).status,200);
 assert.equal((await permission()).enabled,false,'starts paused');
 assert.equal((await control.POST(request('control',start(),{}))).status,403,'missing origin rejected');
 assert.equal((await control.POST(request('control',start(),{origin:'https://evil.test'}))).status,403);
 assert.equal((await control.POST(request('control',start(0,{symbols:['Unknown']})))).status,400);
 assert.equal((await control.POST(request('control',start(0,{risk:{...DEFAULT_RISK,riskPercent:2}})))).status,400);
 assert.equal((await control.POST(request('control',start(0,{accountKey:'different'})))).status,409);
 assert.equal((await control.POST(request('control',start()))).status,200);
 assert.equal((await permission()).enabled,true);
 assert.deepEqual((await permission()).symbols,['XAUUSD']);
 assert.equal((await permission(randomUUID())).enabled,false,'restart cannot reuse Start command');
 assert.equal((await permission(runnerId,'other')).enabled,false,'account binding enforced');
 assert.equal((await control.POST(request('control',start()))).status,409,'stale revision rejected');
 assert.equal((await runner.POST(request('runner',{...report,runnerId:randomUUID()}))).status,409,'second runner blocked');
 assert.equal((await control.POST(request('control',{enabled:false,revision:0}))).status,200,'stale browser can pause');
 assert.equal((await permission()).enabled,false);
 assert.equal((await control.POST(request('control',start(2)))).status,200);
 clock+=46000;
 assert.equal((await permission()).enabled,false,'stale heartbeat blocks trading');
 assert.equal((await control.POST(request('control',start(3)))).status,409);
 const restarted={...report,runnerId:randomUUID()};
 assert.equal((await runner.POST(request('runner',restarted))).status,200,'expired lease can be replaced');
 assert.equal((await permission(restarted.runnerId)).enabled,false,'replacement runner starts paused');
 assert.equal((await control.POST(request('control',start(3,{runnerId:restarted.runnerId})))).status,200);
 assert.equal((await permission(restarted.runnerId)).enabled,true);
 // Real accounts require mode, capability, matching account number and explicit consent.
 clock+=46000;
 const realId=randomUUID(),realKey='["Real",42,"real"]';
 const realReport={...report,runnerId:realId,accountKey:realKey,login:'42',demo:false,accountMode:'real',protocolVersion:2};
 assert.equal((await runner.POST(request('runner',{...realReport,protocolVersion:1}))).status,400);
 assert.equal((await runner.POST(request('runner',{...realReport,accountMode:'demo'}))).status,400);
 assert.equal((await runner.POST(request('runner',realReport))).status,200);
 const revision=(await (await control.GET()).json()).revision;
 const realStart={...start(revision),runnerId:realId,accountKey:realKey,accountMode:'real',risk:{...DEFAULT_RISK,riskPercent:.1}};
 assert.equal((await control.POST(request('control',realStart))).status,400,'real Start needs consent and login');
 assert.equal((await control.POST(request('control',{...realStart,confirmReal:true,realAccountLogin:'wrong'}))).status,400);
 assert.equal((await control.POST(request('control',{...realStart,accountMode:'demo'}))).status,409);
 assert.equal((await permission(realId,realKey)).enabled,false,'account changes never inherit Start');
 assert.equal((await control.POST(request('control',{...realStart,confirmReal:true,realAccountLogin:'42'}))).status,200);
 const realPermission=await permission(realId,realKey);
 assert.equal(realPermission.enabled,true);assert.equal(realPermission.accountMode,'real');
 assert.deepEqual(Object.keys(realPermission.risk).sort(),Object.keys(DEFAULT_RISK).sort(),'metadata must not leak into risk schema');
 assert.equal((await control.POST(request('control',{enabled:false,revision:0}))).status,200);
 assert.equal((await permission(realId,realKey)).enabled,false,'pause also blocks real entries');
 // Profile restoration never enables trading, and a stopped runner releases its lease.
 clock+=46000;
 const demoAgain={...report,runnerId:randomUUID()};
 assert.equal((await runner.POST(request('runner',demoAgain))).status,200);
 const demoView=await (await control.GET()).json();
 assert.equal(demoView.savedProfile.accountMode,'demo');
 assert.equal(demoView.savedProfile.risk.riskPercent,DEFAULT_RISK.riskPercent);
 assert.equal((await permission(demoAgain.runnerId)).enabled,false);
 assert.equal((await runner.DELETE(request('runner',{runnerId:realId,accountKey:realKey}))).status,200);
 assert.equal((await (await control.GET()).json()).online,true,'stale release cannot disconnect a new session');
 assert.equal((await runner.DELETE(request('runner',{runnerId:demoAgain.runnerId,accountKey}))).status,200);
 assert.equal((await (await control.GET()).json()).online,false,'current release disconnects immediately');
 const realAgain={...realReport,runnerId:randomUUID()};
 assert.equal((await runner.POST(request('runner',realAgain))).status,200,'no 45s wait after clean release');
 const restored=await (await control.GET()).json();
 assert.equal(restored.savedProfile.accountMode,'real');
 assert.equal(restored.savedProfile.risk.riskPercent,.1,'real limits saved separately');
 assert.equal(restored.enabled,false,'restoring a profile never starts trading');
 const savedOnly=await control.POST(request('control',{enabled:false,saveOnly:true,revision:restored.revision,runnerId:realAgain.runnerId,accountKey:realKey,accountMode:'real',risk:{...DEFAULT_RISK,riskPercent:.15},symbols:['EURUSD']}));
 assert.equal(savedOnly.status,200);
 const savedView=await savedOnly.json();
 assert.equal(savedView.savedProfile.risk.riskPercent,.15);
 assert.equal(savedView.enabled,false,'saving real preferences needs no trading consent and cannot start trading');
 assert.equal(savedView.revision,restored.revision,'save-only leaves trading command unchanged');
 assert.equal((await control.POST(request('control',{enabled:false,saveOnly:true,revision:restored.revision,runnerId:realId,accountKey:realKey,accountMode:'real',risk:DEFAULT_RISK,symbols:['EURUSD']}))).status,409);
 console.log('Robot API: account/session binding, leases, freshness, pause, risk, origin and revisions passed.');
} finally {Date.now=realNow;database.close();}
