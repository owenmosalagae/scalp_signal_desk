import type { DeskState } from '../contracts';
import type { Market, StrategyId } from './types';

type Stream = DeskState['streams'][number];
export type MarketChoice = { stream: Stream; group: string };
const strategyOf = (stream: Stream): StrategyId => stream.strategyId || 'scalp_ribbon';
export function marketIdentity(stream: Stream) {
  return JSON.stringify([stream.source || 'MT5', stream.broker, stream.symbolCode || stream.symbol]);
}

// Prefer the current chart timeframe, then the most recently received stream.
// Keep separate brokers/sources and never relabel a stream's strategy.
export function groupMarkets(streams: Stream[], current: Stream, catalog: Market[]) {
  const result: Record<StrategyId, MarketChoice[]> = { scalp_ribbon: [], session_fvg: [] };
  const unique = new Map<string, Stream>();
  for (const candidate of [...streams, current]) {
    const key = strategyOf(candidate) + ':' + marketIdentity(candidate), previous = unique.get(key);
    if (previous?.streamId === current.streamId) continue;
    if (!previous || candidate.streamId === current.streamId ||
      (candidate.timeframe === current.timeframe && previous.timeframe !== current.timeframe) ||
      ((candidate.timeframe === current.timeframe) === (previous.timeframe === current.timeframe) && candidate.receivedAt > previous.receivedAt)) unique.set(key, candidate);
  }
  const categories = new Map(catalog.map(market => [market.code, market.category]));
  for (const stream of unique.values()) {
    const category = stream.symbolCode && categories.get(stream.symbolCode);
    const group = stream.source !== 'Deriv API' ? 'MT5 · ' + stream.broker :
      category === 'forex' ? 'Forex · Deriv API' : category === 'synthetic_index' ? 'Synthetic indices · Deriv API' : 'Deriv API';
    result[strategyOf(stream)].push({ stream, group });
  }
  for (const choices of Object.values(result)) choices.sort((a, b) => a.group.localeCompare(b.group) || a.stream.symbol.localeCompare(b.stream.symbol, undefined, { numeric: true }));
  return result;
}
