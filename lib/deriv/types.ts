export type Market = { code: string; name: string; category: 'synthetic_index' | 'forex'; tickSize: number; digits: number; open: boolean; suspended: boolean };
export type Bar = { time: number; open: number; high: number; low: number; close: number };
export type StrategySettings = { periods: number[]; atrPeriod: number; atrMultiplier: number; targets: number[] };
export type DerivConfig = { enabled: boolean; scope: 'both' | 'synthetic_index' | 'forex' | 'watchlist'; symbols: string[]; timeframe: string; settings: StrategySettings };
export const FRAMES: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
export const DEFAULT_CONFIG: DerivConfig = { enabled: true, scope: 'both', symbols: [], timeframe: 'M5', settings: { periods: [8,13,21,34,55], atrPeriod: 14, atrMultiplier: 1.5, targets: [1.5,2,3] } };
export type ScannerStatus = { phase: string; message: string; loaded: number; total: number; errors: Record<string,string> };
