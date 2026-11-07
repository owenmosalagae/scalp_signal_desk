import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotSchema, settingsSchema } from '../lib/contracts.ts';

const settings = { periods: [8, 13, 21, 34, 55], atrPeriod: 14, atrMultiplier: 1.5, targets: [1.5, 2, 3] };
const sample = {
  streamId: 'a'.repeat(64), source: 'Deriv API', symbolCode: 'R_100',
  scannerMode: 'browser', scannerOwner: 'browser-test', marketOpen: true,
  symbol: 'Volatility 100 Index', timeframe: 'M5', timeframeSeconds: 300,
  broker: 'Deriv API', digits: 2, tickSize: 0.01, generatedAt: 1794080000,
  quoteTime: 1794080000, bid: 100, ask: 100, settings,
  trends: ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map(frame => ({ frame, state: 'Bullish' })),
  candles: [{ time: 1794080000, open: 99, high: 101, low: 98, close: 100,
    emas: [99, 98, 97, 96, 95], state: 'Bullish' }],
  signals: [{ id: 'b'.repeat(64), direction: 'BUY', candleTime: 1794079700,
    confirmedAt: 1794080000, entry: 100, stop: 98, targets: [103, 104, 106] }],
};

test('the updated validator accepts and preserves a scanner snapshot', () => {
  assert.deepEqual(snapshotSchema.parse(sample), sample);
});

test('invalid ribbon settings are still rejected', () => {
  assert.equal(settingsSchema.safeParse({ ...settings, periods: [55, 34, 21, 13, 8] }).success, false);
  assert.equal(settingsSchema.safeParse({ ...settings, targets: [3, 2, 1.5] }).success, false);
});

test('snapshot limits and finite prices are still enforced', () => {
  assert.equal(snapshotSchema.safeParse({ ...sample, candles: Array(181).fill(sample.candles[0]) }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...sample, bid: Infinity }).success, false);
});
