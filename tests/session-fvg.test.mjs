import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../vercel/package.json', import.meta.url))('typescript');
import { calculateSessionFvg, sessionEpoch } from '../cloud-runner/runtime/session-fvg.js';
import { DEFAULT_CONFIG, DEFAULT_SESSION, resolveConfig } from '../cloud-runner/runtime/types.js';
import { DerivEngine, strategyStreamSeed, selectedMarkets } from '../cloud-runner/runtime/engine.js';
import { derivConfigSchema, snapshotSchema } from '../vercel/lib/contracts.ts';

const settings = { ...DEFAULT_SESSION, mode: 'custom', timeZone: 'UTC', startTime: '10:00' };
function fixture({ anchor = Date.parse('2026-01-06T10:00:00Z') / 1000, mirror = false } = {}) {
  const bars = Array.from({ length: 80 }, (_, index) => ({ time: anchor - 7200 + index * 300, open: 100, high: 100.2, low: 99.8, close: 100 }));
  function put(minutes, value) { Object.assign(bars.find(bar => bar.time === anchor + minutes * 60), value); }
  for (const minute of [-15, -10, -5]) put(minute, { open: 100, high: 101, low: 99, close: 100 });
  put(0, { open: 100, high: 102.2, low: 99.8, close: 102 });
  put(5, { open: 102, high: 102.4, low: 101.8, close: 102.2 });
  put(10, { open: 102.2, high: 105.2, low: 102, close: 105 });
  put(15, { open: 105, high: 105.5, low: 104.8, close: 105.2 });
  put(20, { open: 105, high: 105.6, low: 104.5, close: 105.4 });
  if (mirror) for (const bar of bars) Object.assign(bar, { open: 200 - bar.open, close: 200 - bar.close, high: 200 - bar.low, low: 200 - bar.high });
  return { bars, anchor, put, now: anchor + 25 * 60 };
}
const run = (f, patch = {}, now = f.now) => calculateSessionFvg(f.bars, { ...settings, ...patch }, 0.1, 1, 14, now);

test('New York session times follow winter and summer clock offsets', () => {
  assert.equal(sessionEpoch('2026-01-06', '09:30', 'America/New_York'), Date.parse('2026-01-06T14:30:00Z') / 1000);
  assert.equal(sessionEpoch('2026-07-07', '09:30', 'America/New_York'), Date.parse('2026-07-07T13:30:00Z') / 1000);
});
test('nonexistent DST session times are skipped and repeated times use their first occurrence', () => {
  assert.equal(sessionEpoch('2026-03-08', '02:30', 'America/New_York'), null);
  assert.equal(sessionEpoch('2026-11-01', '01:30', 'America/New_York'), Date.parse('2026-11-01T05:30:00Z') / 1000);
});
test('a bullish range breakout, new FVG, and later closed retest produce one frozen signal', () => {
  const f = fixture(), result = run(f);
  assert.equal(result.signals.length, 1);
  const signal = result.signals[0];
  assert.equal(signal.direction, 'BUY');
  assert.equal(signal.entry, 105.4, 'Entry must be the retest close, not the earlier gap level');
  assert.equal(signal.confirmedAt, f.now);
  assert.equal(result.context.range.high, 101);
  assert.equal(result.context.range.low, 99);
  assert.equal(result.context.setup.status, 'confirmed');
  assert.equal(result.context.setup.detectedAt, f.anchor + 20 * 60);
  assert.ok(signal.stop < 99);
  assert.ok(signal.targets.every((target, index) => Math.abs((target - signal.entry) / (signal.entry - signal.stop) - settings.targets[index]) < 0.03));
  assert.equal(signal.strategyId, 'session_fvg');
});
test('the mirrored pattern produces a bearish signal and correctly oriented levels', () => {
  const result = run(fixture({ mirror: true }));
  assert.equal(result.signals.length, 1);
  const signal = result.signals[0];
  assert.equal(signal.direction, 'SELL');
  assert.equal(signal.entry, 94.6);
  assert.ok(signal.stop > signal.entry);
  assert.ok(signal.targets.every(target => target < signal.entry));
});
test('an FVG is pending until a later candle actually closes', () => {
  const f = fixture();
  const formed = run(f, {}, f.anchor + 20 * 60);
  assert.equal(formed.signals.length, 0);
  assert.equal(formed.context.phase, 'waiting_retest');
  const beforeClose = run(f, {}, f.now - 1);
  f.put(20, { high: 100000, low: -10000, close: 90000 });
  assert.deepEqual(run(f, {}, f.now - 1), beforeClose, 'A forming candle cannot change confirmed signals or pending context');
});
test('missing range candles and an unfinished reference range block entries', () => {
  const f = fixture();
  assert.equal(run(f, {}, f.anchor - 1).context.phase, 'building_range');
  f.bars = f.bars.filter(bar => bar.time !== f.anchor - 600);
  const result = run(f);
  assert.equal(result.signals.length, 0);
  assert.equal(result.context.phase, 'missing_range');
});
test('opening-range mode waits for its own first fifteen minutes', () => {
  const f = fixture(), result = run(f, { rangeMode: 'opening' }, f.anchor + 20 * 60);
  assert.equal(result.context.range.start, f.anchor);
  assert.equal(result.context.range.end, f.anchor + 900);
  assert.equal(result.context.range.high, 105.2);
  assert.equal(result.signals.length, 0);
});
test('historical gaps before a breakout cannot satisfy its FVG confirmation', () => {
  const f = fixture();
  f.put(-30, { open: 95, high: 96, low: 94, close: 95.5 });
  f.put(-25, { open: 95.5, high: 101, low: 95, close: 100 });
  f.put(-20, { open: 100, high: 101, low: 99.5, close: 100.5 });
  f.put(10, { open: 102.2, high: 105.2, low: 102, close: 102.3 });
  assert.equal(run(f).signals.length, 0);
});
test('an absent retest expires instead of becoming a late historical fill', () => {
  const f = fixture();
  f.put(20, { open: 106, high: 106.2, low: 105.8, close: 106 });
  f.put(25, { open: 105, high: 105.6, low: 104.5, close: 105.4 });
  const result = run(f, { expiryBars: 1 }, f.anchor + 30 * 60);
  assert.equal(result.signals.length, 0);
  assert.equal(result.context.setup.status, 'expired');
});
test('a stop breach on a retest candle invalidates it before any entry is confirmed', () => {
  const f = fixture(); f.put(20, { low: 95 });
  const result = run(f);
  assert.equal(result.signals.length, 0);
  assert.equal(result.context.setup.status, 'invalidated');
});
test('a candle-history gap invalidates a pending setup', () => {
  const f = fixture();
  f.put(25, { open: 105, high: 105.6, low: 104.5, close: 105.4 });
  f.bars = f.bars.filter(bar => bar.time !== f.anchor + 20 * 60);
  const result = run(f, {}, f.anchor + 30 * 60);
  assert.equal(result.signals.length, 0);
  assert.equal(result.context.setup.status, 'invalidated');
});
test('higher displacement requirements reject the same small-body setup', () => {
  const f = fixture(); f.put(10, { open: 104.9 });
  assert.equal(run(f).signals.length, 0);
});
test('midpoint mode requires the deeper retest and does not assume it filled', () => {
  const f = fixture();
  assert.equal(run(f, { retestLevel: 'midpoint' }).signals.length, 0);
  f.put(20, { low: 103 });
  assert.equal(run(f, { retestLevel: 'midpoint' }).signals.length, 1);
});
test('custom sessions retain their reference date across midnight', () => {
  const f = fixture({ anchor: Date.parse('2026-01-06T23:55:00Z') / 1000 });
  const result = run(f, { startTime: '23:55' });
  assert.equal(result.signals.length, 1);
  assert.match(result.signals[0].sessionId, /^2026-01-06@/);
});
test('future candles do not alter earlier entry, stop or target levels', () => {
  const f = fixture(), earlier = run(f).signals[0];
  f.put(30, { high: 10000, low: -1000 });
  assert.deepEqual(run(f, {}, f.anchor + 45 * 60).signals[0], earlier);
  assert.deepEqual(run(f).signals[0], earlier, 'Replay must be deterministic');
});
test('the trade-window boundary accepts its closing candle and rejects a later close', () => {
  const f = fixture();
  assert.equal(run(f, { tradeWindowMinutes: 25 }).signals.length, 1);
  assert.equal(run(f, { tradeWindowMinutes: 24 }).signals.length, 0);
});
test('the session signal cap applies to later independent FVG retests', () => {
  const f = fixture();
  f.put(25, { open: 105.4, high: 105.8, low: 105, close: 105.6 });
  f.put(30, { open: 105.6, high: 109, low: 105.4, close: 108.8 });
  f.put(35, { open: 108.8, high: 109.2, low: 108.4, close: 108.9 });
  f.put(40, { open: 108.6, high: 109.4, low: 108.3, close: 109.2 });
  assert.equal(run(f, { maxSignalsPerSession: 1 }, f.anchor + 45 * 60).signals.length, 1);
  assert.equal(run(f, { maxSignalsPerSession: 2 }, f.anchor + 45 * 60).signals.length, 2);
});
test('rounded targets must remain distinct tradable price levels', () => {
  assert.equal(run(fixture(), { targets: [0.0001, 0.0002, 0.0003] }).signals.length, 0);
});
test('invalid settings are rejected and legacy settings resolve to the original Ribbon strategy', () => {
  const legacy = { enabled: true, scope: 'both', symbols: [], timeframe: 'M5', settings: DEFAULT_CONFIG.settings };
  assert.equal(derivConfigSchema.parse(legacy).strategy, 'scalp_ribbon');
  assert.deepEqual(derivConfigSchema.parse(legacy).session, DEFAULT_SESSION);
  const valid = { ...legacy, strategy: 'session_fvg', session: settings };
  assert.equal(derivConfigSchema.safeParse(valid).success, true);
  for (const patch of [{ timeZone: 'Invalid/Zone' }, { startTime: '10:03' }, { targets: [3, 2, 1] }, { expiryBars: 0 }]) {
    assert.equal(derivConfigSchema.safeParse({ ...valid, session: { ...settings, ...patch } }).success, false);
  }
  assert.equal(derivConfigSchema.safeParse({ ...valid, timeframe: 'M15' }).success, false);
});
test('Ribbon history identities survive switching and changed FVG rules get distinct streams', () => {
  assert.equal(strategyStreamSeed('R_100', DEFAULT_CONFIG), 'scalp-ribbon-deriv-v1:' + JSON.stringify(['R_100', DEFAULT_CONFIG.timeframe, DEFAULT_CONFIG.settings]));
  const custom = { ...DEFAULT_CONFIG, strategy: 'session_fvg', session: settings };
  assert.notEqual(strategyStreamSeed('R_100', custom), strategyStreamSeed('R_100', DEFAULT_CONFIG));
  assert.notEqual(strategyStreamSeed('R_100', custom), strategyStreamSeed('R_100', { ...custom, session: { ...settings, retestLevel: 'midpoint' } }));
  assert.equal(strategyStreamSeed('R_100', DEFAULT_CONFIG), strategyStreamSeed('R_100', resolveConfig(DEFAULT_CONFIG)));
});
test('New York mode excludes synthetic markets while custom-session mode supports them', () => {
  const markets = [{ code: 'R_100', category: 'synthetic_index', suspended: false }, { code: 'frxEURUSD', category: 'forex', suspended: false }];
  assert.equal(selectedMarkets(markets, { ...DEFAULT_CONFIG, strategy: 'session_fvg' }).length, 1);
  assert.equal(selectedMarkets(markets, { ...DEFAULT_CONFIG, strategy: 'session_fvg', session: settings }).length, 2);
});

async function capturedSnapshot() {
  const f = fixture(), snapshots = [], realNow = Date.now;
  Date.now = () => f.now * 1000;
  const config = { ...DEFAULT_CONFIG, strategy: 'session_fvg', session: settings };
  const engine = new DerivEngine(config, 'c8275147-077a-405d-b672-7aa33f0c8c3a', 'browser', { snapshot: async value => snapshots.push(value), catalog: () => {}, status: () => {} });
  const monitor = { market: { code: 'frxEURUSD', name: 'EUR/USD', category: 'forex', open: true, digits: 1, tickSize: 0.1 },
    streamId: 'a'.repeat(64), frames: new Map([[300, f.bars]]), quoteTime: f.now, sent: new Set(), lastPublished: 0, lastClosed: 0, dirty: true, busy: false, retryAt: 0 };
  try {
    await engine.publish(monitor, true);
    await engine.publish(monitor, true);
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].signals.length, 1);
    assert.ok(snapshots[0].candles.length > 0, 'FVG chart candles must not wait for the unused EMA warmup');
    assert.equal(snapshots[1].signals.length, 0, 'A successful save must deduplicate repeated publishes');
    assert.equal(snapshots[0].backfill, true);
    assert.equal(snapshots[1].backfill, false);
    assert.equal(snapshotSchema.safeParse(snapshots[0]).success, true);
    return snapshots[0];
  } finally { Date.now = realNow; engine.stop(); }
}
test('browser/cloud shared engine emits valid labelled snapshots and suppresses replay alerts', capturedSnapshot);

function route(file, env) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === 'cloudflare:workers') return { env };
    if (name === '@/lib/contracts') return { derivConfigSchema, snapshotSchema };
    if (name === '@/lib/deriv/types') return { DEFAULT_CONFIG };
    throw new Error('Unexpected route import: ' + name);
  }, exports);
  return exports;
}
const statement = (sql) => ({ sql, values: [], bind(...values) { this.values = values; return this; } });
test('backend round-trips strategy settings in the existing configuration record', async () => {
  let stored;
  const DB = { prepare: statement, async batch(statements) {
    if (statements.length === 1) { stored = statements[0].values[0]; return [{ results: [] }]; }
    return [{ results: stored ? [{ payload: stored }] : [] }, { results: [] }];
  } };
  const api = route(new URL('../app/api/deriv/config/route.ts', import.meta.url), { DB });
  const config = { ...DEFAULT_CONFIG, strategy: 'session_fvg', session: settings };
  const response = await api.POST(new Request('https://desk.example/api/deriv/config', { method: 'POST', headers: { Origin: 'https://desk.example' }, body: JSON.stringify(config) }));
  assert.equal(response.status, 200);
  const saved = await (await api.GET()).json();
  assert.equal(saved.capabilities.strategySwitching, 1);
  assert.deepEqual(saved.config.session, settings);
  assert.equal(saved.config.strategy, 'session_fvg');
  stored = JSON.stringify({ enabled: true, scope: 'both', symbols: [], timeframe: 'M5', settings: DEFAULT_CONFIG.settings });
  assert.equal((await (await api.GET()).json()).config.strategy, 'scalp_ribbon');
});
test('backend stores the strategy and original session settings with each confirmed signal', async () => {
  const snapshot = await capturedSnapshot(), saved = [];
  const DB = { prepare: statement, async batch(statements) {
    if (statements[0].sql.startsWith('SELECT')) return [{ results: [{ owner: snapshot.scannerOwner, mode: 'browser', expires_at: Math.floor(Date.now() / 1000) + 75 }] }];
    saved.push(...statements); return statements.map(() => ({ results: [] }));
  } };
  const api = route(new URL('../app/api/ingest/route.ts', import.meta.url), { DB });
  const response = await api.POST(new Request('https://desk.example/api/ingest', { method: 'POST', headers: { Origin: 'https://desk.example' }, body: JSON.stringify(snapshot) }));
  assert.equal(response.status, 200);
  const record = JSON.parse(saved.find(value => value.sql.startsWith('INSERT INTO signals')).values[2]);
  assert.equal(record.strategyId, 'session_fvg');
  assert.equal(record.strategyVersion, '1');
  assert.deepEqual(record.sessionSettings, settings);
  assert.equal(record.entry, 105.4);
});
