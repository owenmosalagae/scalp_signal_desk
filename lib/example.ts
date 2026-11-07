import type { DeskState, Snapshot, StoredSignal } from "./contracts";
const start = Date.UTC(2026, 10, 5, 1) / 1000;
const exampleSignal: StoredSignal = {
  id: "example-sell", streamId: "example", direction: "SELL", candleTime: start + 39 * 300,
  confirmedAt: start + 40 * 300, entry: 3937.53, stop: 3945.88,
  targets: [3925.01, 3920.83, 3912.48], symbol: "XAUUSD", timeframe: "M5",
  receivedAt: start + 40 * 300, digits: 2,
};
const candles = Array.from({ length: 112 }, (_, i) => {
  const center = 3953 - i * 0.45 + Math.sin(i * 0.36) * 2.2 + Math.cos(i * 0.9) * 0.8;
  const open = center + Math.sin(i * 1.8) * 0.7;
  const close = center + Math.cos(i * 2.1) * 0.9;
  return {
    time: start + i * 300, open, close, high: Math.max(open, close) + 0.5,
    low: Math.min(open, close) - 0.7,
    emas: [center + 2.1, center + 4.3, center + 6.4, center + 9.0, center + 12.0],
    state: "Bearish" as const,
  };
});
const snapshot: Snapshot & { receivedAt: number } = {
  streamId: "example", symbol: "XAUUSD", timeframe: "M5", timeframeSeconds: 300,
  broker: "Example prices", digits: 2, tickSize: 0.01, generatedAt: start + 112 * 300,
  receivedAt: 0, quoteTime: start + 112 * 300, bid: 3902.36, ask: 3902.55,
  settings: { periods: [8, 13, 21, 34, 55], atrPeriod: 14, atrMultiplier: 1.5, targets: [1.5, 2, 3] },
  trends: ["5m (chart)", "15m", "45m", "1h", "4h", "1D"].map(frame => ({ frame, state: "Bearish" })),
  candles, signals: [exampleSignal],
};
export const example: DeskState = { streams: [snapshot], signals: [exampleSignal] };
