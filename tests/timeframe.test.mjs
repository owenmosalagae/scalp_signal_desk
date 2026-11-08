import test from 'node:test';
import assert from 'node:assert/strict';
import { timeframeAction } from '../lib/deriv/chart-navigation.ts';
import { DEFAULT_CONFIG } from '../lib/deriv/types.ts';

const stream = { streamId: 'a'.repeat(64), source: 'Deriv API', symbol: 'EUR/USD', symbolCode: 'frxEURUSD', broker: 'Deriv API · public prices', timeframe: 'M5', settings: DEFAULT_CONFIG.settings };
test('chart switching changes only the configured timeframe, preserving markets, strategy and risk settings', () => {
  const config = { ...DEFAULT_CONFIG, scope: 'watchlist', symbols: ['frxEURUSD', 'frxGBPUSD'], enabled: false };
  const action = timeframeAction(stream, [stream], config, 'H1');
  assert.equal(action.kind, 'scan');
  assert.equal(action.symbolCode, 'frxEURUSD');
  assert.deepEqual(action.config, { ...config, timeframe: 'H1' });
  assert.equal(config.timeframe, 'M5');
});
test('every supported Ribbon timeframe can start a same-market scan', () => {
  for (const frame of ['M1', 'M15', 'M30', 'H1', 'H4', 'D1']) assert.equal(timeframeAction(stream, [], DEFAULT_CONFIG, frame).kind, 'scan');
  assert.deepEqual(timeframeAction(stream, [], DEFAULT_CONFIG, 'M5'), { kind: 'select', streamId: stream.streamId });
  assert.equal(timeframeAction(stream, [], DEFAULT_CONFIG, 'M45').kind, 'unavailable');
});
test('Session FVG cannot silently change its M5 confirmation rules', () => {
  const session = { ...stream, strategyId: 'session_fvg' };
  assert.equal(timeframeAction(session, [], { ...DEFAULT_CONFIG, strategy: 'session_fvg' }, 'H1').kind, 'unavailable');
  assert.equal(timeframeAction(session, [], { ...DEFAULT_CONFIG, strategy: 'session_fvg' }, 'M5').kind, 'select');
});
test('MT5 switches only to a supplied chart for the same broker, symbol, strategy and settings', () => {
  const mt5 = { ...stream, source: 'MT5', broker: 'Broker A' };
  const target = { ...mt5, streamId: 'b'.repeat(64), timeframe: 'H1' };
  assert.deepEqual(timeframeAction(mt5, [target], DEFAULT_CONFIG, 'H1'), { kind: 'select', streamId: target.streamId });
  for (const patch of [{ broker: 'Broker B' }, { symbol: 'GBP/USD' }, { source: 'Deriv API' }, { strategyId: 'session_fvg' }, { settings: { ...DEFAULT_CONFIG.settings, atrMultiplier: 5 } }]) {
    assert.equal(timeframeAction(mt5, [{ ...target, ...patch }], DEFAULT_CONFIG, 'H1').kind, 'unavailable');
  }
});
test('viewing a saved Ribbon chart never changes an active FVG scanner', () => {
  const config = { ...DEFAULT_CONFIG, strategy: 'session_fvg' };
  assert.equal(timeframeAction(stream, [], config, 'H1').kind, 'unavailable');
  const saved = { ...stream, timeframe: 'H1', streamId: 'b'.repeat(64) };
  assert.deepEqual(timeframeAction(stream, [saved], config, 'H1'), { kind: 'select', streamId: saved.streamId });
});
test('a market outside the scanner selection cannot enter an endless new-chart wait', () => {
  assert.equal(timeframeAction(stream, [], { ...DEFAULT_CONFIG, scope: 'watchlist', symbols: ['frxGBPUSD'] }, 'H1').kind, 'unavailable');
  assert.equal(timeframeAction(stream, [], { ...DEFAULT_CONFIG, scope: 'synthetic_index' }, 'H1', { category: 'forex' }).kind, 'unavailable');
  assert.equal(timeframeAction(stream, [], { ...DEFAULT_CONFIG, scope: 'forex' }, 'H1', { category: 'forex' }).kind, 'scan');
  assert.equal(timeframeAction({ ...stream, symbolCode: undefined }, [], DEFAULT_CONFIG, 'H1').kind, 'unavailable');
});
