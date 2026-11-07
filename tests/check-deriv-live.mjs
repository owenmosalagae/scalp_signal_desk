// Opt-in real public API smoke test. No credentials or orders are used.
import assert from 'node:assert/strict';
import { DerivEngine } from '../cloud-runner/runtime/engine.js';
import { DEFAULT_CONFIG } from '../cloud-runner/runtime/types.js';
const snapshots=new Map(),catalog=[];let last=0,done=false;
const engine=new DerivEngine(DEFAULT_CONFIG,crypto.randomUUID(),'cloud',{
  catalog:rows=>{catalog.push(...rows);console.log(JSON.stringify({catalog:rows.length,synthetics:rows.filter(m=>m.category==='synthetic_index').length,forex:rows.filter(m=>m.category==='forex').length}));},
  status:status=>{if(status.loaded>=last+10){last=status.loaded;console.log(JSON.stringify({loaded:status.loaded,total:status.total}));}if(status.phase==='live'){assert.deepEqual(status.errors,{},'Every selected history must load without silent failures');done=true;console.log(JSON.stringify({phase:status.phase,loaded:status.loaded,total:status.total,errors:status.errors}));engine.stop();}},
  snapshot:async snapshot=>{assert.ok(snapshot.candles.length>0);assert.ok(snapshot.signals.every(s=>s.confirmedAt<=snapshot.generatedAt));assert.match(snapshot.streamId,/^[a-f0-9]{64}$/);snapshots.set(snapshot.symbolCode,snapshot);},
});
const deadline=setTimeout(()=>{console.error('Timed out warming the complete live catalogue.');engine.stop();},360000);
await engine.run();clearTimeout(deadline);
assert.ok(done,'Must finish warming chart and higher-frame subscriptions');
assert.equal(snapshots.size,catalog.filter(m=>!m.suspended).length,'Every selected market must produce a snapshot');
assert.ok([...snapshots.values()].some(s=>s.symbolCode==='stpRNG'));
console.log('PASS: Live public API discovery, all selected chart histories, higher-timeframe subscriptions and confirmed-candle snapshots.');
