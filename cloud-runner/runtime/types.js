// Generated from lib/deriv/types.ts. Run node scripts/build-deriv-runner.mjs after changes.
export const STRATEGIES = {
    scalp_ribbon: { name: 'Scalp Ribbon', version: '1', description: 'EMA alignment with ATR stops and fixed targets.' },
    session_fvg: { name: 'Session Range + FVG', version: '1', description: 'A completed M15 range, M5 breakout, displacement, then a confirmed FVG retest.' },
};
export const DEFAULT_SESSION = {
    mode: 'new_york', timeZone: 'America/New_York', startTime: '09:30', rangeMode: 'pre_session',
    tradeWindowMinutes: 120, atrPeriod: 14, displacementAtr: 1.2, minGapAtr: 0.1, retestLevel: 'edge',
    swingLookback: 20, stopBufferAtr: 0.1, stopBufferTicks: 2, expiryBars: 6,
    maxSignalsPerSession: 1, targets: [1, 2, 3],
};
export function resolveConfig(config) {
    const strategy = config.strategy || 'scalp_ribbon';
    const session = { ...DEFAULT_SESSION, ...config.session, targets: [...(config.session?.targets || DEFAULT_SESSION.targets)] };
    if (session.mode === 'new_york') {
        session.timeZone = 'America/New_York';
        session.startTime = '09:30';
    }
    return { ...config, strategy, session, timeframe: strategy === 'session_fvg' ? 'M5' : config.timeframe };
}
export function strategyName(id) { return id === 'session_fvg' ? STRATEGIES.session_fvg.name : STRATEGIES.scalp_ribbon.name; }
export const FRAMES = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
export const DEFAULT_CONFIG = { enabled: true, scope: 'both', symbols: [], timeframe: 'M5', strategy: 'scalp_ribbon', session: DEFAULT_SESSION, settings: { periods: [8, 13, 21, 34, 55], atrPeriod: 14, atrMultiplier: 1.5, targets: [1.5, 2, 3] } };
