import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { feedHealth, matchesScanner } from '../lib/deriv/feed-health.ts';
import { withRequestTimeout } from '../lib/deriv/request.ts';
import { DEFAULT_CONFIG } from '../lib/deriv/types.ts';
const ts = createRequire(new URL('../vercel/package.json', import.meta.url))('typescript');
const now = 1794163200;
const stream = { streamId:'a'.repeat(64), symbol:'Volatility 50 (1s) Index',symbolCode:'1HZ50V',source:'Deriv API',timeframe:'M5',timeframeSeconds:300,settings:DEFAULT_CONFIG.settings,receivedAt:now-7,quoteTime:now-11,marketOpen:true };
const scanner = { mode:'browser',heartbeatAt:now-17,expiresAt:now+58 };
const health = (patch={}) => feedHealth({ stream,now,config:DEFAULT_CONFIG,scanner,...patch });
test('recent saves are healthy when another window owns the scanner',()=>{
  assert.equal(health({phase:'waiting'}).kind,'live');
  assert.equal(health({phase:'error'}).kind,'live','A recovered request must not leave healthy data marked disconnected');
});
test('older timeframe, strategy and settings views are saved charts, not failed connections',()=>{
  for(const patch of [{timeframe:'M1'},{strategyId:'session_fvg'},{settings:{...DEFAULT_CONFIG.settings,atrMultiplier:5}}]) {
    assert.equal(health({stream:{...stream,receivedAt:now-5298,...patch}}).kind,'saved');
  }
  assert.equal(matchesScanner(stream,{...DEFAULT_CONFIG,scope:'watchlist',symbols:[]}),false);
});
test('loading a new timeframe never produces an epoch-date disconnection warning',()=>{
  const result=health({stream:{...stream,receivedAt:0},loadingFrame:true});
  assert.equal(result.kind,'loading');assert.equal(result.notice,undefined);
});
test('a closed market and a paused scanner are explicit states despite old prices',()=>{
  assert.equal(health({stream:{...stream,receivedAt:now-1000,marketOpen:false}}).kind,'closed');
  assert.equal(health({config:{...DEFAULT_CONFIG,enabled:false}}).kind,'paused');
});
test('a live heartbeat with old selected-market data is delayed, without pretending prices are live',()=>{
  const result=health({stream:{...stream,receivedAt:now-150}});
  assert.equal(result.kind,'delayed');assert.equal(result.tone,'amber');assert.match(result.notice,/heartbeat is active/);
});
test('an expired scanner lease is not treated as live',()=>{
  assert.equal(health({stream:{...stream,receivedAt:now-150},scanner:{...scanner,expiresAt:now-1}}).kind,'waiting');
  assert.equal(health({stream:{...stream,receivedAt:now-150},scanner:null}).kind,'waiting');
});
test('real desk/network failures and Deriv retries are distinct from old chart data',()=>{
  assert.equal(health({deskError:'Temporary HTTP failure'}).label,'Reconnecting to signal desk');
  assert.equal(health({offline:true,loadingFrame:true}).kind,'offline');
  assert.equal(health({phase:'retrying'}).label,'Reconnecting to Deriv');
});
test('stale MT5 snapshots and stale quotes still produce a warning',()=>{
  assert.equal(health({stream:{...stream,source:'MT5',receivedAt:now-60}}).kind,'stale');
  assert.equal(health({stream:{...stream,quoteTime:now-1000}}).kind,'quote_wait');
});
test('hung response-body reads time out, and the next request can succeed',async()=>{
  await assert.rejects(withRequestTimeout(async signal=>{
    await Promise.resolve({status:200});
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Body aborted')),{once:true}));
  },undefined,5),/timed out/);
  assert.deepEqual(await withRequestTimeout(async()=>({ok:true}),undefined,50),{ok:true});
});
test('unmount cancellation is preserved instead of becoming a timeout error',async()=>{
  const parent=new AbortController();
  const promise=withRequestTimeout(signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true})),parent.signal,50);
  parent.abort();await assert.rejects(promise,/Cancelled/);
});
test('the state API returns scanner heartbeat metadata without exposing its owner or changing stored prices',async()=>{
  const code=ts.transpileModule(fs.readFileSync(new URL('../app/api/state/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const empty of [false,true]) {
    const DB={prepare(sql){return{sql,bind(){return this;}};},async batch(statements){
      if(statements.length===2)return[{results:empty?[]:[{id:stream.streamId,payload:JSON.stringify({...stream,candles:[],signals:[]}),received_at:stream.receivedAt}]},{results:[{mode:'browser',heartbeat_at:scanner.heartbeatAt,expires_at:scanner.expiresAt,owner:'private-owner'}]}];
      return[{results:[]}];
    }};
    const exports={};new Function('require','exports',code)(name=>{assert.equal(name,'cloudflare:workers');return{env:{DB}};},exports);
    const response=await exports.GET(new Request('https://desk.example/api/state?stream='+stream.streamId));
    const body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.scanner,scanner);
    assert.ok(!JSON.stringify(body).includes('private-owner'));
    if(!empty)assert.equal(body.streams[0].quoteTime,stream.quoteTime);
  }
});
