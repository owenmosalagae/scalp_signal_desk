import type { DeskState } from '../contracts';
import type { DerivConfig, Market } from './types';

type Stream = DeskState['streams'][number];
type Health = { kind: string; label: string; tone: 'green' | 'amber' | 'red' | 'muted'; notice?: string; detail: string };
type Input = { stream: Stream; now: number; config?: DerivConfig; scanner?: DeskState['scanner']; market?: Market; phase?: string; example?: boolean; loadingFrame?: boolean; offline?: boolean; deskError?: string };
const ageText = (age: number) => age < 60 ? `${Math.floor(age)}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`;
export function matchesScanner(stream: Stream, config: DerivConfig, market?: Market) {
  if ((stream.strategyId || 'scalp_ribbon') !== (config.strategy || 'scalp_ribbon') || stream.timeframe !== config.timeframe) return false;
  if (config.scope === 'watchlist' && !config.symbols.includes(stream.symbolCode || '')) return false;
  if (market && !['both', 'watchlist', market.category].includes(config.scope)) return false;
  return stream.strategyId === 'session_fvg'
    ? JSON.stringify(stream.sessionSettings) === JSON.stringify(config.session)
    : JSON.stringify(stream.settings) === JSON.stringify(config.settings);
}
export function feedHealth({ stream, now, config, scanner, market, phase, example, loadingFrame, offline, deskError }: Input): Health {
  const direct = stream.source === 'Deriv API';
  const age = Math.max(0, now - stream.receivedAt);
  const detail = stream.receivedAt > 0 ? 'Last saved market update ' + ageText(age) + '.' : 'Waiting for the first saved market update.';
  if (example) return { kind: 'example', label: 'Example prices', tone: 'muted', detail: 'This is illustrative data.' };
  if (offline) return { kind: 'offline', label: 'You are offline', tone: 'red', notice: 'Your browser is offline. Saved prices remain visible; updates resume when the connection returns.', detail };
  if (loadingFrame) return { kind: 'loading', label: 'Loading ' + stream.timeframe + ' candles', tone: 'amber', detail: 'The requested chart is loading.' };
  if (deskError) return { kind: 'reconnecting', label: 'Reconnecting to signal desk', tone: 'amber', detail };
  if (direct && config && !matchesScanner(stream, config, market)) return { kind: 'saved', label: 'Saved chart · ' + stream.timeframe, tone: 'muted', notice: `This is a saved chart. The scanner currently uses ${config.timeframe} with ${config.strategy === 'session_fvg' ? 'Session Range + FVG' : 'Scalp Ribbon'}. Choose an active market/timeframe or change scanner settings for new updates.`, detail };
  if (direct && config && !config.enabled) return { kind: 'paused', label: 'Scanner paused', tone: 'amber', notice: 'Scanning is paused in Manage markets. Saved prices remain available.', detail };
  if (direct && (market?.open ?? stream.marketOpen) === false) return { kind: 'closed', label: 'Market closed', tone: 'muted', detail: 'Waiting for the market to reopen. ' + detail };
  if (direct && phase === 'retrying') return { kind: 'reconnecting', label: 'Reconnecting to Deriv', tone: 'amber', notice: 'The price feed is reconnecting automatically. The chart shows its last saved prices.', detail };
  if (age < (direct ? 100 : 50)) {
    if (now - stream.quoteTime > Math.max(120, stream.timeframeSeconds * 3)) return { kind: 'quote_wait', label: 'Waiting for market quote', tone: 'amber', detail };
    return { kind: 'live', label: direct ? 'Deriv updates current' : 'MT5 updates current', tone: 'green', detail };
  }
  if (!direct) return { kind: 'stale', label: 'Waiting for MT5 connector', tone: 'amber', notice: 'No recent MT5 update has arrived. Check that MT5 and its connector are running. ' + detail, detail };
  if (['connecting', 'loading', 'trends'].includes(phase || '')) return { kind: 'loading', label: 'Refreshing scanner histories', tone: 'amber', notice: 'Market histories are loading. Saved charts will refresh as each market becomes ready.', detail };
  if (scanner && scanner.expiresAt > now && now - scanner.heartbeatAt < 90) return { kind: 'delayed', label: 'Market updates delayed', tone: 'amber', notice: 'The scanner heartbeat is active, but this market has not saved a recent update. The app is checking again automatically. ' + detail, detail };
  return { kind: 'waiting', label: 'Waiting for scanner updates', tone: 'amber', notice: 'No recent scanner update is available. Keep a scanner window open; the app will retry automatically. ' + detail, detail };
}
