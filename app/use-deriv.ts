'use client';
import { useEffect, useRef, useState } from 'react';
import { DerivClient } from '@/lib/deriv/client';
import { DerivEngine } from '@/lib/deriv/engine';
import { DEFAULT_CONFIG, resolveConfig } from '@/lib/deriv/types';
import type { DerivConfig, Market, ScannerStatus } from '@/lib/deriv/types';
export function useDerivScanner(){
  const [config,setConfig]=useState<DerivConfig>(DEFAULT_CONFIG);
  const [catalog,setCatalog]=useState<Market[]>([]);
  const [status,setStatus]=useState<ScannerStatus>({phase:'connecting',message:'Checking the Deriv scanner…',loaded:0,total:0,errors:{}});
  const [scannerMode,setScannerMode]=useState('');
  const [revision,setRevision]=useState(0);
  const engineRef=useRef<DerivEngine|null>(null);
  const backendSupportsStrategies=useRef(false);
  useEffect(()=>{
    let alive=true,running=false,engine:DerivEngine|null=null,signature='';
    const owner=crypto.randomUUID?.() || '00000000-0000-4000-8000-000000000000';
    const discovery=new DerivClient();
    async function discover(){try{await discovery.connect();const markets=await discovery.markets();if(alive)setCatalog(markets);}catch(error){if(alive)setStatus(s=>({...s,message:(error as Error).message}));}finally{discovery.close();}}
    void discover();
    async function lease(action:string){const response=await fetch('/api/deriv/lease',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner,mode:'browser',action}),keepalive:action==='release'});return response.ok;}
    async function tick(){
      if(running||!alive)return;running=true;
      try{
        const response=await fetch('/api/deriv/config',{cache:'no-store'});if(!response.ok)throw new Error('Cannot load Deriv settings.');
        const next=await response.json() as {config:DerivConfig;scanner:{mode:string}|null;capabilities?:{strategySwitching?:number}};if(!alive)return;
        backendSupportsStrategies.current=next.capabilities?.strategySwitching===1;
        next.config=resolveConfig(next.config);
        if(next.config.strategy==='session_fvg'&&!backendSupportsStrategies.current)throw new Error('The backend needs the strategy-switching update before Session FVG can run.');
        setConfig(next.config);setScannerMode(next.scanner?.mode||'');
        const key=JSON.stringify(next.config);
        if(engine&&(key!==signature||!next.config.enabled)){engine.stop();engine=null;engineRef.current=null;await lease('release');}
        if(!crypto.subtle){setStatus({phase:'idle',message:'Direct scanning requires HTTPS. Open your published signal desk to scan.',loaded:0,total:0,errors:{}});return;}
        if(!next.config.enabled){setStatus({phase:'paused',message:'Deriv scanning is paused.',loaded:0,total:0,errors:{}});return;}
        if(engine){if(!await lease('heartbeat')){engine.stop();engine=null;engineRef.current=null;setStatus(s=>({...s,phase:'waiting',message:'Reconnecting the scanner…'}));}return;}
        if(!await lease('acquire')){setStatus({phase:'waiting',message:next.scanner?.mode==='cloud'?'Cloud scanner is running. This app receives its saved signals.':'Another app window is scanning. This window receives its signals.',loaded:0,total:0,errors:{}});return;}
        if(!alive){await lease('release');return;}
        signature=key;setScannerMode('browser');
        engine=new DerivEngine(next.config,owner,'browser',{
          catalog:markets=>{if(alive)setCatalog(markets);},status:state=>{if(alive)setStatus(state);},
          snapshot:async snapshot=>{
            if(!alive)throw new Error('Scanner stopped.');
            const result=await fetch('/api/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
            if(!result.ok)throw new Error(result.status===409?'Scanner ownership changed. Reconnecting…':'Cannot save signals. Retrying…');
          },
        });engineRef.current=engine;void engine.run();
      }catch(error){if(alive)setStatus(s=>({...s,phase:'error',message:(error as Error).message}));}
      finally{running=false;}
    }
    void tick();const interval=setInterval(()=>void tick(),20000);
    return()=>{alive=false;clearInterval(interval);discovery.close();engine?.stop();engineRef.current=null;void lease('release').catch(()=>{});};
  },[revision]);
  async function save(next:DerivConfig){
    if(next.strategy==='session_fvg'&&!backendSupportsStrategies.current)throw new Error('Update the private backend with strategy switching before selecting Session FVG.');
    const response=await fetch('/api/deriv/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
    if(!response.ok){const result=await response.json() as {error?:string};throw new Error(result.error||'Could not save scanner settings.');}
    const saved=await response.json() as {config?:DerivConfig;capabilities?:{strategySwitching?:number}};
    if(next.strategy==='session_fvg'&&(saved.capabilities?.strategySwitching!==1||saved.config?.strategy!=='session_fvg'))throw new Error('The backend did not retain the selected strategy. Update it before scanning.');
    setConfig(resolveConfig(saved.config||next));setRevision(v=>v+1);
  }
  return {config,catalog,status,scannerMode,save};
}
