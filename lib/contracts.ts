import { z } from "zod";

const price = z.number().finite();
export const settingsSchema = z.object({
  periods: z.array(z.number().int().min(1).max(500)).length(5)
    .refine(p => p.every((value, i) => i === 0 || value > p[i - 1])),
  atrPeriod: z.number().int().min(1).max(500),
  atrMultiplier: z.number().finite().positive(),
  targets: z.array(z.number().finite().positive()).length(3)
    .refine(p => p[0] < p[1] && p[1] < p[2]),
});
export const signalSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  direction: z.enum(["BUY", "SELL"]),
  candleTime: z.number().int().positive(),
  confirmedAt: z.number().int().positive(),
  entry: price, stop: price,
  targets: z.array(price).length(3),
});
export const candleSchema = z.object({
  time: z.number().int().positive(),
  open: price, high: price, low: price, close: price,
  emas: z.array(price).length(5),
  state: z.enum(["Bullish", "Bearish", "Neutral"]),
});
export const snapshotSchema = z.object({
  streamId: z.string().regex(/^[a-f0-9]{64}$/),
  symbol: z.string().min(1).max(64),
  timeframe: z.string().regex(/^(M[1-9][0-9]*|H[1-9][0-9]*|D1)$/),
  timeframeSeconds: z.number().int().positive().max(86400),
  broker: z.string().max(100),
  digits: z.number().int().min(0).max(8),
  tickSize: price.positive(),
  generatedAt: z.number().int().positive(),
  quoteTime: z.number().int().nonnegative(),
  bid: price, ask: price,
  settings: settingsSchema,
  trends: z.array(z.object({
    frame: z.string().max(20),
    state: z.enum(["Bullish", "Bearish", "Neutral", "Loading"]),
  })).length(6),
  candles: z.array(candleSchema).max(180),
  signals: z.array(signalSchema).max(100),
});
export type Signal = z.infer<typeof signalSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type StoredSignal = Signal & { streamId: string; symbol: string; timeframe: string; receivedAt: number; digits: number };
export type DeskState = { streams: (Snapshot & { receivedAt: number })[]; signals: StoredSignal[] };
