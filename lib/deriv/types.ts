export type Market = { code: string; name: string; category: 'synthetic_index' | 'forex'; tickSize: number; digits: number; open: boolean; suspended: boolean };
export type Bar = { time: number; open: number; high: number; low: number; close: number };
export type StrategySettings = { periods: number[]; atrPeriod: number; atrMultiplier: number; targets: number[] };
export type StrategyId = 'scalp_ribbon' | 'session_fvg';
export type SessionSettings = {
  mode: 'new_york' | 'custom'; timeZone: string; startTime: string;
  rangeMode: 'pre_session' | 'opening'; tradeWindowMinutes: number;
  atrPeriod: number; displacementAtr: number; minGapAtr: number; retestLevel: 'edge' | 'midpoint';
  swingLookback: number; stopBufferAtr: number; stopBufferTicks: number;
  expiryBars: number; maxSignalsPerSession: number; targets: number[];
};
export type DerivConfig = { enabled: boolean; scope: 'both' | 'synthetic_index' | 'forex' | 'watchlist'; symbols: string[]; timeframe: string; settings: StrategySettings; strategy?: StrategyId; session?: SessionSettings };
export type ResolvedDerivConfig = DerivConfig & { strategy: StrategyId; session: SessionSettings };
export const STRATEGIES = {
  scalp_ribbon: { name: 'Scalp Ribbon', version: '1', description: 'EMA alignment with ATR stops and fixed targets.' },
  session_fvg: { name: 'Session Range + FVG', version: '1', description: 'A completed M15 range, M5 breakout, displacement, then a confirmed FVG retest.' },
} as const;
export const DEFAULT_SESSION: SessionSettings = {
  mode: 'new_york', timeZone: 'America/New_York', startTime: '09:30', rangeMode: 'pre_session',
  tradeWindowMinutes: 120, atrPeriod: 14, displacementAtr: 1.2, minGapAtr: 0.1, retestLevel: 'edge',
  swingLookback: 20, stopBufferAtr: 0.1, stopBufferTicks: 2, expiryBars: 6,
  maxSignalsPerSession: 1, targets: [1, 2, 3],
};
export function resolveConfig(config: DerivConfig): ResolvedDerivConfig {
  const strategy = config.strategy || 'scalp_ribbon';
  const session = { ...DEFAULT_SESSION, ...config.session, targets: [...(config.session?.targets || DEFAULT_SESSION.targets)] };
  if (session.mode === 'new_york') { session.timeZone = 'America/New_York'; session.startTime = '09:30'; }
  return { ...config, strategy, session, timeframe: strategy === 'session_fvg' ? 'M5' : config.timeframe };
}
export function strategyName(id?: string) { return id === 'session_fvg' ? STRATEGIES.session_fvg.name : STRATEGIES.scalp_ribbon.name; }
export const FRAMES: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
export const DEFAULT_CONFIG: ResolvedDerivConfig = { enabled: true, scope: 'both', symbols: [], timeframe: 'M5', strategy: 'scalp_ribbon', session: DEFAULT_SESSION, settings: { periods: [8,13,21,34,55], atrPeriod: 14, atrMultiplier: 1.5, targets: [1.5,2,3] } };
export type ScannerStatus = { phase: string; message: string; loaded: number; total: number; errors: Record<string,string> };
