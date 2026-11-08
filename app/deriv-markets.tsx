'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Cloud, Download, Radio, Search } from 'lucide-react';
import { FRAMES, resolveConfig } from '@/lib/deriv/types';
import StrategySettings from './strategy-settings';
import type { DerivConfig, Market, ScannerStatus } from '@/lib/deriv/types';
type Props={config:DerivConfig;catalog:Market[];status:ScannerStatus;scannerMode:string;save:(config:DerivConfig)=>Promise<void>};
export default function DerivMarkets({config,catalog,status,scannerMode,save}:Props){
  const [draft,setDraft]=useState(resolveConfig(config)),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{setDraft(resolveConfig(config));},[JSON.stringify(config)]);
  const visible=catalog.filter(m=>(m.name+' '+m.code).toLowerCase().includes(query.toLowerCase()));
  const counts={synthetic_index:catalog.filter(m=>m.category==='synthetic_index').length,forex:catalog.filter(m=>m.category==='forex').length};
  async function apply(){setBusy(true);setError('');setSaved(false);try{await save(draft);setSaved(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function download(){setError('');try{const response=await fetch('/api/deriv/runner-config',{method:'POST'});if(!response.ok)throw new Error('Sign in to download cloud settings.');const link=document.createElement('a');link.href=URL.createObjectURL(await response.blob());link.download='scalp-runner.env';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}catch(e){setError((e as Error).message);}}
  const newYork=draft.strategy==='session_fvg'&&draft.session.mode==='new_york';
  const eligible=(m:Market)=>!(newYork&&m.category==='synthetic_index');
  const selected=(m:Market)=>eligible(m)&&(draft.scope==='both'||draft.scope===m.category||(draft.scope==='watchlist'&&draft.symbols.includes(m.code)));
  return <section className="panel deriv-panel">
    <div className="panel-header"><div><p className="eyebrow">DIRECT MARKET DATA</p><h2>Deriv markets, in one place.</h2><p className="panel-description">Discover available synthetic indices and forex pairs automatically.</p></div><span className="connector-icon"><Radio size={22}/></span></div>
    <div className="deriv-body">
      <div className="deriv-status" role="status"><span className={'status-dot '+(status.phase==='live'||scannerMode==='cloud'?'green':'amber')}/><div><strong>{scannerMode==='cloud'?'Cloud scanner':config.enabled?'App scanner':'Scanner paused'}</strong><p>{status.message}</p>{status.total>0&&<small>{status.loaded} of {status.total} chart histories ready · higher timeframes load next</small>}</div></div>
      <StrategySettings config={draft} onChange={next=>{setDraft(resolveConfig(next));setSaved(false);setError('');}}/>
      <div className="market-settings"><label>Markets<select value={draft.scope} onChange={e=>{setDraft({...draft,scope:e.target.value as DerivConfig['scope']});setSaved(false);}}><option value="both">{newYork?`All eligible forex (${counts.forex})`:`All synthetics + forex (${catalog.length})`}</option><option value="synthetic_index" disabled={newYork}>All synthetics ({counts.synthetic_index})</option><option value="forex">All forex ({counts.forex})</option><option value="watchlist">My watchlist ({draft.symbols.length})</option></select></label>
        <label>Chart timeframe<select value={draft.timeframe} disabled={draft.strategy==='session_fvg'} onChange={e=>{setDraft({...draft,timeframe:e.target.value});setSaved(false);}}>{Object.keys(FRAMES).map(frame=><option key={frame}>{frame}</option>)}</select></label>
        <label className="scanner-toggle"><input type="checkbox" checked={draft.enabled} onChange={e=>{setDraft({...draft,enabled:e.target.checked});setSaved(false);}}/>Enable scanner</label>
      </div>
      <div className="market-toolbar"><label className="search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name or symbol" aria-label="Search Deriv markets"/></label><span>{catalog.length} API markets discovered</span></div>
      <div className="market-list">{visible.length?visible.map(m=><label className={'market-option '+(selected(m)?'chosen':'')} key={m.code}><input type="checkbox" checked={selected(m)} disabled={!eligible(m)} onChange={()=>{
        const chosen=draft.scope==='watchlist'?draft.symbols:catalog.filter(selected).map(v=>v.code);
        setDraft({...draft,scope:'watchlist',symbols:chosen.includes(m.code)?chosen.filter(code=>code!==m.code):[...chosen,m.code]});setSaved(false);
      }}/><span><strong>{m.name}</strong><small>{m.code} · {m.category==='forex'?'Forex':'Synthetic'}{!eligible(m)?' · custom session required':''}</small></span><em>{m.suspended?'Suspended':m.open?'Open':'Closed'}</em></label>):<p className="panel-description">{catalog.length?'No matching markets.':'Connecting to Deriv to retrieve the current market list…'}</p>}</div>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="deriv-actions"><button className="button primary" disabled={busy} onClick={apply}>{busy?'Saving…':saved?<><Check size={14}/>Settings saved</>:'Save scanner settings'}</button><p>Direct mode needs no MT5 terminal, Python installation or broker password. Keep this app open for app scanning and notifications.</p></div>
      {Object.keys(status.errors).length>0&&<details className="scanner-errors"><summary>{Object.keys(status.errors).length} market or save issues</summary>{Object.entries(status.errors).map(([key,value])=><p key={key}><b>{key}</b> · {value}</p>)}</details>}
      <details className="cloud-setup"><summary><Cloud size={16}/> Scan while the app is closed</summary><p>The always-on cloud runner is prepared in your GitHub project. It needs a running Node.js service. Until that service is deployed, scanning runs only while this app stays open and active.</p><p>Deploy the <code>cloud-runner</code> service using the repository instructions. Download its private connection settings here and enter them as host secrets. Keep this file private.</p><div className="deriv-actions"><button className="button secondary" onClick={download}><Download size={14}/>Download private runner settings</button><a className="text-link" href="https://github.com/owenmosalagae/scalp_signal_desk/tree/main/cloud-runner" target="_blank" rel="noreferrer">Cloud runner instructions<ArrowUpRight size={13}/></a></div><p>Background phone notifications still require a separate push service. An online cloud runner records signals for your next visit.</p></details>
      <p className="deriv-footnote">Prices come from Deriv's public API. Its catalogue and candle prices can differ from MT5. Closed markets resume when their feed reopens. Levels use the API price precision. Scanning every market uses more mobile data than a small watchlist.</p>
    </div>
  </section>;
}
