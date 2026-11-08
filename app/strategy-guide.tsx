import { strategyName } from '@/lib/deriv/types';
import type { StrategyId } from '@/lib/deriv/types';

export default function StrategyGuide({ strategy, openSettings }: { strategy?: StrategyId; openSettings: () => void }) {
  const session = strategy === 'session_fvg';
  const rules = session ? [
    ['Complete the reference range', 'Use the selected 15-minute pre-session or opening range. All three M5 candles must be present and closed. The range then stays fixed for that session.'],
    ['Confirm a breakout', 'Wait for an M5 close beyond the range. The next three-candle fair value gap must form after that breakout. Its middle candle must displace in the breakout direction relative to the earlier, closed ATR.'],
    ['Wait for a retest and rejection', 'A later closed M5 candle must touch the selected gap level, then close beyond the gap and reference range in the setup direction. A stop breach, opposite breakout, missing candles or expiry invalidates the pending setup.'],
    ['Freeze the confirmed levels', 'The reference entry is the retest confirmation close, not a historical gap price that may never have filled. The stop is fixed beyond the setup’s known structure with an ATR/tick buffer. Targets are calculated from the confirmed entry-to-stop risk.'],
  ] : [
    ['Five exponential moving averages', 'The default periods are 8, 13, 21, 34 and 55. A fully ascending fast-to-slow price stack is bullish; the inverse is bearish. A mixed stack is neutral.'],
    ['Confirm a new alignment', 'A BUY or SELL confirms when a candle closes in a fully ordered stack after a different state. A return from neutral can confirm another setup in the same direction. Entry is that candle’s closing price.'],
    ['Lock the stop and targets', 'The default stop distance is 1.5 × Wilder ATR(14), rounded upward to the price tick. The default targets are 1.5R, 2R and 3R. Levels remain fixed at confirmation.'],
    ['Keep source context', 'Deriv API and MT5 can have different prices and history. Existing MT5 connector signals use Scalp Ribbon. The higher-timeframe EMA table supplies context; it does not add another entry filter.'],
  ];
  return <div className="strategy-layout"><section className="panel prose"><p className="eyebrow">{strategyName(strategy)} · RULES</p><h2>{session ? 'A session setup, confirmed in order.' : 'A trend stack, confirmed at the close.'}</h2>
    {rules.map(([title, text], index) => <div className="rule" key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}
  </section><section className="panel prose"><h2>Review signals by strategy</h2><p>Change the active scanner in Markets &amp; connection. One strategy scans at a time. Switching gives the strategy configuration its own stream; previous signals remain labelled in history.</p>
    <h3>What the records mean</h3><p>Only confirmed entries enter signal history and alerts. Pending, expired and invalidated FVGs appear on the chart and in session status. New records retain their strategy version and settings; older records may not contain archived settings.</p>
    <p>Entry and target levels are signal references, not proof of an executed trade or a profitable result. This version does not calculate win rates or resolve historical stop/target fills.</p>
    {session && <><h3>Session timing</h3><p>New York mode uses 09:30 America/New_York on weekdays, with seasonal clock changes. Custom mode has its own timezone and time and supports synthetic indices. Missing reference candles prevent a setup. Nonexistent daylight-saving clock times are skipped; repeated times use their first occurrence.</p><p>Session FVG uses the direct Deriv scanner and its shared cloud runtime. The MT5 connector remains the Scalp Ribbon source.</p></>}
    <button className="button secondary" onClick={openSettings}>Strategy settings ↗</button>
  </section></div>;
}
