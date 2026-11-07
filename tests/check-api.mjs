import fs from "node:fs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { createHash } from "node:crypto";
fs.mkdirSync(".sites-runtime", { recursive: true });

const database = new DatabaseSync(":memory:");
for (const migration of fs.readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort())
  database.exec(fs.readFileSync("drizzle/" + migration, "utf8"));
globalThis.testEnv = {
  DB: {
    prepare(sql) { return { bind(...values) { return { sql, values }; }, sql, values: [] }; },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map(s => {
          const query = database.prepare(s.sql);
          if (/^(SELECT|WITH)/i.test(s.sql) || /\bRETURNING\b/i.test(s.sql)) return { results: query.all(...s.values) };
          query.run(...s.values);
          return { success: true, results: [] };
        });
        database.exec("COMMIT"); return results;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  },
  MT5_SERVICE_TOKEN: "fixture-token",
};
for (const [from, to] of [
  ["lib/contracts.ts", ".sites-runtime/check-contracts.mjs"],
  ["lib/deriv/types.ts", ".sites-runtime/check-deriv-types.mjs"],
  ["app/api/deriv/config/route.ts", ".sites-runtime/check-deriv-config.mjs"],
  ["app/api/deriv/lease/route.ts", ".sites-runtime/check-deriv-lease.mjs"],
  ["app/api/deriv/runner-config/route.ts", ".sites-runtime/check-runner-config.mjs"],
  ["app/api/ingest/route.ts", ".sites-runtime/check-ingest.mjs"],
  ["app/api/state/route.ts", ".sites-runtime/check-state.mjs"],
  ["app/api/pair/route.ts", ".sites-runtime/check-pair.mjs"],
]) {
  let source = fs.readFileSync(from, "utf8")
    .replace(/import \{ env \} from ["']cloudflare:workers["'];/, 'const env = globalThis.testEnv;')
    .replace(/["']@\/lib\/contracts["']/g, '"./check-contracts.mjs"')
    .replace(/["']@\/lib\/deriv\/types["']/g, '"./check-deriv-types.mjs"');
  fs.writeFileSync(to, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const ingest = await import("../.sites-runtime/check-ingest.mjs");
const state = await import("../.sites-runtime/check-state.mjs");
const pair = await import("../.sites-runtime/check-pair.mjs");
const now = Math.floor(Date.now() / 1000);
const fixture = {
  streamId: "a".repeat(64), symbol: "TEST_MARKET", timeframe: "M5", timeframeSeconds: 300,
  broker: "Fixture", digits: 1, tickSize: .1, generatedAt: now, quoteTime: now,
  bid: 7300, ask: 7300.1,
  settings: { periods: [8,13,21,34,55], atrPeriod: 14, atrMultiplier: 1.5, targets: [1.5,2,3] },
  trends: ["M5","M15","M45","H1","H4","D1"].map(frame => ({frame,state:"Bullish"})),
  candles: [],
  signals: [{id:"b".repeat(64),direction:"BUY",candleTime:now-600,confirmedAt:now-300,
    entry:7300,stop:7298,targets:[7303,7304,7306]}],
};
async function post(body, origin) {
  return ingest.POST(new Request("https://desk.example/api/ingest", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
  }));
}
assert.deepEqual(await (await state.GET()).json(), { streams: [], signals: [] });
assert.equal((await post(fixture)).status, 200);
let result = await (await state.GET()).json();
assert.equal(result.signals.length, 1);
assert.equal(result.streams.length, 1);
assert.equal(result.signals[0].streamId, fixture.streamId);
await post(fixture);
assert.equal((await (await state.GET()).json()).signals.length, 1);
await post({ ...fixture, generatedAt: fixture.generatedAt - 20, bid: 100 });
assert.equal((await (await state.GET()).json()).streams[0].bid, fixture.bid);
assert.equal((await post({})).status, 400);
assert.equal((await post(fixture, "https://other.example")).status, 403);
console.log("PASS: API schema, database writes, retry deduplication, stream association and stale snapshot protection.");

const busyId = "c".repeat(64);
database.prepare("INSERT INTO streams (id,payload,snapshot_at,received_at) VALUES (?,?,?,?)")
  .run(busyId, JSON.stringify({...fixture,streamId:busyId,symbol:"BUSY_MARKET"}),now,now);
const insertSignal = database.prepare("INSERT INTO signals (id,stream_id,payload,confirmed_at,received_at) VALUES (?,?,?,?,?)");
for (let i=0;i<350;i++) {
  const signal={...fixture.signals[0],id:createHash("sha256").update("fixture-"+i).digest("hex"),
    streamId:busyId,symbol:"BUSY_MARKET",timeframe:"M5",digits:1,confirmedAt:now+i};
  insertSignal.run(signal.id,busyId,JSON.stringify(signal),signal.confirmedAt,now);
}
const marketHistory=await (await state.GET()).json();
assert.equal(marketHistory.signals.filter(signal=>signal.streamId===busyId).length,100);
assert.equal(marketHistory.signals.filter(signal=>signal.streamId===fixture.streamId).length,1);
console.log("PASS: A busy market preserves another market's history and latest report.");


const keys = await crypto.subtle.generateKey({name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash:"SHA-256"},true,["encrypt","decrypt"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString("base64url");
const form = new FormData();
form.set("key", publicKey); form.set("port","45678"); form.set("state","a".repeat(64));
const request = new Request("https://desk.example/api/pair", {method:"POST", body:form,headers:{origin:"https://desk.example","oai-authenticated-user-id":"fixture-owner"}});
const response = await pair.POST(request);
assert.equal(response.status, 303);
const redirect = new URL(response.headers.get("location"));
assert.equal(redirect.origin,"http://127.0.0.1:45678");
const encrypted = JSON.parse(Buffer.from(redirect.searchParams.get("payload"),"base64url").toString());
const aes = await crypto.subtle.decrypt({name:"RSA-OAEP"},keys.privateKey, Buffer.from(encrypted.key,"base64url"));
const aesKey = await crypto.subtle.importKey("raw",aes,"AES-GCM",false,["decrypt"]);
const decrypted = await crypto.subtle.decrypt({name:"AES-GCM",iv:Buffer.from(encrypted.iv,"base64url")},aesKey,Buffer.from(encrypted.data,"base64url"));
assert.deepEqual(JSON.parse(new TextDecoder().decode(decrypted)),{site:"https://desk.example",token:"fixture-token"});
const unauthorized = await pair.POST(new Request("https://desk.example/api/pair",{method:"POST"}));
assert.equal(unauthorized.status,403);
console.log("PASS: Authenticated connector pairing, AES/RSA encryption round trip and anonymous pairing rejection.");

const configRoute=await import("../.sites-runtime/check-deriv-config.mjs");
const leaseRoute=await import("../.sites-runtime/check-deriv-lease.mjs");
const runnerRoute=await import("../.sites-runtime/check-runner-config.mjs");
const owner=crypto.randomUUID(),other=crypto.randomUUID();
function derivRequest(path,body,headers={}){return new Request("https://desk.example"+path,{method:"POST",headers:{"content-type":"application/json",origin:"https://desk.example",...headers},body:JSON.stringify(body)});}
async function lease(owner,action="acquire",mode="browser"){return leaseRoute.POST(derivRequest("/api/deriv/lease",{owner,action,mode}));}
assert.equal((await (await configRoute.GET()).json()).config.scope,"both");
const config={enabled:true,scope:"forex",symbols:[],timeframe:"M15",settings:fixture.settings};
assert.equal((await configRoute.POST(derivRequest("/api/deriv/config",config))).status,200);
assert.deepEqual((await (await configRoute.GET()).json()).config,config);
assert.equal((await configRoute.POST(derivRequest("/api/deriv/config",{...config,timeframe:"M45"}))).status,400);
assert.equal((await configRoute.POST(derivRequest("/api/deriv/config",{...config,scope:"watchlist"}))).status,400);
assert.equal((await configRoute.POST(derivRequest("/api/deriv/config",config,{origin:"https://other.example"}))).status,403);
assert.equal((await lease(owner)).status,200);
assert.equal((await lease(other)).status,409);
assert.equal((await lease(other,"heartbeat")).status,409);
await lease(other,"release");
assert.equal((await lease(other)).status,409);
const apiFixture={...fixture,streamId:"d".repeat(64),symbol:"Step Index 100",source:"Deriv API",symbolCode:"stpRNG",scannerOwner:owner,scannerMode:"browser",backfill:true};
assert.equal((await post({...apiFixture,scannerOwner:other})).status,409);
assert.equal((await post(apiFixture)).status,200);
await lease(owner,"release");
assert.equal((await post(apiFixture)).status,409);
assert.equal((await lease(other,"acquire","cloud")).status,200);
assert.equal((await (await configRoute.GET()).json()).scanner.mode,"cloud");
database.prepare("UPDATE deriv_lease SET expires_at=? WHERE id='main'").run(now-1);
assert.equal((await lease(owner)).status,200);
assert.equal((await lease(other,"heartbeat","cloud")).status,409);
assert.equal((await runnerRoute.POST(derivRequest("/api/deriv/runner-config",{}))).status,403);
const download=await runnerRoute.POST(derivRequest("/api/deriv/runner-config",{}, {"oai-authenticated-user-id":"fixture-owner"}));
assert.equal(download.status,200);
assert.equal(download.headers.get("cache-control"),"no-store");
assert.match(await download.text(),/SCALP_SITE_TOKEN=fixture-token/);
const publicConfig=JSON.stringify(await (await configRoute.GET()).json());
assert.ok(!publicConfig.includes("fixture-token"));
const compact=await (await state.GET(new Request("https://desk.example/api/state?stream="+busyId))).json();
assert.equal(compact.signals.filter(s=>s.streamId===busyId).length,100);
assert.equal(compact.signals.filter(s=>s.streamId===fixture.streamId).length,1);
console.log("PASS: Deriv settings, invalid scope/timeframe rejection, origin checks, exclusive lease, expiry takeover, cloud mode, guarded ingestion and owner-only private settings download.");
