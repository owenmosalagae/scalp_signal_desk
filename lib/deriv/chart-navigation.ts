import { FRAMES } from './types.ts';
import type { DerivConfig, Market } from './types.ts';
import type { DeskState } from '../contracts';

type Stream = DeskState['streams'][number];
export type TimeframeAction =
  | { kind: 'select'; streamId: string }
  | { kind: 'scan'; config: DerivConfig; symbolCode: string }
  | { kind: 'unavailable'; message: string };

export function timeframeAction(stream: Stream, streams: Stream[], config: DerivConfig, frame: string, market?: Market): TimeframeAction {
  if (!Object.hasOwn(FRAMES, frame)) return { kind: 'unavailable', message: 'Choose a supported chart timeframe.' };
  if (frame === stream.timeframe) return { kind: 'select', streamId: stream.streamId };
  if (stream.strategyId === 'session_fvg') return { kind: 'unavailable', message: 'Session Range + FVG confirms on M5. Choose Scalp Ribbon in Manage markets to use another timeframe.' };
  const saved = streams.find(candidate => candidate.timeframe === frame && candidate.symbol === stream.symbol &&
    candidate.broker === stream.broker && (candidate.source || 'MT5') === (stream.source || 'MT5') &&
    (candidate.strategyId || 'scalp_ribbon') === (stream.strategyId || 'scalp_ribbon') &&
    JSON.stringify(candidate.settings) === JSON.stringify(stream.settings));
  if (stream.source !== 'Deriv API') return saved ? { kind: 'select', streamId: saved.streamId } :
    { kind: 'unavailable', message: 'This timeframe has not been supplied by your MT5 connector. Configure it in the connector to add it here.' };
  if ((config.strategy || 'scalp_ribbon') !== (stream.strategyId || 'scalp_ribbon')) return saved ? { kind: 'select', streamId: saved.streamId } :
    { kind: 'unavailable', message: 'This is a saved strategy view. Select Scalp Ribbon in Manage markets before scanning a new timeframe.' };
  if (!stream.symbolCode) return { kind: 'unavailable', message: 'This saved chart has no API symbol. Select a current Deriv market first.' };
  const included = config.scope === 'both' || (config.scope === 'watchlist' ? config.symbols.includes(stream.symbolCode) : market?.category === config.scope);
  if (!included) return saved ? { kind: 'select', streamId: saved.streamId } :
    { kind: 'unavailable', message: 'Add this market to your scanner selection in Manage markets before loading a new timeframe.' };
  return { kind: 'scan', symbolCode: stream.symbolCode, config: { ...config, timeframe: frame } };
}
