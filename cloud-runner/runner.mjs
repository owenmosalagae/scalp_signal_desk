import { DerivEngine } from './runtime/engine.js';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export async function runCloudRunner({site=process.env.SCALP_SITE_URL,token=process.env.SCALP_SITE_TOKEN,signal}={}){
  if(!site||!token)throw new Error('Set SCALP_SITE_URL and SCALP_SITE_TOKEN using the private settings download.');
  const url=new URL(site);
  if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('The signal desk must use HTTPS.');
  const origin=url.origin,owner=randomUUID();
  let engine=null,signature='',lastLog=0;
  async function request(path,body){
    const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'OAI-Sites-Authorization':'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000),redirect:'error'});
    if(response.status===401||response.status===403)throw new Error('Private desk access was rejected. Download fresh runner settings from the signed-in app.');
    return response;
  }
  async function lease(action){return (await request('/api/deriv/lease',{owner,mode:'cloud',action})).ok;}
  function stop(){engine?.stop();engine=null;}
  const onAbort=()=>stop();signal?.addEventListener('abort',onAbort,{once:true});
  console.log('Deriv cloud runner started. Waiting for scanner ownership.');
  try{
    while(!signal?.aborted){
      try{
        const response=await request('/api/deriv/config');if(!response.ok)throw new Error('The signal desk is temporarily unavailable.');
        const {config}=await response.json(),key=JSON.stringify(config);
        if(engine&&(key!==signature||!config.enabled)){stop();await lease('release');}
        if(!config.enabled){if(Date.now()-lastLog>60000){console.log('Scanner paused in the app.');lastLog=Date.now();}}
        else if(engine){if(!await lease('heartbeat')){stop();console.log('Scanner ownership changed. Waiting to reconnect.');}}
        else if(await lease('acquire')){
          signature=key;
          engine=new DerivEngine(config,owner,'cloud',{
            catalog:markets=>console.log('Discovered '+markets.length+' synthetic and forex API markets.'),
            status:status=>{if(Date.now()-lastLog>60000||status.phase==='retrying'){console.log(status.phase+': '+status.loaded+'/'+status.total+' markets. '+status.message);lastLog=Date.now();}},
            snapshot:async snapshot=>{const result=await request('/api/ingest',snapshot);if(!result.ok)throw new Error('Signal save failed ('+result.status+'). Retrying.');},
          });void engine.run();console.log('Cloud scanner acquired the desk. Settings are controlled from Markets & connection.');
        }else if(Date.now()-lastLog>60000){console.log('Another scanner is active. Close the app scanner to allow cloud takeover.');lastLog=Date.now();}
      }catch(error){stop();console.error(error.message);}
      await new Promise(resolve=>{if(signal?.aborted)return resolve();const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,20000);signal?.addEventListener('abort',done,{once:true});});
    }
  }finally{stop();signal?.removeEventListener('abort',onAbort);try{await lease('release');}catch{}console.log('Cloud scanner stopped.');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const controller=new AbortController();for(const name of ['SIGTERM','SIGINT'])process.on(name,()=>controller.abort());
  runCloudRunner({signal:controller.signal}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
