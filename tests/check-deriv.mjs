import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { calculate,aggregate45,trendFromBars } from '../cloud-runner/runtime/strategy.js';
import { normalizeMarkets,normalizeBars } from '../cloud-runner/runtime/client.js';
import { DerivEngine, selectedMarkets } from '../cloud-runner/runtime/engine.js';
import { DEFAULT_CONFIG } from '../cloud-runner/runtime/types.js';
for(const file of ['types','strategy','session-fvg','client','engine']){
  const source=fs.readFileSync('lib/deriv/'+file+'.ts','utf8');
  const expected='// Generated from lib/deriv/'+file+'.ts. Run node scripts/build-deriv-runner.mjs after changes.\n'+ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  assert.equal(fs.readFileSync('cloud-runner/runtime/'+file+'.js','utf8'),expected,'Cloud runner must match the browser engine');
}
const fixtures=JSON.parse(execFileSync('python3',['-c',`
import sys,json,math
sys.path.insert(0,'connector')
from strategy import calculate, DEFAULT_SETTINGS
fixtures=[]
for tick,digits,base,settings in [(0.1,1,7300,DEFAULT_SETTINGS),(0.00001,5,1.1,DEFAULT_SETTINGS),(0.25,2,-100,DEFAULT_SETTINGS),(0.01,2,2000,dict(periods=[3,5,8,13,21],atrPeriod=9,atrMultiplier=2.3,targets=[1,2.5,4]))]:
 bars=[]
 for i in range(700):
  center=base+tick*(i*.2+math.sin(i*.083)*80+math.cos(i*.29)*12)
  op=center+tick*math.sin(i*.7)*3
  close=center+tick*math.cos(i*.61)*4
  bars.append(dict(time=1700000100+i*300,open=op,high=max(op,close)+tick*3,low=min(op,close)-tick*2,close=close))
 candles,signals=calculate(bars,settings,tick,digits,'fixture-stream',300)
 for s in signals:s.pop('id')
 fixtures.append(dict(bars=bars,settings=settings,tick=tick,digits=digits,candles=candles,signals=signals))
print(json.dumps(fixtures))
`],{encoding:'utf8',maxBuffer:4e6}));
let signalCount=0;
for(const f of fixtures){
  const result=calculate(f.bars,f.settings,f.tick,f.digits,300,f.bars.at(-1).time+1);
  assert.equal(result.signals.length,f.signals.length);signalCount+=result.signals.length;
  for(let i=0;i<f.signals.length;i++){
    const a=result.signals[i],b=f.signals[i];
    assert.equal(a.direction,b.direction);assert.equal(a.confirmedAt,b.confirmedAt);
    for(const field of ['entry','stop'])assert.ok(Math.abs(a[field]-b[field])<1e-8);
    for(let j=0;j<3;j++)assert.ok(Math.abs(a.targets[j]-b.targets[j])<1e-8);
  }
  assert.equal(result.candles.length,f.candles.length);
  for(let i=0;i<f.candles.length;i++)for(let j=0;j<5;j++)assert.ok(Math.abs(result.candles[i].emas[j]-f.candles[i].emas[j])<1e-8);
  const bars=structuredClone(f.bars),last=bars.at(-1);last.close+=f.tick*100000;last.high=last.close+f.tick;
  assert.deepEqual(calculate(bars,f.settings,f.tick,f.digits,300,last.time+1).signals,result.signals,'A forming bar must not generate a signal');
}
const bars=[0,900,1800,2700,3600,4500].map(t=>({time:t,open:1,high:3,low:0,close:2}));
assert.equal(aggregate45(bars,4501).length,1);
assert.equal(aggregate45(bars,5400).length,2);
assert.equal(aggregate45(bars.filter(b=>b.time!==900),5400).length,1);
assert.equal(trendFromBars([],DEFAULT_CONFIG.settings.periods,300,10000),'Loading');
const markets=normalizeMarkets([
  {underlying_symbol:'stpRNG',underlying_symbol_name:'Step Index 100',market:'synthetic_index',pip_size:.1,exchange_is_open:1,is_trading_suspended:0},
  {underlying_symbol:'frxEURUSD',underlying_symbol_name:'EUR/USD',market:'forex',pip_size:.00001,exchange_is_open:0,is_trading_suspended:0},
  {underlying_symbol:'BAD',underlying_symbol_name:'Bad precision',market:'forex',pip_size:0},
  {underlying_symbol:'BTC',underlying_symbol_name:'Bitcoin',market:'cryptocurrency',pip_size:.01},
]);
assert.equal(markets.length,2);assert.equal(markets.find(m=>m.code==='frxEURUSD').digits,5);
assert.equal(selectedMarkets(markets,DEFAULT_CONFIG).length,2);
assert.equal(selectedMarkets(markets,{...DEFAULT_CONFIG,scope:'forex'})[0].code,'frxEURUSD');
assert.equal(selectedMarkets(markets,{...DEFAULT_CONFIG,scope:'watchlist',symbols:['stpRNG']})[0].code,'stpRNG');
assert.equal(normalizeBars([{epoch:300,open:1,high:3,low:0,close:2},{epoch:300,open:1,high:4,low:0,close:3},{epoch:600,open:1,high:0,low:2,close:1}]).length,1);
console.log('PASS: '+signalCount+' signal calculations match the Python MT5 strategy across 4 settings/precision cases; forming bars, complete M45 aggregation, catalogue filtering and shared runtime consistency.');

const now=Math.floor(Date.now()/1000),calls=[];
const fake={onCandle:()=>{},onDisconnect:()=>{},connect:async()=>{},close:()=>{},markets:async()=>markets.map(m=>({...m,open:true})),
  history:async(code,frame,subscribe)=>{calls.push({code,frame,subscribe});if(code==='frxEURUSD'&&subscribe)throw new Error('subscription limit exceeded');
    const end=Math.floor(now/frame)*frame;
    return Array.from({length:100},(_,i)=>({time:end-(99-i)*frame,open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100.5+i*.1}));}};
const engine=new DerivEngine(DEFAULT_CONFIG,crypto.randomUUID(),'browser',{snapshot:async()=>{},catalog:()=>{},status:status=>{if(status.phase==='live')engine.stop();}},()=>fake);
await engine.session();
assert.equal(engine.monitors.size,2);
assert.equal(engine.monitors.get('frxEURUSD').streaming,false,'A subscription cap must keep the market using history refresh');
assert.ok(calls.some(c=>c.code==='frxEURUSD'&&!c.subscribe));
assert.ok(calls.filter(c=>c.frame!==300).every(c=>!c.subscribe),'Trend history must not consume streaming subscriptions');
const monitor=engine.monitors.get('stpRNG'),bar=monitor.frames.get(300).at(-1),higher=monitor.frames.get(3600).at(-1);
fake.onCandle({symbol:'stpRNG',granularity:300,open_time:bar.time,open:bar.open,high:bar.high+2,low:bar.low,close:bar.close+1,epoch:now});
assert.equal(monitor.frames.get(3600).at(-1).close,bar.close+1,'The live chart must update its containing higher frame');
assert.ok(monitor.frames.get(3600).at(-1).high>=higher.high);
engine.stopped=false;
const fallback=engine.monitors.get('frxEURUSD');fallback.refreshed.set(300,0);
await engine.refresh(fallback,300,fake);engine.stop();
assert.ok(fallback.quoteTime>0,'Non-streaming markets retain a useful candle timestamp');
console.log('PASS: Subscription-cap fallback preserves all markets, higher frames avoid subscriptions, chart rollups update trend data, and polling refreshes recover candle timestamps.');
