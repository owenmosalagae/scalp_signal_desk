import type { Bar, Market } from './types.js';
export const DERIV_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
export function normalizeMarkets(rows: unknown): Market[] {
  if (!Array.isArray(rows)) throw new Error('Deriv returned an invalid market list.');
  const found = new Map<string,Market>();
  for (const item of rows) {
    if (!item || !['synthetic_index','forex'].includes(item.market)) continue;
    const code=item.underlying_symbol, name=item.underlying_symbol_name, tickSize=Number(item.pip_size);
    if (typeof code!=='string' || !/^[\w.-]{1,64}$/.test(code) || typeof name!=='string' || name.length>64 || !Number.isFinite(tickSize) || tickSize<=0) continue;
    let digits=0; while(digits<8 && Math.abs(tickSize*10**digits-Math.round(tickSize*10**digits))>1e-8) digits++;
    found.set(code,{code,name,category:item.market,tickSize,digits,open:!!item.exchange_is_open,suspended:!!item.is_trading_suspended});
  }
  return [...found.values()].sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
}
export function normalizeBars(rows: unknown): Bar[] {
  if (!Array.isArray(rows)) throw new Error('Candle history is unavailable.');
  const bars=new Map<number,Bar>();
  for (const row of rows) {
    if(!row || typeof row!=='object') continue;
    const time=Number(row.epoch),open=Number(row.open),high=Number(row.high),low=Number(row.low),close=Number(row.close);
    if (![time,open,high,low,close].every(Number.isFinite) || !Number.isInteger(time) || time<=0 || high<Math.max(open,close) || low>Math.min(open,close) || low>high) continue;
    bars.set(time,{time,open,high,low,close});
  }
  return [...bars.values()].sort((a,b)=>a.time-b.time);
}
type Pending = { resolve: (value: any)=>void; reject: (error: Error)=>void; timer: ReturnType<typeof setTimeout> };
export class DerivClient {
  socket: WebSocket | null = null;
  pending = new Map<number,Pending>();
  nextId=0; nextSend=0; queue: Promise<unknown> = Promise.resolve(); closed=true;
  onCandle: (ohlc: any)=>void = ()=>{};
  onDisconnect: ()=>void = ()=>{};
  delay: {timer:ReturnType<typeof setTimeout>;done:()=>void}|null=null;
  ping: ReturnType<typeof setInterval> | undefined;
  async connect() {
    this.closed=false;
    await new Promise<void>((resolve,reject)=>{
      const ws=this.socket=new WebSocket(DERIV_URL);
      const timer=setTimeout(()=>{ws.close();reject(new Error('Deriv did not respond. Retrying the connection.'));},12000);
      ws.onopen=()=>{clearTimeout(timer);resolve();};
      ws.onerror=()=>{clearTimeout(timer);reject(new Error('Cannot reach Deriv. Check your internet connection.'));};
      ws.onclose=()=>{clearTimeout(timer);this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Deriv connection interrupted.'));}this.pending.clear();this.onDisconnect();reject(new Error('Deriv connection closed.'));};
      ws.onmessage=event=>{
        let data:any;try{data=JSON.parse(String(event.data));}catch{return;}
        if(data.msg_type==='ohlc' && data.ohlc) this.onCandle(data.ohlc);
        const p=this.pending.get(data.req_id);if(!p)return;
        clearTimeout(p.timer);this.pending.delete(data.req_id);
        if(data.error){if(/rate.*limit|too.*many.*request/i.test(String(data.error.code)))this.nextSend=Date.now()+60000;p.reject(new Error(String(data.error.message||'Deriv request failed.')));}else p.resolve(data);
      };
    });
    this.ping=setInterval(()=>{if(this.socket?.readyState===1)this.socket.send(JSON.stringify({ping:1}));},25000);
  }
  request(payload: Record<string,unknown>): Promise<any> {
    return new Promise((resolve,reject)=>{
      this.queue=this.queue.catch(()=>{}).then(async()=>{
        while(!this.closed && Date.now()<this.nextSend){
          await new Promise<void>(done=>{const timer=setTimeout(()=>{this.delay=null;done();},this.nextSend-Date.now());this.delay={timer,done};});
        }
        if(this.closed || this.socket?.readyState!==1)throw new Error('Deriv is disconnected.');
        // Serialize sends at 150 requests/minute; responses can arrive concurrently.
        this.nextSend=Date.now()+400;
        const req_id=++this.nextId;
        const timer=setTimeout(()=>{this.pending.delete(req_id);reject(new Error('Deriv request timed out.'));},15000);
        this.pending.set(req_id,{resolve,reject,timer});
        this.socket.send(JSON.stringify({...payload,req_id}));
      }).catch(reject);
    });
  }
  async markets(){return normalizeMarkets((await this.request({active_symbols:'full'})).active_symbols);}
  async history(code:string,seconds:number,subscribe=false){return normalizeBars((await this.request({ticks_history:code,end:'latest',style:'candles',granularity:seconds,count:1000,adjust_start_time:1,...(subscribe?{subscribe:1}:{})})).candles);}
  close(){this.closed=true;if(this.delay){clearTimeout(this.delay.timer);this.delay.done();this.delay=null;}clearInterval(this.ping);this.socket?.close();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Scanner stopped.'));}this.pending.clear();}
}
