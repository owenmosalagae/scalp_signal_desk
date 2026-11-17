'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bot, Download, Pause, Play, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { DEFAULT_RISK, type Risk, type RobotView } from '@/lib/robot-contract';

const labels: Record<keyof Risk, string> = { riskPercent: 'Risk per trade (%)', dailyLossPercent: 'Daily loss limit (%)', maxOpenRiskPercent: 'Total open risk (%)', maxPositions: 'Maximum positions' };
const limits = { riskPercent: 1, dailyLossPercent: 5, maxOpenRiskPercent: 3, maxPositions: 10 };
export default function RobotPanel() {
  const [view, setView] = useState<RobotView | null>(null);
  const [risk, setRisk] = useState<Risk>(DEFAULT_RISK);
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'demo' | 'real'>('demo');
  const [confirmReal, setConfirmReal] = useState(false);
  const [realAccountLogin, setRealAccountLogin] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [switchHelp, setSwitchHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now()/1000);
  const accept = useCallback((next: RobotView) => setView(old => old && (next.revision < old.revision || next.heartbeatAt < old.heartbeatAt) ? old : next), []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/robot/control', { cache: 'no-store', signal: signal ?? AbortSignal.timeout(8000) });
    const data = await response.json().catch(() => { throw new Error('Robot controls are unavailable. Please retry.'); }) as RobotView & { error?: string };
    if (!response.ok) throw new Error(data.error || 'Robot connection is unavailable.');
    accept(data); setError('');
  }, [accept]);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => { void refresh(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])).catch(e => { if (!controller.signal.aborted) setError(e.message); }); };
    load(); const poll = setInterval(load, 5000), clock = setInterval(() => setNow(Date.now()/1000), 1000);
    return () => { controller.abort(); clearInterval(poll); clearInterval(clock); };
  }, [refresh]);
  const report = view?.report;
  const accountMode = report?.accountMode ?? 'demo';
  const isReal = accountMode === 'real';
  const runnerSession = report?.runnerId ?? '';
  useEffect(() => {
    setConfirmReal(false); setRealAccountLogin(''); setSymbols(view?.savedProfile?.symbols.filter(s => report?.symbols.includes(s)) ?? null);
    setMode(accountMode);
    setRisk(view?.savedProfile?.risk ?? (view?.accountKey === report?.accountKey && view?.accountMode === accountMode ? view.risk : DEFAULT_RISK));
    // A runner/account change clears confirmation and resets any unsaved form changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerSession, accountMode, report?.accountKey]);
  const online = !!view?.online && now - view.heartbeatAt < 45 && !error;
  const bound = report && report.runnerId === view?.runnerId && report.accountKey === view.accountKey;
  const acknowledged = bound && accountMode === view?.accountMode && report.revision === view?.revision;
  const active = online && view?.enabled && acknowledged && report.running;
  const markets = symbols ?? (view?.runnerId === report?.runnerId && view?.accountKey === report?.accountKey && view?.symbols.length ? view.symbols : report?.symbols ?? []);
  const title = !online ? 'Runner offline' : active ? 'Automatic trading active' : view?.enabled && bound ? (acknowledged ? 'Entries blocked' : 'Start requested') : report?.running ? 'Pause requested' : 'New entries paused';
  const canStart = online && markets.length > 0 && mode === accountMode &&
    (!isReal || ((report?.protocolVersion ?? 1) >= 2 && confirmReal && realAccountLogin === report?.login));
  useEffect(() => { if (acknowledged && message && !message.startsWith('Setup saved')) setMessage(''); }, [acknowledged, message]);
  async function command(enabled: boolean, saveOnly = false) {
    if (!view) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/robot/control', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, saveOnly, revision: view.revision, ...((enabled || saveOnly) ? { runnerId: report?.runnerId, accountKey: report?.accountKey, accountMode: mode, ...(isReal ? { confirmReal, realAccountLogin } : {}), risk, symbols: markets } : {}) }),
        signal: AbortSignal.timeout(8000) });
      const data = await response.json().catch(() => { throw new Error('Robot controls are unavailable. Please retry.'); }) as RobotView & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Command was not accepted.');
      accept(data); setMessage(saveOnly ? 'Setup saved for this account. Trading permission is unchanged; use Start / apply limits to apply it.' : enabled ? 'Start requested. Waiting for the runner to apply these settings.' : 'Pause requested. The runner blocks new entries on its next control check.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Command failed. Refresh to verify its status.'); }
    finally { setBusy(false); }
  }
  const number = (n?: number) => n?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—';
  return <div className={"robot-panel " + (isReal ? "robot-real" : "")}>
    <section className="panel robot-hero">
      <div className="robot-steps" aria-label="Robot setup progress"><span className={online ? 'complete' : ''}>1 · Connect MT5</span><span className={online ? 'complete' : ''}>2 · Review account & limits</span><span className={active ? 'complete' : ''}>3 · Start trading</span></div>
      <div className="robot-heading"><span className="robot-icon"><Bot size={25}/></span><div><p className="eyebrow">MT5 · SCALP RIBBON · {isReal ? 'REAL ACCOUNT · REAL MONEY' : 'DEMO ACCOUNT'}</p><h2>{title}</h2><p className="muted">Your phone controls the robot. Your Windows runner executes the trades.</p></div><span className={'robot-pill ' + (active ? 'active' : '')}>{active ? 'RUNNING' : online ? 'CONNECTED' : 'OFFLINE'}</span></div>
      <div className="robot-mode-row"><div><span className="muted small-text">Detected account</span><p><b>{report ? (isReal ? 'Real money' : 'Demo') : 'Waiting for MT5'}</b>{report ? ` · ${report.login} · ${report.server}` : ''}</p></div><button className="button secondary" onClick={() => setSwitchHelp(value => !value)}>Switch account</button></div>
      {switchHelp && <section className="robot-switch-help"><h3>Switch demo / real in three steps</h3><ol><li>Pause new entries here, wait for the runner to report paused, then stop its window with Ctrl+C. Open positions stay open.</li><li>Sign in to the other account in MT5.</li><li>Double-click <b>start_trading.bat</b>, verify the detected account and press Enter. Its saved markets and limits return; trading stays paused until you press Start.</li></ol><button className="button robot-pause" disabled={busy || !view} onClick={() => command(false)}><Pause size={15}/>Pause for switching</button></section>}
      {isReal && <div className="robot-real-confirm"><strong>Real money is at risk</strong><p>Start permits automatic real-money orders on account {report?.login} at {report?.server}. Stop-loss and daily limits cannot guarantee a maximum loss.</p><label><input type="checkbox" checked={confirmReal} onChange={e => setConfirmReal(e.target.checked)}/>I understand and want automatic real-money trading on this account.</label><label>Type the connected MT5 account number<input type="text" inputMode="numeric" autoComplete="off" value={realAccountLogin} onChange={e => setRealAccountLogin(e.target.value)} aria-label="Confirm real MT5 account number"/></label></div>}
      <div className="robot-actions"><a className="button secondary" href="/Scalp_MT5_Connector.zip?version=easy-start" download><Download size={16}/>Download runner</a><button className="button secondary" disabled={busy || !online || !markets.length || mode !== accountMode} onClick={() => command(false, true)}>Save setup</button><button className="button primary" disabled={busy || !canStart} onClick={() => command(true)}><Play size={16}/>{isReal ? 'Start real trading / apply limits' : 'Start / apply limits'}</button><button className="button robot-pause" disabled={busy || !view} onClick={() => command(false)}><Pause size={16}/>Pause new entries</button><button className="button secondary" disabled={busy} onClick={() => { void refresh().catch(e => setError(e.message)); }} aria-label="Refresh robot status"><RefreshCw size={16}/></button></div>
      <p className="robot-help">Pausing does not close open positions. A submitted order may still complete. Existing broker stop-loss and take-profit orders stay in place.</p>
      {message && <p role="status" className="robot-message">{message}</p>}{error && <p role="alert" className="robot-error">{error} Refresh to verify the command state.</p>}
      {!online && <div className="robot-quickstart"><h3>One launcher for demo and real</h3><p>Download and extract the runner. Open your account in MT5, then double-click <b>start_trading.bat</b>. It detects the account and connects paused. Broker passwords stay in MT5.</p></div>}
      {online && <p className="robot-help">Runner: {report?.status} · Last report {Math.max(0, Math.floor(now - (view?.heartbeatAt ?? now)))}s ago</p>}
    </section>
    <div className="robot-grid">
      <section className="panel robot-section"><div className="panel-header"><h2>Connected {isReal ? 'real' : 'demo'} account</h2><ShieldCheck size={17}/></div>{report ? <><div className="robot-account"><b>{report.server}</b><span>Account {report.login} · {report.currency} · {isReal ? 'REAL MONEY' : 'Demo'}</span></div><div className="robot-metrics"><div><small>Balance</small><strong>{number(report.balance)}</strong></div><div><small>Equity</small><strong>{number(report.equity)}</strong></div><div><small>Positions</small><strong>{report.positions.length}</strong></div></div><p className="robot-help">{online ? 'Paired Windows runner connected.' : 'Last reported values. This runner is offline.'} {view?.savedProfile ? 'Your saved limits and markets were restored for this account.' : 'Your limits and markets will be saved for this account when you choose Save setup or Start.'} Restarting always requires a fresh Start command.</p></> : <div className="robot-empty"><Smartphone size={27}/><h3>Connect your MT5 runner</h3><p>Open your chosen account in MT5, then run <b>start_trading.bat</b>. Press Enter to reuse saved markets or S to change them. Pair once, then return here. Trading starts paused.</p></div>}</section>
      <section className="panel robot-section"><div className="panel-header"><h2>Risk limits</h2><span className="muted small-text">Applied with Start</span></div><div className="robot-risk">{(Object.keys(labels) as (keyof Risk)[]).map(key => <label key={key}>{labels[key]}<input type="number" min={key === 'maxPositions' ? 1 : .01} max={limits[key]} step={key === 'maxPositions' ? 1 : .01} value={risk[key]} onChange={e => setRisk(old => ({ ...old, [key]: Number(e.target.value) }))}/></label>)}</div><p className="robot-help">Daily loss uses equity first observed that UTC day and blocks new entries once reached. Limits include account positions. Slippage and gaps can exceed estimated risk.</p></section>
    </div>
    <section className="panel robot-section"><div className="panel-header"><h2>Markets to trade</h2><span className="muted small-text">{report?.timeframe ?? 'MT5'} · Scalp Ribbon</span></div>{report ? <div className="robot-markets">{report.symbols.map(symbol => <label key={symbol}><input type="checkbox" checked={markets.includes(symbol)} onChange={e => setSymbols(e.target.checked ? [...markets, symbol] : markets.filter(s => s !== symbol))}/>{symbol}</label>)}</div> : <p className="muted">Your runner's saved MT5 watchlist will appear here.</p>}<p className="robot-help">Choose from markets monitored by your runner. Browser Deriv and Session FVG signals are not executed.</p></section>
    <section className="panel robot-section"><div className="panel-header"><h2>Open account positions</h2><span className="muted small-text">{online ? 'Latest runner report' : 'Last reported snapshot'}</span></div>{report?.positions.length ? <div className="table-scroll"><table><thead><tr><th>Market</th><th>Side / lots</th><th>Profit ({report.currency})</th><th>Stop / target</th></tr></thead><tbody>{report.positions.map(p => <tr key={p.ticket}><td>{p.symbol}</td><td>{p.side} · {p.volume}</td><td>{number(p.profit)}</td><td>{p.stop} / {p.target}</td></tr>)}</tbody></table></div> : <p className="muted">{report ? 'No positions in the latest report.' : 'Connect a runner to view positions.'}</p>}</section>
    <section className="panel robot-section"><div className="panel-header"><h2>Execution activity</h2><span className="muted small-text">Latest 20 attempts</span></div>{report?.events.length ? <div className="robot-events">{report.events.map(event => <details key={event.id}><summary><b>{event.status}</b><time>{new Date(event.time*1000).toLocaleString()}</time><span>{event.id.slice(0,12)}…</span></summary><pre>{event.detail}</pre></details>)}</div> : <p className="muted">Fills, skipped signals and halt reasons will appear here.</p>}</section>
    <details className="panel robot-section robot-setup"><summary>Keep trading when your PC is off</summary><p>Install MT5, Python and the connector on an always-on Windows cloud server. Sign in to the intended account in MT5, enable Python trading, run start_trading.bat, and complete app pairing on that server. You can then operate these controls from your phone.</p><p>A cloud server has not been provisioned. Without a running Windows runner, this page cannot place trades. If the app connection fails, the robot blocks new entries; broker exits remain in place.</p></details>
  </div>;
}
