'use client';
import { STRATEGIES, resolveConfig } from '@/lib/deriv/types';
import type { DerivConfig, SessionSettings, StrategyId } from '@/lib/deriv/types';

export default function StrategySettings({ config, onChange }: { config: DerivConfig; onChange: (value: DerivConfig) => void }) {
  const draft = resolveConfig(config), session = draft.session;
  function updateSession(patch: Partial<SessionSettings>) { onChange({ ...draft, session: { ...session, ...patch } }); }
  function number(label: string, value: number, update: (value: number) => void, min: number, max: number, step = 1) {
    return <label>{label}<input type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={event => update(event.target.valueAsNumber)}/></label>;
  }
  return <section className="strategy-settings" aria-labelledby="strategy-settings-title">
    <div className="strategy-select-row"><div><p className="eyebrow">SIGNAL ENGINE</p><h3 id="strategy-settings-title">Choose your strategy</h3></div>
      <label>Active strategy<select value={draft.strategy} onChange={event => {
        const strategy = event.target.value as StrategyId;
        onChange({ ...draft, strategy, ...(strategy === 'session_fvg' ? { timeframe: 'M5', ...(session.mode === 'new_york' ? { scope: 'forex' as const } : {}) } : {}) });
      }}>{Object.entries(STRATEGIES).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}</select></label>
    </div>
    <p className="strategy-explanation">{STRATEGIES[draft.strategy].description} Settings apply when you save the scanner. Each strategy keeps its own signal history.</p>
    {draft.strategy === 'session_fvg' ? <>
      <div className="strategy-input-grid">
        <label>Session mode<select value={session.mode} onChange={event => {
          const ny = event.target.value === 'new_york';
          onChange({ ...draft, scope: ny ? 'forex' : draft.scope, session: { ...session, mode: ny ? 'new_york' : 'custom', timeZone: ny ? 'America/New_York' : 'UTC', startTime: ny ? '09:30' : '00:00' } });
        }}><option value="new_york">New York reference · forex</option><option value="custom">Custom session · forex / synthetics</option></select></label>
        <label>Session time<input type="time" step="300" value={session.startTime} disabled={session.mode === 'new_york'} onChange={event => updateSession({ startTime: event.target.value })}/></label>
        <label>Session timezone<input value={session.timeZone} disabled={session.mode === 'new_york'} onChange={event => updateSession({ timeZone: event.target.value })} placeholder="UTC or Africa/Johannesburg"/></label>
        <label>M15 reference range<select value={session.rangeMode} onChange={event => updateSession({ rangeMode: event.target.value as SessionSettings['rangeMode'] })}><option value="pre_session">15 minutes before the session</option><option value="opening">First 15 minutes after the session</option></select></label>
        {number('Trade window (minutes after range)', session.tradeWindowMinutes, value => updateSession({ tradeWindowMinutes: value }), 15, 240)}
        <label>FVG retest level<select value={session.retestLevel} onChange={event => updateSession({ retestLevel: event.target.value as SessionSettings['retestLevel'] })}><option value="edge">Near edge of the gap</option><option value="midpoint">Gap midpoint (50%)</option></select></label>
      </div>
      <p className="strategy-explanation">M5 confirmation candles · {session.mode === 'new_york' ? '09:30 New York time, Monday–Friday; daylight-saving changes are automatic. This is a reference time, not a forex market opening or a holiday calendar.' : 'Custom session timings are a separate strategy configuration; synthetic markets have no New York opening session.'}</p>
      <details className="strategy-advanced"><summary>FVG confirmation, stops and targets</summary><div className="strategy-input-grid">
        {number('ATR period', session.atrPeriod, value => updateSession({ atrPeriod: value }), 2, 100)}
        {number('Displacement body (× ATR)', session.displacementAtr, value => updateSession({ displacementAtr: value }), 0.1, 5, 0.1)}
        {number('Minimum gap (× ATR)', session.minGapAtr, value => updateSession({ minGapAtr: value }), 0, 2, 0.05)}
        {number('Retest expiry (M5 bars)', session.expiryBars, value => updateSession({ expiryBars: value }), 1, 48)}
        {number('Structure lookback (M5 bars)', session.swingLookback, value => updateSession({ swingLookback: value }), 3, 100)}
        {number('Stop buffer (× ATR)', session.stopBufferAtr, value => updateSession({ stopBufferAtr: value }), 0, 2, 0.05)}
        {number('Minimum stop buffer (ticks)', session.stopBufferTicks, value => updateSession({ stopBufferTicks: value }), 1, 100)}
        {number('Confirmed signals per session', session.maxSignalsPerSession, value => updateSession({ maxSignalsPerSession: value }), 1, 5)}
        {session.targets.map((value, index) => <div key={index}>{number(`Target ${index + 1} (R)`, value, next => updateSession({ targets: session.targets.map((target, n) => n === index ? next : target) }), 0.1, 20, 0.1)}</div>)}
      </div></details>
      <p className="strategy-explanation">A gap is a setup, not an entry. Confirmation requires a later M5 retest and rejection close. Entry is that close; targets use its actual distance to the frozen stop.</p>
    </> : <details className="strategy-advanced"><summary>EMA ribbon, ATR stop and targets</summary><div className="strategy-input-grid">
      {draft.settings.periods.map((value, index) => <div key={index}>{number(`EMA ${index + 1} period`, value, next => onChange({ ...draft, settings: { ...draft.settings, periods: draft.settings.periods.map((period, n) => n === index ? next : period) } }), 1, 500)}</div>)}
      {number('ATR period', draft.settings.atrPeriod, value => onChange({ ...draft, settings: { ...draft.settings, atrPeriod: value } }), 1, 500)}
      {number('Stop distance (× ATR)', draft.settings.atrMultiplier, value => onChange({ ...draft, settings: { ...draft.settings, atrMultiplier: value } }), 0.1, 20, 0.1)}
      {draft.settings.targets.map((value, index) => <div key={index}>{number(`Target ${index + 1} (R)`, value, next => onChange({ ...draft, settings: { ...draft.settings, targets: draft.settings.targets.map((target, n) => n === index ? next : target) } }), 0.1, 20, 0.1)}</div>)}
    </div><p className="strategy-explanation">Use five EMA periods in increasing order and three increasing target multiples.</p></details>}
  </section>;
}
