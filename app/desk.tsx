"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Bell, Check, CheckCheck, ChevronRight, CircleHelp, Copy, Download, ExternalLink, History, Layers3, Link2, Radio, Search, Settings2, ShieldCheck, Volume2, X } from "lucide-react";
import type { DeskState, StoredSignal } from "@/lib/contracts";
import { example } from "@/lib/example";
import RibbonChart from "./chart";
import DerivMarkets from "./deriv-markets";
import { useDerivScanner } from "./use-deriv";
import { FRAMES, strategyName } from "@/lib/deriv/types";
import { timeframeAction } from "@/lib/deriv/chart-navigation";
import { strategyStreamSeed } from "@/lib/deriv/engine";
import { sha256 } from "@/lib/deriv/strategy";
import StrategyGuide from "./strategy-guide";
import MarketPicker from "./market-picker";

type Tab = "monitor" | "signals" | "strategy" | "connect";
const money = (price: number, digits = 2) => price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const timestamp = (time: number) => new Date(time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function report(signal: StoredSignal) {
  return [signal.direction + " · " + signal.symbol + " · " + signal.timeframe,
    "Strategy " + strategyName(signal.strategyId) + " · v" + (signal.strategyVersion || "1"),
    "Confirmed " + timestamp(signal.confirmedAt),
    ...(signal.reason ? ["Confirmation " + signal.reason] : []),
    ...(signal.sessionId ? ["Session " + signal.sessionId] : []),
    ...(signal.sessionSettings ? ["Saved session settings " + JSON.stringify(signal.sessionSettings)] : signal.settings ? ["Saved settings " + JSON.stringify(signal.settings)] : ["Original settings were not archived for this legacy signal."]),
    "Source " + (signal.source || "MT5") + (signal.broker ? " · " + signal.broker : ""),
    "Entry " + money(signal.entry, signal.digits), "Stop loss " + money(signal.stop, signal.digits),
    ...signal.targets.map((price, i) => "TP" + (i + 1) + " " + money(price, signal.digits))].join("\n");
}

export default function Desk() {
  const deriv = useDerivScanner();
  const selectedRef = useRef("");
  const activeStrategyRef = useRef(deriv.config.strategy || "scalp_ribbon");
  activeStrategyRef.current = deriv.config.strategy || "scalp_ribbon";
  const tabRef = useRef<Tab>("monitor");
  const [historyAll, setHistoryAll] = useState(true);
  const [historyLimit, setHistoryLimit] = useState(100);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("monitor");
  const [data, setData] = useState<DeskState>({ streams: [], signals: [] });
  const [selectedStream, setSelectedStream] = useState("");
  const [manualExample, setManualExample] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [timeframeSaving, setTimeframeSaving] = useState(false);
  const [timeframeError, setTimeframeError] = useState("");
  const [requestedChart, setRequestedChart] = useState<DeskState['streams'][number] | null>(null);
  const timeframeRequest = useRef(0);
  const [now, setNow] = useState(Date.now() / 1000);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [historyStrategy, setHistoryStrategy] = useState("all");
  const [selectedSignal, setSelectedSignal] = useState<StoredSignal | null>(null);
  const [toast, setToast] = useState("");
  const [alerts, setAlerts] = useState(false);
  const [sound, setSound] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const modal = useRef<HTMLDivElement | null>(null);
  const alertsRef = useRef(false);
  const soundRef = useRef(false);

  const isExample = manualExample || data.streams.length === 0;
  const shown = isExample ? example : data;
  const savedStream = shown.streams.find(value => value.streamId === selectedStream) || shown.streams.find(value => (value.strategyId || "scalp_ribbon") === (deriv.config.strategy || "scalp_ribbon")) || shown.streams[0];
  const requestedStream = requestedChart && shown.streams.find(value => value.streamId === requestedChart.streamId);
  const stream = requestedChart ? requestedStream || requestedChart : savedStream;
  const timeframeLoading = !!requestedChart && !requestedStream?.candles.length;
  const sessionStrategy = stream.strategyId === "session_fvg";
  const sessionContext = stream.sessionContext;
  const signals = shown.signals.filter(signal => signal.streamId === stream.streamId);
  const latest = signals[0];
  selectedRef.current = stream.streamId;
  tabRef.current = tab;
  const direct = stream.source === "Deriv API";
  const timeframeOptions = Object.keys(FRAMES).map(frame => ({ frame, action: timeframeAction(stream, data.streams, deriv.config, frame, deriv.catalog.find(market => market.code === stream.symbolCode)) }));
  const canScanTimeframe = timeframeOptions.some(option => option.action.kind === 'scan');
  const connected = !isExample && now - stream.receivedAt < (direct ? 100 : 50);
  const quoteStale = connected && now - stream.quoteTime > Math.max(120, stream.timeframeSeconds * 3);
  const state = stream.trends[0]?.state || "Loading";
  const filtered = (tab === "signals" && historyAll ? shown.signals : signals).filter(signal => (filter === "ALL" || signal.direction === filter) && (tab !== "signals" || historyStrategy === "all" || (signal.strategyId || "scalp_ribbon") === historyStrategy) &&
    (signal.symbol + " " + signal.direction + " " + signal.timeframe + " " + strategyName(signal.strategyId)).toLowerCase().includes(search.toLowerCase()));

  useEffect(() => { setSelectedStream(""); setRequestedChart(null); setTimeframeError(""); timeframeRequest.current++; }, [deriv.config.strategy, manualExample]);
  useEffect(() => {
    if (requestedChart && requestedStream?.candles.length) { setSelectedStream(requestedChart.streamId); setRequestedChart(null); }
  }, [requestedChart, requestedStream]);

  function selectStream(id: string) {
    timeframeRequest.current++; setRequestedChart(null); setTimeframeError(""); setSelectedStream(id);
  }
  async function changeTimeframe(frame: string) {
    if (timeframeSaving || frame === stream.timeframe) return;
    const action = timeframeAction(stream, data.streams, deriv.config, frame, deriv.catalog.find(market => market.code === stream.symbolCode));
    setTimeframeError("");
    if (action.kind === 'unavailable') { setTimeframeError(action.message); return; }
    if (action.kind === 'select') { selectStream(action.streamId); return; }
    const request = ++timeframeRequest.current;
    setTimeframeSaving(true);
    const previous = stream;
    try {
      const streamId = await sha256(strategyStreamSeed(action.symbolCode, action.config));
      if (request !== timeframeRequest.current) return;
      setRequestedChart({ ...stream, streamId, timeframe: frame, timeframeSeconds: FRAMES[frame], settings: action.config.settings,
        candles: [], signals: [], receivedAt: 0, quoteTime: 0, trends: stream.trends.map((trend, index) => ({ frame: index ? trend.frame : frame + ' (chart)', state: 'Loading' })) });
      await deriv.save(action.config);
      if (request !== timeframeRequest.current) return;
      setSelectedStream(streamId);
    } catch (error) {
      if (request === timeframeRequest.current) { setRequestedChart(null); setSelectedStream(previous.streamId); setTimeframeError((error as Error).message || 'Could not change timeframe. Try again.'); }
    } finally { setTimeframeSaving(false); }
  }

  useEffect(() => {
    setMounted(true);
    const controller = new AbortController();
    let alive = true;
    let running = false;
    async function poll() {
      if (running) return;
      running = true;
      try {
        const response = await fetch("/api/state?stream=" + encodeURIComponent(selectedRef.current) + (tabRef.current === "signals" ? "&all=1" : ""), { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("The signal desk is temporarily unavailable.");
        const next = await response.json() as DeskState;
        if (!alive) return;
        if (known.current === null) known.current = new Set(next.signals.map(signal => signal.id));
        else {
          for (const signal of next.signals) {
            if (known.current.has(signal.id)) continue;
            known.current.add(signal.id);
            const source = next.streams.find(value => value.streamId === signal.streamId);
            const recent = Date.now() / 1000 - signal.confirmedAt < Math.max(120, (source?.timeframeSeconds || 300) * 2);
            if (recent && !signal.backfilled) {
              setToast(signal.direction + " · " + strategyName(signal.strategyId) + " · " + signal.symbol + " · " + money(signal.entry, signal.digits));
              if (alertsRef.current && "serviceWorker" in navigator) {
                navigator.serviceWorker.ready.then(registration => registration.showNotification(
                  signal.direction + " · " + signal.symbol + " " + signal.timeframe,
                  { body: report(signal), tag: signal.id, icon: "/icon.svg" }
                )).catch(() => {});
              }
              if (soundRef.current && audio.current) {
                const context = audio.current;
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.frequency.value = signal.direction === "BUY" ? 740 : 520;
                gain.gain.setValueAtTime(.06, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .35);
                oscillator.connect(gain); gain.connect(context.destination);
                oscillator.start(); oscillator.stop(context.currentTime + .35);
              }
            }
          }
        }
        setData(next);
        setSelectedStream(current => current || next.streams.find(value => (value.strategyId || "scalp_ribbon") === activeStrategyRef.current)?.streamId || "");
        setApiError("");
      } catch (error) {
        if (alive && !controller.signal.aborted) setApiError((error as Error).message || "Connection interrupted.");
      } finally { if (alive) setLoading(false); running = false; }
    }
    poll();
    const interval = setInterval(() => { setNow(Date.now() / 1000); poll(); }, 5000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { alive = false; clearInterval(interval); controller.abort(); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!selectedSignal) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedSignal(null);
      if (event.key === "Tab") {
        const controls = modal.current?.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0']");
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [selectedSignal]);

  async function enableAlerts() {
    if (alerts) { setAlerts(false); alertsRef.current = false; return; }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setToast("Browser notifications are unavailable. Signals still appear in the app.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") { setAlerts(true); alertsRef.current = true; setToast("Alerts enabled while this app is open."); }
    else setToast("Allow notifications in your browser settings to enable alerts.");
  }
  function toggleSound() {
    const enabled = !sound;
    setSound(enabled); soundRef.current = enabled;
    if (enabled) {
      audio.current = audio.current || new AudioContext();
      audio.current.resume().catch(() => {});
    }
  }
  async function copy(signal: StoredSignal) {
    try { await navigator.clipboard.writeText(report(signal)); setToast("Signal report copied."); }
    catch { setToast("Select the signal report text to copy it."); }
  }
  function exportSignals() {
    const rows = [["Direction","Symbol","Timeframe","Source","Strategy","Version","Session","Confirmed (UTC)","Entry","Stop","TP1","TP2","TP3","Reason","Archived settings"],
      ...filtered.map(s => [s.direction,s.symbol,s.timeframe,s.source || "MT5",strategyName(s.strategyId),s.strategyVersion || "1",s.sessionId || "",new Date(s.confirmedAt*1000).toISOString(),s.entry,s.stop,...s.targets,s.reason || "",JSON.stringify(s.sessionSettings || s.settings || null)])];
    const csv = rows.map(row => row.map(value => '"' + String(value).replaceAll('"','""') + '"').join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = isExample ? "example-signals.csv" : "scalp-signals.csv";
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500);
  }

  function SignalTable({ compact = false }: { compact?: boolean }) {
    const rows = compact ? filtered.slice(0, 5) : filtered.slice(0, historyLimit);
    return <div className="table-scroll"><table className="signal-table"><thead><tr><th>Signal / market</th><th>Confirmed</th><th>Entry</th><th>Stop loss</th><th>Targets</th><th/></tr></thead>
      <tbody>{rows.length ? rows.map(signal => <tr key={signal.id} onClick={() => setSelectedSignal(signal)} tabIndex={0}
        onKeyDown={event => { if (event.key === "Enter") setSelectedSignal(signal); }}>
        <td><div className="market-cell"><span className={"direction-icon " + signal.direction.toLowerCase()}>{signal.direction === "SELL" ? <ArrowDownLeft size={17}/> : <ArrowUpRight size={17}/>}</span>
          <span><b>{signal.symbol}</b><small>{signal.timeframe} · <em className={signal.direction.toLowerCase()}>{signal.direction}</em>{isExample ? " · Example" : " · " + (signal.source || "MT5")} · {strategyName(signal.strategyId)}</small></span></div></td>
        <td className="muted">{timestamp(signal.confirmedAt)}</td><td className="mono">{money(signal.entry, signal.digits)}</td>
        <td className="mono stop-text">{money(signal.stop, signal.digits)}</td><td className="mono target-text">{signal.targets.map(p => money(p, signal.digits)).join(" / ")}</td>
        <td><ChevronRight size={16}/></td>
      </tr>) : <tr><td colSpan={6} className="empty-row">No signals match this view. New confirmed setups will appear here.</td></tr>}</tbody></table></div>;
  }

  const tabs: { id: Tab; title: string; icon: typeof Activity }[] = [
    { id: "monitor", title: "Overview", icon: Activity }, { id: "signals", title: "Signal history", icon: History },
    { id: "strategy", title: "Strategy", icon: Layers3 }, { id: "connect", title: "Markets & connection", icon: Link2 },
  ];

  if (!mounted) return <main className="app-loading"><Activity size={26}/><p>Opening your signal desk…</p></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Scalp Signal Desk home"><span className="brand-mark"><Activity size={22}/></span><span>signal<span className="brand-light">desk</span><small>STRATEGY DESK</small></span></a>
      <div className="workspace"><div className="avatar">OM</div><span>Owen's workspace<small>Personal signal desk</small></span><ShieldCheck size={15}/></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{tabs.map(item => <button key={item.id} className={"nav-button " + (tab === item.id ? "active" : "")} onClick={() => setTab(item.id)}>
        <item.icon size={17}/><span>{item.title}</span>{item.id === "signals" && <span className="nav-count">{signals.length}</span>}
      </button>)}</nav>
      <div className="sidebar-bottom"><div className="connector-mini"><div><span className={"status-dot " + (connected ? "green" : "amber")}/><b>{connected ? direct ? "Deriv API connected" : "MT5 connected" : "Scanner status"}</b></div><p>{connected ? stream.broker : deriv.status.message}</p><button onClick={() => setTab("connect")}>{connected ? "Connection details" : "Set up connection"}<ArrowUpRight size={13}/></button></div>
        <button className="help-link" onClick={() => setTab("strategy")}><CircleHelp size={16}/> How signals work</button>
        <p className="sidebar-version">Two strategies · confirmed candles</p></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13}/> <b>{tabs.find(item => item.id === tab)?.title}</b></div>
        <div className="top-actions"><span className="private-tag"><ShieldCheck size={12}/> Private workspace</span><button className={"icon-button " + (alerts ? "enabled" : "")} onClick={enableAlerts} aria-label={alerts ? "Disable alerts" : "Enable alerts"}><Bell size={17}/>{alerts && <i/>}</button><div className="avatar small">OM</div></div>
      </header>
      <main className="content">
        <div className="page-heading"><div><p className="eyebrow">YOUR STRATEGY. EVERY CONFIRMED SETUP.</p><h1>{tab === "monitor" ? "Market overview" : tab === "signals" ? "Signal history" : tab === "strategy" ? strategyName(deriv.config.strategy) : "Your markets"}</h1>
          <p className="subtitle">{tab === "monitor" ? "Follow your selected strategy and its confirmed trade levels." : tab === "signals" ? "A record of your confirmed setups and their original trade levels." : tab === "strategy" ? "Read the confirmation, invalidation and price-source rules for your active scanner." : "Choose your markets and scan directly with Deriv."}</p></div>
          <div className="heading-actions">{tab !== "connect" && <button className="button secondary" onClick={enableAlerts}><Bell size={15}/>{alerts ? "Alerts on" : "Enable alerts"}</button>}<button className="button primary" onClick={() => setTab("connect")}><Link2 size={15}/>Manage markets<ArrowUpRight size={14}/></button></div></div>

        {apiError && <div className="notice error" role="alert">{apiError} Showing the last available view.</div>}
        {isExample && tab !== "connect" && <div className="notice"><span className="example-tag">EXAMPLE</span><span>{loading ? "Checking your live feeds. " : ""}You're viewing example prices until a live market is ready. Deriv candle histories load automatically.</span><button onClick={() => data.streams.length ? setManualExample(false) : setTab("connect")}>{data.streams.length ? "Return to live" : "Set up connection"}<ChevronRight size={13}/></button></div>}
        {!isExample && !connected && <div className="notice error"><Radio size={16}/><span>This market has stopped updating. Last received {timestamp(stream.receivedAt)}. {direct ? "Open Markets & connection to check the Deriv scanner." : "Check MT5 and the connector window."}</span></div>}

        {(tab === "monitor" || tab === "signals") && <>
          <div className="stream-bar"><div className="stream-select"><span className="gold-coin">Au</span><div><b>{stream.symbol}</b><small>{stream.timeframe} · {isExample ? "Example workspace" : stream.broker}</small></div>
          </div>
            <div className="stream-status"><span className={"status-dot " + (connected ? "green" : "amber")}/>{timeframeLoading ? "Loading " + stream.timeframe + " candles" : isExample ? "Loading live markets" : connected ? direct && stream.marketOpen === false ? "Market closed" : quoteStale ? "Connected · waiting for quote" : direct ? "Receiving Deriv API prices" : "Receiving MT5 prices" : "Connection interrupted"}<span className="status-divider"/><span>{isExample ? "Confirmed candles" : "Connected markets · " + data.streams.filter(value => now - value.receivedAt < (value.source === "Deriv API" ? 100 : 50)).length}</span></div>
          </div>
          {!isExample && <MarketPicker streams={data.streams} current={stream} catalog={deriv.catalog} busy={timeframeSaving} onSelect={selectStream}/>}
          <div className="stats-grid">
            <div className="stat"><span>{sessionStrategy ? "Session bias" : "Ribbon direction"} <Layers3 size={14}/></span><div className={state.toLowerCase()}><span className={"status-dot " + (state === "Bullish" ? "green" : state === "Bearish" ? "red" : "")}/>{state}</div><small>Latest closed {stream.timeframe} candle</small></div>
            <div className="stat"><span>Latest setup <Radio size={14}/></span><div>{latest ? <><b className={latest.direction.toLowerCase()}>{latest.direction}</b><span className="stat-suffix">{stream.symbol}</span></> : "Waiting"}</div><small>{latest ? timestamp(latest.confirmedAt) : sessionStrategy ? "Waiting for a confirmed retest" : "Waiting for a confirmed stack"}</small></div>
            <div className="stat"><span>Recent signals <History size={14}/></span><div>{signals.length}<span className="stat-suffix">recorded</span></div><small>{signals.filter(s => s.direction === "BUY").length} buy · {signals.filter(s => s.direction === "SELL").length} sell</small></div>
            <div className="stat"><span>Target structure <ArrowUpRight size={14}/></span><div>{stream.settings.targets.map((r, i) => <span key={r} className="r-value">{i > 0 && <i>/</i>}{r}R</span>)}</div><small>Fixed levels at confirmation</small></div>
          </div>
        </>}

        {tab === "monitor" && <>
          <div className="active-strategy-bar"><span>Viewing <b>{strategyName(stream.strategyId)}</b> · v{stream.strategyVersion || "1"}{isExample ? " · illustrative data" : ""}</span><button onClick={() => setTab("connect")}>Change scanner strategy ↗</button></div>
          {sessionStrategy && sessionContext && <section className="panel session-status" aria-label="Session setup status"><div><p className="eyebrow">{sessionContext.phase.replaceAll("_", " ")}</p><h2>{sessionContext.message}</h2></div>
            {sessionContext.range && <p>Range {money(sessionContext.range.low, stream.digits)}–{money(sessionContext.range.high, stream.digits)} · {new Date(sessionContext.range.start * 1000).toLocaleString([], { timeZone: stream.sessionSettings?.timeZone })} · {stream.sessionSettings?.timeZone}</p>}
            {sessionContext.setup && <p>{sessionContext.setup.direction} gap {money(sessionContext.setup.gapLow, stream.digits)}–{money(sessionContext.setup.gapHigh, stream.digits)} · retest level {money(sessionContext.setup.retestPrice, stream.digits)} · {sessionContext.setup.status.replaceAll("_", " ")} · expires {timestamp(sessionContext.setup.expiresAt)}</p>}
          </section>}
          <div className="monitor-grid">
            <section className="panel chart-panel"><div className="panel-header"><div><h2>{sessionStrategy ? "Price, range & FVG" : "Price & ribbon"}</h2><span className="muted small-text">{stream.symbol} · {stream.timeframe}</span></div><div className="chart-controls"><button className={"tiny-button " + (sound ? "selected" : "")} onClick={toggleSound}><Volume2 size={13}/>{sound ? "Sound on" : "Sound off"}</button><label className="chart-timeframe"><span>Timeframe</span><select className="chart-frame" aria-label="Chart timeframe" aria-describedby="chart-timeframe-help" value={stream.timeframe} disabled={timeframeSaving || isExample || sessionStrategy || !deriv.configReady} onChange={event => void changeTimeframe(event.target.value)}>{!Object.hasOwn(FRAMES, stream.timeframe) && <option value={stream.timeframe}>{stream.timeframe}</option>}{timeframeOptions.map(({ frame, action }) => <option key={frame} value={frame} disabled={!isExample && action.kind === 'unavailable'}>{frame}</option>)}</select></label></div></div>
              <p id="chart-timeframe-help" className="chart-timeframe-help">{sessionStrategy ? 'Session Range + FVG uses M5 confirmation. Choose Scalp Ribbon in Manage markets for other timeframes.' : isExample ? 'Choose a live market to change its timeframe.' : direct ? canScanTimeframe ? 'Changing timeframe updates the scanner for all selected Deriv markets.' : 'Saved chart view. Available timeframes use recorded data; manage markets to scan a new timeframe.' : 'Available timeframes come from this market’s MT5 connector.'}</p>
              {timeframeError && <p className="chart-timeframe-message error" role="alert">{timeframeError}</p>}
              {(timeframeSaving || timeframeLoading) ? <div className="chart-loading" role="status" aria-live="polite"><span className="loading-ring"/><strong>{timeframeSaving ? 'Saving timeframe…' : `Loading ${stream.symbol} · ${stream.timeframe}…`}</strong><p>{!deriv.config.enabled ? 'The scanner is paused. Enable it in Manage markets to load new candles.' : deriv.status.phase === 'error' ? deriv.status.message : 'Waiting for candles from the scanner. You can choose another timeframe while it loads.'}</p></div> : <RibbonChart stream={stream} signal={latest} example={isExample}/>}</section>
            <section className="panel trends-panel"><div className="panel-header"><h2>Trend alignment</h2><Layers3 size={15} className="muted"/></div><p className="panel-description">{sessionStrategy ? "Session bias first; higher EMA rows are context only" : "MA stack across timeframes"}</p>
              <div className="trend-head"><span>TIMEFRAME</span><span>MA STATE</span></div>{stream.trends.map((trend, index) => <div className="trend-row" key={index}><span>{trend.frame}{index === 0 && <small>chart</small>}</span><span className={"trend-pill " + trend.state.toLowerCase()}><i/>{trend.state}</span></div>)}
              <div className="trend-note"><CheckCheck size={13}/> Based on closed candles</div></section>
          </div>
          <div className="lower-grid">
            <section className="panel latest-panel"><div className="panel-header"><h2>Latest signal report</h2><span className="subtle-pill">{isExample ? "EXAMPLE" : latest ? "CONFIRMED" : "WAITING"}</span></div>
              {latest ? <><div className="report-heading"><span className={"signal-badge " + latest.direction.toLowerCase()}>{latest.direction === "SELL" ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>} {latest.direction}</span><div><strong>{latest.symbol} <span>{latest.timeframe}</span></strong><small>{timestamp(latest.confirmedAt)}</small></div><button className="icon-button" onClick={() => copy(latest)} aria-label="Copy latest signal"><Copy size={15}/></button></div>
                <div className="levels-grid"><div><span>Entry</span><b>{money(latest.entry, latest.digits)}</b></div><div><span>Stop loss</span><b className="stop-text">{money(latest.stop, latest.digits)}</b></div>{latest.targets.map((price, i) => <div key={i}><span>Take profit {i + 1}</span><b className="target-text">{money(price, latest.digits)}</b></div>)}</div>
                <div className="report-footer"><ShieldCheck size={13}/><span>Levels locked at candle close</span><button onClick={() => setSelectedSignal(latest)}>View report<ArrowUpRight size={12}/></button></div></> : <p className="panel-description roomy">The next confirmed BUY or SELL will appear here with its entry, stop and targets.</p>}
            </section>
            <section className="panel alerts-card"><div className="alerts-art"><Bell size={23}/><span className="pulse-ring"/></div><h2>Your next setup, reported.</h2><p>Get an alert with the entry, stop loss and all three targets when a new signal confirms.</p><button className="text-link" onClick={enableAlerts}>{alerts ? "Notifications enabled" : "Turn on notifications"}<ArrowUpRight size={14}/></button><small>Keep this app open for alerts. {direct || isExample ? "Deriv app scanning pauses when your browser suspends the app." : "MT5 and the connector must be running."}</small></section>
          </div>
        </>}

        {(tab === "monitor" || tab === "signals") && <section className="panel history-panel"><div className="panel-header"><div><h2>{tab === "monitor" ? "Recent signals" : "All recorded setups"}</h2><span className="muted small-text">{tab === "signals" && historyAll ? "Confirmed setups across your markets" : "Confirmed setups from your selected market"}</span></div><button className="button subtle" onClick={exportSignals}><Download size={14}/>Export CSV</button></div>
          {tab === "signals" && <div className="filters"><select aria-label="Signal strategy filter" value={historyStrategy} onChange={event => setHistoryStrategy(event.target.value)}><option value="all">All strategies</option><option value="scalp_ribbon">Scalp Ribbon</option><option value="session_fvg">Session Range + FVG</option></select><select aria-label="Signal market filter" className="history-market" value={historyAll ? "all" : "selected"} onChange={e=>setHistoryAll(e.target.value==="all")}><option value="all">All markets</option><option value="selected">Selected market</option></select><div className="segments">{["ALL","BUY","SELL"].map(value => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "ALL" ? "All signals" : value}</button>)}</div><label className="search"><Search size={14}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search signals" aria-label="Search signals"/></label></div>}
          <SignalTable compact={tab === "monitor"}/>{tab === "signals" && filtered.length > historyLimit && <button className="history-link" onClick={() => setHistoryLimit(value => value + 100)}>Show more signals ({historyLimit} of {filtered.length})<ChevronRight size={13}/></button>}{tab === "monitor" && <button className="history-link" onClick={() => setTab("signals")}>View signal history<ChevronRight size={13}/></button>}
        </section>}

        {tab === "strategy" && <StrategyGuide strategy={deriv.config.strategy} openSettings={() => setTab("connect")}/>}

        {tab === "connect" && <><DerivMarkets {...deriv}/><details className="mt5-alternative"><summary>Use the MT5 connector instead</summary><div className="connection-grid"><section className="panel prose connection-steps"><div className="connection-title"><span className="connector-icon"><Link2 size={24}/></span><div><h2>Your MT5, connected.</h2><p>One saved watchlist. One connector on your Windows computer.</p></div></div>
          <div className="setup-step"><span>1</span><div><h3>Open your desktop MT5 terminal</h3><p>Sign in to your broker account. Choose the markets available in that terminal and let their chart history load.</p></div></div>
          <div className="setup-step"><span>2</span><div><h3>Download the Windows connector</h3><p>Extract the complete ZIP. If needed, install 64-bit Python 3.12 or later. The connector uses MetaQuotes' official Python integration.</p><a className="button primary" href="/Scalp_MT5_Connector.zip" download><Download size={15}/>Download connector</a><a className="text-link python-link" href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">Get Python<ExternalLink size={12}/></a></div></div>
          <div className="setup-step"><span>3</span><div><h3>Save your watchlist and pair once</h3><p>Double-click <code>start_windows.bat</code>. Enter up to 20 exact Market Watch names separated by commas, such as <code>Step Index, Volatility 75 Index</code>, then choose a timeframe. Choose whether Windows should remember pairing, then approve it in your browser. Later starts reuse your saved setup.</p></div></div>
          <div className="setup-step"><span>4</span><div><h3>Open your app</h3><p>Keep the connector running and select a market from the overview dropdown. Use <code>configure_windows.bat</code> to change your watchlist. Optional <code>enable_startup.bat</code> starts the connector minimized when you sign in to Windows. Use <code>disable_startup.bat</code> to turn that off. Enable app alerts and keep the app open for notifications.</p><button className="button secondary" onClick={() => { setManualExample(false); setTab("monitor"); }}>Open overview<ArrowUpRight size={14}/></button></div></div>
        </section><div><section className="panel prose"><div className="section-icon"><ShieldCheck size={20}/></div><h2>Your private connection</h2><p>Broker credentials stay inside MT5. If you choose to remember pairing, the app connection key is encrypted with Windows Data Protection for your Windows account. Use forget_pairing.bat to remove the saved key for future starts.</p><p>The connector reads candle and quote data. It reports setups without placing trades.</p></section><section className="panel prose connection-status-card"><p className="eyebrow">CONNECTION STATUS</p><h2><span className={"status-dot " + (connected ? "green" : "amber")}/>{connected ? "Terminal connected" : "Waiting for your terminal"}</h2><p>{connected ? stream.symbol + " · " + stream.timeframe + " · " + stream.broker : "Your overview uses clearly labelled example data until the first MT5 update arrives."}</p>{!isExample && <p>Last heartbeat {timestamp(stream.receivedAt)}<br/>Last quote {timestamp(stream.quoteTime)}</p>}<button className="text-link" onClick={() => { setManualExample(true); setTab("monitor"); }}>Explore the example<ArrowUpRight size={14}/></button></section></div></div></details></>}

        <footer className="page-footer"><span><span className="status-dot green"/>{strategyName(stream.strategyId)} <span className="footer-separator">/</span> {sessionStrategy ? "Range + displacement + retest" : "EMA + ATR"}</span><span>{isExample ? "Example view · live markets are loading" : "Times shown in your device timezone · source labelled per market"}</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button className="icon-button" onClick={() => setToast("")} aria-label="Dismiss notification"><X size={15}/></button></div>}
    {selectedSignal && <div className="modal-backdrop" onClick={() => setSelectedSignal(null)}><section ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="report-title" className="signal-modal" onClick={event => event.stopPropagation()}><div className="panel-header"><h2 id="report-title">{isExample ? "Example signal report" : "Confirmed signal report"}</h2><button className="icon-button" onClick={() => setSelectedSignal(null)} aria-label="Close report"><X size={18}/></button></div><pre>{report(selectedSignal)}</pre><p className="muted small-text">Original levels from the confirmed candle.</p><button className="button primary" onClick={() => copy(selectedSignal)}><Copy size={14}/>Copy report</button></section></div>}
  </div>;
}
