"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Bell, Check, CheckCheck, ChevronRight, CircleHelp, Copy, Download, ExternalLink, History, Layers3, Link2, Radio, Search, Settings2, ShieldCheck, Volume2, X } from "lucide-react";
import type { DeskState, StoredSignal } from "@/lib/contracts";
import { example } from "@/lib/example";
import RibbonChart from "./chart";

type Tab = "monitor" | "signals" | "strategy" | "connect";
const money = (price: number, digits = 2) => price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const timestamp = (time: number) => new Date(time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function report(signal: StoredSignal) {
  return [signal.direction + " · " + signal.symbol + " · " + signal.timeframe,
    "Confirmed " + timestamp(signal.confirmedAt),
    "Entry " + money(signal.entry, signal.digits), "Stop loss " + money(signal.stop, signal.digits),
    ...signal.targets.map((price, i) => "TP" + (i + 1) + " " + money(price, signal.digits))].join("\n");
}

export default function Desk() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("monitor");
  const [data, setData] = useState<DeskState>({ streams: [], signals: [] });
  const [selectedStream, setSelectedStream] = useState("");
  const [manualExample, setManualExample] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [now, setNow] = useState(Date.now() / 1000);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
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
  const stream = shown.streams.find(value => value.streamId === selectedStream) || shown.streams[0];
  const signals = shown.signals.filter(signal => signal.streamId === stream.streamId);
  const latest = signals[0];
  const connected = !isExample && now - stream.receivedAt < 50;
  const quoteStale = connected && now - stream.quoteTime > Math.max(120, stream.timeframeSeconds * 3);
  const state = stream.trends[0]?.state || "Loading";
  const filtered = signals.filter(signal => (filter === "ALL" || signal.direction === filter) &&
    (signal.symbol + " " + signal.direction + " " + signal.timeframe).toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    setMounted(true);
    const controller = new AbortController();
    let alive = true;
    let running = false;
    async function poll() {
      if (running) return;
      running = true;
      try {
        const response = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
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
            if (recent) {
              setToast(signal.direction + " signal · " + signal.symbol + " · " + money(signal.entry, signal.digits));
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
    const rows = [["Direction","Symbol","Timeframe","Confirmed (UTC)","Entry","Stop","TP1","TP2","TP3"],
      ...filtered.map(s => [s.direction,s.symbol,s.timeframe,new Date(s.confirmedAt*1000).toISOString(),s.entry,s.stop,...s.targets])];
    const csv = rows.map(row => row.map(value => '"' + String(value).replaceAll('"','""') + '"').join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = isExample ? "example-signals.csv" : "scalp-signals.csv";
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500);
  }

  function SignalTable({ compact = false }: { compact?: boolean }) {
    const rows = compact ? filtered.slice(0, 5) : filtered;
    return <div className="table-scroll"><table className="signal-table"><thead><tr><th>Signal / market</th><th>Confirmed</th><th>Entry</th><th>Stop loss</th><th>Targets</th><th/></tr></thead>
      <tbody>{rows.length ? rows.map(signal => <tr key={signal.id} onClick={() => setSelectedSignal(signal)} tabIndex={0}
        onKeyDown={event => { if (event.key === "Enter") setSelectedSignal(signal); }}>
        <td><div className="market-cell"><span className={"direction-icon " + signal.direction.toLowerCase()}>{signal.direction === "SELL" ? <ArrowDownLeft size={17}/> : <ArrowUpRight size={17}/>}</span>
          <span><b>{signal.symbol}</b><small>{signal.timeframe} · <em className={signal.direction.toLowerCase()}>{signal.direction}</em>{isExample ? " · Example" : ""}</small></span></div></td>
        <td className="muted">{timestamp(signal.confirmedAt)}</td><td className="mono">{money(signal.entry, signal.digits)}</td>
        <td className="mono stop-text">{money(signal.stop, signal.digits)}</td><td className="mono target-text">{signal.targets.map(p => money(p, signal.digits)).join(" / ")}</td>
        <td><ChevronRight size={16}/></td>
      </tr>) : <tr><td colSpan={6} className="empty-row">No signals match this view. New confirmed setups will appear here.</td></tr>}</tbody></table></div>;
  }

  const tabs: { id: Tab; title: string; icon: typeof Activity }[] = [
    { id: "monitor", title: "Overview", icon: Activity }, { id: "signals", title: "Signal history", icon: History },
    { id: "strategy", title: "Strategy", icon: Layers3 }, { id: "connect", title: "MT5 connection", icon: Link2 },
  ];

  if (!mounted) return <main className="app-loading"><Activity size={26}/><p>Opening your signal desk…</p></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Scalp Signal Desk home"><span className="brand-mark"><Activity size={22}/></span><span>signal<span className="brand-light">desk</span><small>SCALP RIBBON</small></span></a>
      <div className="workspace"><div className="avatar">OM</div><span>Owen's workspace<small>Personal signal desk</small></span><ShieldCheck size={15}/></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{tabs.map(item => <button key={item.id} className={"nav-button " + (tab === item.id ? "active" : "")} onClick={() => setTab(item.id)}>
        <item.icon size={17}/><span>{item.title}</span>{item.id === "signals" && <span className="nav-count">{signals.length}</span>}
      </button>)}</nav>
      <div className="sidebar-bottom"><div className="connector-mini"><div><span className={"status-dot " + (connected ? "green" : "amber")}/><b>{connected ? "MT5 connected" : "Awaiting MT5"}</b></div><p>{connected ? stream.broker : "Connect your terminal to start receiving signals."}</p><button onClick={() => setTab("connect")}>{connected ? "Connection details" : "Set up connection"}<ArrowUpRight size={13}/></button></div>
        <button className="help-link" onClick={() => setTab("strategy")}><CircleHelp size={16}/> How signals work</button>
        <p className="sidebar-version">Scalp Ribbon · v1.0</p></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13}/> <b>{tabs.find(item => item.id === tab)?.title}</b></div>
        <div className="top-actions"><span className="private-tag"><ShieldCheck size={12}/> Private workspace</span><button className={"icon-button " + (alerts ? "enabled" : "")} onClick={enableAlerts} aria-label={alerts ? "Disable alerts" : "Enable alerts"}><Bell size={17}/>{alerts && <i/>}</button><div className="avatar small">OM</div></div>
      </header>
      <main className="content">
        <div className="page-heading"><div><p className="eyebrow">YOUR STRATEGY. EVERY CONFIRMED SETUP.</p><h1>{tab === "monitor" ? "Market overview" : tab === "signals" ? "Signal history" : tab === "strategy" ? "The ribbon strategy" : "Connect your MT5"}</h1>
          <p className="subtitle">{tab === "monitor" ? "Follow the ribbon. Get the levels. Stay in the loop." : tab === "signals" ? "A record of your confirmed setups and their original trade levels." : tab === "strategy" ? "The same rules used in your Scalp Ribbon MT5 indicator." : "Bring your broker's prices into your private signal desk."}</p></div>
          <div className="heading-actions">{tab !== "connect" && <button className="button secondary" onClick={enableAlerts}><Bell size={15}/>{alerts ? "Alerts on" : "Enable alerts"}</button>}<button className="button primary" onClick={() => setTab("connect")}><Link2 size={15}/>Connect MT5<ArrowUpRight size={14}/></button></div></div>

        {apiError && <div className="notice error" role="alert">{apiError} Showing the last available view.</div>}
        {isExample && tab !== "connect" && <div className="notice"><span className="example-tag">EXAMPLE</span><span>{loading ? "Checking your MT5 connection. " : ""}You're viewing example prices. Connect MT5 for your live signals.</span><button onClick={() => data.streams.length ? setManualExample(false) : setTab("connect")}>{data.streams.length ? "Return to live" : "Set up connection"}<ChevronRight size={13}/></button></div>}
        {!isExample && !connected && <div className="notice error"><Radio size={16}/><span>Your connector has stopped updating. Last received {timestamp(stream.receivedAt)}. Check MT5 and the connector window.</span></div>}

        {(tab === "monitor" || tab === "signals") && <>
          <div className="stream-bar"><div className="stream-select"><span className="gold-coin">Au</span><div><b>{stream.symbol}</b><small>{stream.timeframe} · {isExample ? "Example workspace" : stream.broker}</small></div>
            {!isExample && <select aria-label="Select monitored market" value={stream.streamId} onChange={event => setSelectedStream(event.target.value)}>{data.streams.map(s => <option key={s.streamId} value={s.streamId}>{s.symbol} · {s.timeframe}</option>)}</select>}</div>
            <div className="stream-status"><span className={"status-dot " + (connected ? "green" : "amber")}/>{isExample ? "MT5 disconnected" : connected ? quoteStale ? "Connected · quote stale" : "Receiving MT5 prices" : "Connection interrupted"}<span className="status-divider"/><span>{isExample ? "Confirmed candles" : "Connected markets · " + data.streams.filter(value => now - value.receivedAt < 50).length}</span></div>
          </div>
          <div className="stats-grid">
            <div className="stat"><span>Ribbon direction <Layers3 size={14}/></span><div className={state.toLowerCase()}><span className={"status-dot " + (state === "Bullish" ? "green" : state === "Bearish" ? "red" : "")}/>{state}</div><small>Latest closed {stream.timeframe} candle</small></div>
            <div className="stat"><span>Latest setup <Radio size={14}/></span><div>{latest ? <><b className={latest.direction.toLowerCase()}>{latest.direction}</b><span className="stat-suffix">{stream.symbol}</span></> : "Waiting"}</div><small>{latest ? timestamp(latest.confirmedAt) : "Waiting for a confirmed stack"}</small></div>
            <div className="stat"><span>Recent signals <History size={14}/></span><div>{signals.length}<span className="stat-suffix">recorded</span></div><small>{signals.filter(s => s.direction === "BUY").length} buy · {signals.filter(s => s.direction === "SELL").length} sell</small></div>
            <div className="stat"><span>Target structure <ArrowUpRight size={14}/></span><div>{stream.settings.targets.map((r, i) => <span key={r} className="r-value">{i > 0 && <i>/</i>}{r}R</span>)}</div><small>Fixed levels at confirmation</small></div>
          </div>
        </>}

        {tab === "monitor" && <>
          <div className="monitor-grid">
            <section className="panel chart-panel"><div className="panel-header"><div><h2>Price & ribbon</h2><span className="muted small-text">{stream.symbol} · {stream.timeframe}</span></div><div className="chart-controls"><button className={"tiny-button " + (sound ? "selected" : "")} onClick={toggleSound}><Volume2 size={13}/>{sound ? "Sound on" : "Sound off"}</button><span className="chart-frame">{stream.timeframe}</span></div></div>
              <RibbonChart stream={stream} signal={latest} example={isExample}/></section>
            <section className="panel trends-panel"><div className="panel-header"><h2>Trend alignment</h2><Layers3 size={15} className="muted"/></div><p className="panel-description">MA stack across timeframes</p>
              <div className="trend-head"><span>TIMEFRAME</span><span>MA STATE</span></div>{stream.trends.map((trend, index) => <div className="trend-row" key={index}><span>{trend.frame}{index === 0 && <small>chart</small>}</span><span className={"trend-pill " + trend.state.toLowerCase()}><i/>{trend.state}</span></div>)}
              <div className="trend-note"><CheckCheck size={13}/> Based on closed candles</div></section>
          </div>
          <div className="lower-grid">
            <section className="panel latest-panel"><div className="panel-header"><h2>Latest signal report</h2><span className="subtle-pill">{isExample ? "EXAMPLE" : latest ? "CONFIRMED" : "WAITING"}</span></div>
              {latest ? <><div className="report-heading"><span className={"signal-badge " + latest.direction.toLowerCase()}>{latest.direction === "SELL" ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>} {latest.direction}</span><div><strong>{latest.symbol} <span>{latest.timeframe}</span></strong><small>{timestamp(latest.confirmedAt)}</small></div><button className="icon-button" onClick={() => copy(latest)} aria-label="Copy latest signal"><Copy size={15}/></button></div>
                <div className="levels-grid"><div><span>Entry</span><b>{money(latest.entry, latest.digits)}</b></div><div><span>Stop loss</span><b className="stop-text">{money(latest.stop, latest.digits)}</b></div>{latest.targets.map((price, i) => <div key={i}><span>Take profit {i + 1}</span><b className="target-text">{money(price, latest.digits)}</b></div>)}</div>
                <div className="report-footer"><ShieldCheck size={13}/><span>Levels locked at candle close</span><button onClick={() => setSelectedSignal(latest)}>View report<ArrowUpRight size={12}/></button></div></> : <p className="panel-description roomy">The next confirmed BUY or SELL will appear here with its entry, stop and targets.</p>}
            </section>
            <section className="panel alerts-card"><div className="alerts-art"><Bell size={23}/><span className="pulse-ring"/></div><h2>Your next setup, reported.</h2><p>Get an alert with the entry, stop loss and all three targets when a new signal confirms.</p><button className="text-link" onClick={enableAlerts}>{alerts ? "Notifications enabled" : "Turn on notifications"}<ArrowUpRight size={14}/></button><small>Keep this app open for alerts. MT5 and the connector must be running.</small></section>
          </div>
        </>}

        {(tab === "monitor" || tab === "signals") && <section className="panel history-panel"><div className="panel-header"><div><h2>{tab === "monitor" ? "Recent signals" : "All recorded setups"}</h2><span className="muted small-text">Confirmed setups from your selected market</span></div><button className="button subtle" onClick={exportSignals}><Download size={14}/>Export CSV</button></div>
          {tab === "signals" && <div className="filters"><div className="segments">{["ALL","BUY","SELL"].map(value => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "ALL" ? "All signals" : value}</button>)}</div><label className="search"><Search size={14}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search signals" aria-label="Search signals"/></label></div>}
          <SignalTable compact={tab === "monitor"}/>{tab === "monitor" && <button className="history-link" onClick={() => setTab("signals")}>View signal history<ChevronRight size={13}/></button>}
        </section>}

        {tab === "strategy" && <div className="strategy-layout"><section className="panel prose"><p className="eyebrow">SCALP RIBBON · RECONSTRUCTED RULES</p><h2>A trend stack, confirmed at the close.</h2><p>This app follows the indicator we built from your screenshot. The screenshot did not reveal the original source. These are the reconstructed rules used by both versions.</p>
          <div className="rule"><span>01</span><div><h3>Five exponential moving averages</h3><p>The default EMA periods are 8, 13, 21, 34 and 55. The ribbon turns green when each faster EMA is above the next slower EMA. The inverse alignment turns it red. Mixed alignment is neutral.</p></div></div>
          <div className="rule"><span>02</span><div><h3>Confirm a new alignment</h3><p>A BUY or SELL confirms when a candle closes in a fully ordered stack after a different state. A return from neutral can confirm another setup in the same direction. The entry is that candle's closing price.</p></div></div>
          <div className="rule"><span>03</span><div><h3>Lock the stop and targets</h3><p>The default risk distance is 1.5 × Wilder ATR(14), rounded upward to the broker's tick size. Targets sit 1.5R, 2R and 3R from entry. The setup keeps its original levels.</p></div></div>
          <div className="rule"><span>04</span><div><h3>Report the confirmed setup</h3><p>The connector sends updates about every 10 seconds. The app records each setup once and reports its symbol, timeframe, direction, timestamp and trade levels. The trend table is context and does not add a confirmation filter.</p></div></div></section>
          <section className="panel prose"><h2>Match your MT5 settings</h2><p>Use the same broker, symbol, timeframe, EMA periods and ATR settings in the app connector and indicator. The connector starts with your terminal's available chart history, following the same EMA seed.</p><p>Settings live in the connector's settings.json file. Restart the connector after editing them.</p><p>The 45-minute row is synthesized from MT5 15-minute candles. Every table row uses closed candles.</p><button className="button secondary" onClick={() => setTab("connect")}>Set up MT5<ArrowUpRight size={14}/></button></section></div>}

        {tab === "connect" && <div className="connection-grid"><section className="panel prose connection-steps"><div className="connection-title"><span className="connector-icon"><Link2 size={24}/></span><div><h2>Your MT5, connected.</h2><p>One saved watchlist. One connector on your Windows computer.</p></div></div>
          <div className="setup-step"><span>1</span><div><h3>Open your desktop MT5 terminal</h3><p>Sign in to your broker account. Choose the markets available in that terminal and let their chart history load.</p></div></div>
          <div className="setup-step"><span>2</span><div><h3>Download the Windows connector</h3><p>Extract the complete ZIP. If needed, install 64-bit Python 3.12 or later. The connector uses MetaQuotes' official Python integration.</p><a className="button primary" href="/Scalp_MT5_Connector.zip" download><Download size={15}/>Download connector</a><a className="text-link python-link" href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">Get Python<ExternalLink size={12}/></a></div></div>
          <div className="setup-step"><span>3</span><div><h3>Save your watchlist and pair once</h3><p>Double-click <code>start_windows.bat</code>. Enter up to 20 exact Market Watch names separated by commas, such as <code>Step Index, Volatility 75 Index</code>, then choose a timeframe. Choose whether Windows should remember pairing, then approve it in your browser. Later starts reuse your saved setup.</p></div></div>
          <div className="setup-step"><span>4</span><div><h3>Open your app</h3><p>Keep the connector running and select a market from the overview dropdown. Use <code>configure_windows.bat</code> to change your watchlist. Optional <code>enable_startup.bat</code> starts the connector minimized when you sign in to Windows. Use <code>disable_startup.bat</code> to turn that off. Enable app alerts and keep the app open for notifications.</p><button className="button secondary" onClick={() => { setManualExample(false); setTab("monitor"); }}>Open overview<ArrowUpRight size={14}/></button></div></div>
        </section><div><section className="panel prose"><div className="section-icon"><ShieldCheck size={20}/></div><h2>Your private connection</h2><p>Broker credentials stay inside MT5. If you choose to remember pairing, the app connection key is encrypted with Windows Data Protection for your Windows account. Use forget_pairing.bat to remove the saved key for future starts.</p><p>The connector reads candle and quote data. It reports setups without placing trades.</p></section><section className="panel prose connection-status-card"><p className="eyebrow">CONNECTION STATUS</p><h2><span className={"status-dot " + (connected ? "green" : "amber")}/>{connected ? "Terminal connected" : "Waiting for your terminal"}</h2><p>{connected ? stream.symbol + " · " + stream.timeframe + " · " + stream.broker : "Your overview uses clearly labelled example data until the first MT5 update arrives."}</p>{!isExample && <p>Last heartbeat {timestamp(stream.receivedAt)}<br/>Last quote {timestamp(stream.quoteTime)}</p>}<button className="text-link" onClick={() => { setManualExample(true); setTab("monitor"); }}>Explore the example<ArrowUpRight size={14}/></button></section></div></div>}

        <footer className="page-footer"><span><span className="status-dot green"/>Scalp Ribbon engine <span className="footer-separator">/</span> EMA + ATR</span><span>{isExample ? "Example view · connect MT5 for live data" : "Updates every ~10s · times shown in your device timezone"}</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button className="icon-button" onClick={() => setToast("")} aria-label="Dismiss notification"><X size={15}/></button></div>}
    {selectedSignal && <div className="modal-backdrop" onClick={() => setSelectedSignal(null)}><section ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="report-title" className="signal-modal" onClick={event => event.stopPropagation()}><div className="panel-header"><h2 id="report-title">{isExample ? "Example signal report" : "Confirmed signal report"}</h2><button className="icon-button" onClick={() => setSelectedSignal(null)} aria-label="Close report"><X size={18}/></button></div><pre>{report(selectedSignal)}</pre><p className="muted small-text">Original levels from the confirmed candle.</p><button className="button primary" onClick={() => copy(selectedSignal)}><Copy size={14}/>Copy report</button></section></div>}
  </div>;
}
