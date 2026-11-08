import { z } from "zod";
import { DEFAULT_SESSION } from './deriv/types.ts';

const price = z.number().finite();
export const strategyIdSchema = z.enum(['scalp_ribbon', 'session_fvg']);
const targetsSchema = z.array(z.number().finite().positive().max(20)).length(3)
  .refine(values => values[0] < values[1] && values[1] < values[2]);
export const sessionSettingsSchema = z.object({
  mode: z.enum(['new_york', 'custom']),
  timeZone: z.string().min(1).max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).refine(value => Number(value.slice(3)) % 5 === 0, 'Use a five-minute boundary.'),
  rangeMode: z.enum(['pre_session', 'opening']), tradeWindowMinutes: z.number().int().min(15).max(240),
  atrPeriod: z.number().int().min(2).max(100), displacementAtr: z.number().finite().min(0.1).max(5), minGapAtr: z.number().finite().min(0).max(2),
  retestLevel: z.enum(['edge', 'midpoint']), swingLookback: z.number().int().min(3).max(100),
  stopBufferAtr: z.number().finite().min(0).max(2), stopBufferTicks: z.number().int().min(1).max(100),
  expiryBars: z.number().int().min(1).max(48), maxSignalsPerSession: z.number().int().min(1).max(5), targets: targetsSchema,
}).superRefine((value, context) => {
  if (value.mode === 'new_york' && (value.timeZone !== 'America/New_York' || value.startTime !== '09:30'))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'New York mode uses 09:30 America/New_York.' });
});
export const settingsSchema = z.object({
  periods: z.array(z.number().int().min(1).max(500)).length(5)
    .refine(p => p.every((value, i) => i === 0 || value > p[i - 1])),
  atrPeriod: z.number().int().min(1).max(500),
  atrMultiplier: z.number().finite().positive(),
  targets: z.array(z.number().finite().positive()).length(3)
    .refine(p => p[0] < p[1] && p[1] < p[2]),
});
export const derivConfigSchema = z.object({
  enabled: z.boolean(), scope: z.enum(['both', 'synthetic_index', 'forex', 'watchlist']),
  symbols: z.array(z.string().regex(/^[\w.-]{1,64}$/)).max(250),
  timeframe: z.enum(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']), settings: settingsSchema,
  strategy: strategyIdSchema.default('scalp_ribbon'), session: sessionSettingsSchema.default(DEFAULT_SESSION),
}).superRefine((value, context) => {
  if (value.strategy === 'session_fvg' && value.timeframe !== 'M5')
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Session FVG uses M5 confirmation candles.', path: ['timeframe'] });
  if (value.strategy === 'session_fvg' && value.session.mode === 'new_york' && value.scope === 'synthetic_index')
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a custom session for synthetic indices.', path: ['scope'] });
});
const strategyMetadata = {
  strategyId: strategyIdSchema.optional(), strategyVersion: z.string().max(20).optional(),
  sessionId: z.string().max(120).optional(), setupTime: z.number().int().positive().optional(),
  reason: z.string().max(240).optional(),
};
const setupSchema = z.object({
  id: z.string().max(160), direction: z.enum(['BUY', 'SELL']),
  detectedAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
  gapLow: price, gapHigh: price, retestPrice: price, stop: price,
  status: z.enum(['waiting_retest', 'confirmed', 'expired', 'invalidated']),
  completedAt: z.number().int().positive().optional(),
});
export const sessionContextSchema = z.object({
  phase: z.enum(['waiting_session', 'building_range', 'missing_range', 'waiting_breakout', 'waiting_fvg', 'waiting_retest', 'confirmed', 'expired', 'invalidated', 'outside_window']),
  message: z.string().max(240),
  range: z.object({ sessionId: z.string().max(120), start: z.number().int().positive(), end: z.number().int().positive(), tradeEnd: z.number().int().positive(), high: price, low: price }).optional(),
  setup: setupSchema.optional(), zones: z.array(setupSchema).max(20),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;
export type SessionSetup = z.infer<typeof setupSchema>;
export const signalSchema = z.object({
  ...strategyMetadata,
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
  strategyId: strategyIdSchema.optional(), strategyVersion: z.string().max(20).optional(),
  sessionSettings: sessionSettingsSchema.optional(), sessionContext: sessionContextSchema.optional(),
  streamId: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(["MT5", "Deriv API"]).optional(),
  symbolCode: z.string().max(64).optional(),
  scannerMode: z.enum(["browser", "cloud"]).optional(),
  scannerOwner: z.string().max(100).optional(),
  marketOpen: z.boolean().optional(),
  backfill: z.boolean().optional(),
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
export type StoredSignal = Signal & { streamId: string; symbol: string; timeframe: string; receivedAt: number; digits: number; backfilled?: boolean; source?: string; broker?: string; settings?: z.infer<typeof settingsSchema>; sessionSettings?: z.infer<typeof sessionSettingsSchema> };
export type DeskState = { streams: (Snapshot & { receivedAt: number })[]; signals: StoredSignal[]; scanner?: { mode: string; heartbeatAt: number; expiresAt: number } | null };
