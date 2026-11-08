// Generated from lib/deriv/engine.ts. Run node scripts/build-deriv-runner.mjs after changes.
import { DerivClient } from './client.js';
import { calculate, trendFromBars, aggregate45, sha256 } from './strategy.js';
import { FRAMES, resolveConfig, STRATEGIES } from './types.js';
import { calculateSessionFvg } from './session-fvg.js';
export function selectedMarkets(markets, config) {
    const resolved = resolveConfig(config);
    return markets.filter(m => !m.suspended && !(resolved.strategy === 'session_fvg' && resolved.session.mode === 'new_york' && m.category !== 'forex') && (config.scope === 'both' || config.scope === m.category || (config.scope === 'watchlist' && config.symbols.includes(m.code))));
}
export function strategyStreamSeed(symbol, input) {
    const config = resolveConfig(input);
    // Preserve every legacy Ribbon stream and signal identity.
    return config.strategy === 'scalp_ribbon'
        ? 'scalp-ribbon-deriv-v1:' + JSON.stringify([symbol, config.timeframe, config.settings])
        : 'session-fvg-deriv-v1:' + JSON.stringify([symbol, 'M5', config.session]);
}
async function pool(items, work) {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor++];
            await work(item);
        }
    }));
}
export class DerivEngine {
    owner;
    mode;
    callbacks;
    createClient;
    config;
    client = null;
    stopped = false;
    monitors = new Map();
    status = { phase: 'connecting', message: 'Connecting to Deriv…', loaded: 0, total: 0, errors: {} };
    timer;
    constructor(config, owner, mode, callbacks, createClient = () => new DerivClient()) {
        this.owner = owner;
        this.mode = mode;
        this.callbacks = callbacks;
        this.createClient = createClient;
        this.config = resolveConfig(config);
    }
    update(patch) { this.status = { ...this.status, ...patch, errors: { ...this.status.errors } }; this.callbacks.status(this.status); }
    async run() {
        let failures = 0;
        while (!this.stopped) {
            try {
                await this.session();
                failures = 0;
            }
            catch (error) {
                if (this.stopped)
                    break;
                this.update({ phase: 'retrying', message: error.message });
                failures++;
            }
            this.client?.close();
            clearInterval(this.timer);
            if (!this.stopped)
                await new Promise(r => setTimeout(r, Math.min(30000, 2000 * 2 ** Math.min(failures, 4))));
        }
    }
    async session() {
        const client = this.client = this.createClient();
        let disconnected = false;
        client.onDisconnect = () => { disconnected = true; };
        client.onCandle = raw => {
            const monitor = this.monitors.get(String(raw.symbol)), seconds = Number(raw.granularity), time = Number(raw.open_time);
            if (!monitor || !monitor.frames.has(seconds))
                return;
            const bar = { time, open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close) };
            if (!Object.values(bar).every(Number.isFinite) || time <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close))
                return;
            const bars = monitor.frames.get(seconds);
            const last = bars.at(-1);
            if (last && time < last.time)
                return;
            // A gap means the connection missed candles. Rehydrate instead of inventing bars.
            if (last && time > last.time + seconds && monitor.market.open) {
                client.close();
                return;
            }
            if (last?.time === time)
                bars[bars.length - 1] = bar;
            else
                bars.push(bar);
            if (bars.length > 1000)
                bars.shift();
            monitor.quoteTime = Math.max(monitor.quoteTime, Number(raw.epoch) || 0);
            monitor.dirty = true;
            if (seconds === FRAMES[this.config.timeframe]) {
                // Larger candles can be maintained from the streamed chart candle.
                for (const [frame, series] of monitor.frames) {
                    if (frame <= seconds || frame % seconds !== 0 || !series.length)
                        continue;
                    const bucket = Math.floor(time / frame) * frame, tail = series.at(-1);
                    if (bucket === tail.time)
                        series[series.length - 1] = { ...tail, high: Math.max(tail.high, bar.high), low: Math.min(tail.low, bar.low), close: bar.close };
                    else if (bucket > tail.time) {
                        series.push({ ...bar, time: bucket });
                        if (series.length > 1000)
                            series.shift();
                    }
                }
            }
        };
        this.monitors.clear();
        this.update({ phase: 'connecting', message: 'Discovering Deriv markets…', loaded: 0, total: 0, errors: {} });
        await client.connect();
        const catalog = await client.markets();
        if (this.stopped)
            return;
        this.callbacks.catalog(catalog);
        const markets = selectedMarkets(catalog, this.config).sort((a, b) => Number(b.code === 'stpRNG') - Number(a.code === 'stpRNG'));
        this.update({ phase: 'loading', message: 'Loading candle history. Markets appear as they become ready.', total: markets.length });
        if (!markets.length) {
            this.update({ phase: 'idle', message: 'No available markets match this selection.' });
            while (!this.stopped && !disconnected)
                await new Promise(r => setTimeout(r, 1000));
            return;
        }
        const seconds = FRAMES[this.config.timeframe];
        this.timer = setInterval(() => {
            for (const monitor of this.monitors.values()) {
                void this.publish(monitor);
                for (const frame of monitor.frames.keys())
                    void this.refresh(monitor, frame, client);
            }
        }, 2000);
        await pool(markets, async (market) => {
            if (this.stopped || disconnected)
                return;
            try {
                const streamId = await sha256(strategyStreamSeed(market.code, this.config));
                const monitor = { market, streamId, frames: new Map(), quoteTime: 0, sent: new Set(), lastPublished: 0, lastClosed: 0, dirty: true, busy: false, retryAt: 0, streaming: market.open, refreshed: new Map(), refreshing: new Set() };
                this.monitors.set(market.code, monitor);
                let bars;
                try {
                    bars = await client.history(market.code, seconds, monitor.streaming);
                }
                catch (error) {
                    if (!/subscription.*limit/i.test(error.message))
                        throw error;
                    monitor.streaming = false;
                    bars = await client.history(market.code, seconds, false);
                }
                const minimum = this.config.strategy === 'session_fvg' ? Math.max(this.config.session.atrPeriod, this.config.session.swingLookback) + 5 : Math.max(...this.config.settings.periods, this.config.settings.atrPeriod) + 2;
                if (bars.length < minimum)
                    throw new Error('Not enough candle history for the strategy.');
                monitor.frames.set(seconds, bars);
                monitor.refreshed.set(seconds, Date.now());
                // A historical candle's open time is not a live quote timestamp.
                monitor.quoteTime = bars.at(-1).time;
                await this.publish(monitor, true);
                this.update({ loaded: this.status.loaded + 1 });
            }
            catch (error) {
                this.status.errors[market.code] = error.message;
                this.monitors.delete(market.code);
                this.update({});
            }
        });
        this.update({ phase: 'trends', message: 'Charts are live. Loading the higher-timeframe trend histories…' });
        const jobs = [...this.monitors.values()].flatMap(monitor => [900, 3600, 14400, 86400]
            .filter(frame => !monitor.frames.has(frame)).map(frame => ({ monitor, frame })));
        let completed = 0;
        await pool(jobs, async ({ monitor, frame }) => {
            if (this.stopped || disconnected)
                return;
            try {
                monitor.frames.set(frame, await client.history(monitor.market.code, frame, false));
                monitor.dirty = true;
                monitor.refreshed.set(frame, Date.now());
            }
            catch (error) {
                this.status.errors[monitor.market.code + '-' + frame] = error.message;
            }
            completed++;
            if (completed % 20 === 0)
                this.update({ message: `Charts are live. Trend histories ${completed}/${jobs.length} ready.` });
        });
        if (disconnected)
            throw new Error('Deriv connection interrupted. Restoring subscriptions…');
        this.update({ phase: 'live', message: `Scanning ${this.status.loaded} markets. Signals confirm on closed candles; non-streaming feeds refresh every 30 seconds.` });
        // Periodically refresh the catalogue and retry failed symbols by rebuilding the session.
        const refreshAt = Date.now() + 15 * 60_000;
        while (!this.stopped && !disconnected && Date.now() < refreshAt)
            await new Promise(r => setTimeout(r, 1000));
        if (!this.stopped && disconnected)
            throw new Error('Deriv connection interrupted. Restoring subscriptions…');
    }
    async refresh(monitor, frame, client) {
        if (this.stopped || monitor.refreshing.has(frame))
            return;
        const now = Date.now(), chart = FRAMES[this.config.timeframe], last = monitor.refreshed.get(frame) || 0;
        // Subscribed chart feeds maintain larger, aligned frames. Smaller frames are
        // refreshed after their close; non-streaming chart feeds use a 30s fallback.
        if (monitor.streaming && (frame === chart || (frame > chart && frame % chart === 0)))
            return;
        const due = frame === chart ? now - last >= 30000 : Math.floor(now / 1000 / frame) > Math.floor(last / 1000 / frame) && now - last > 10000;
        if (!due || !monitor.market.open)
            return;
        monitor.refreshing.add(frame);
        monitor.refreshed.set(frame, now);
        try {
            const bars = await client.history(monitor.market.code, frame, false);
            if (bars.length) {
                monitor.frames.set(frame, bars);
                if (frame === chart)
                    monitor.quoteTime = bars.at(-1).time;
                monitor.dirty = true;
            }
            delete this.status.errors[monitor.market.code + '-' + frame + '-refresh'];
        }
        catch (error) {
            this.status.errors[monitor.market.code + '-' + frame + '-refresh'] = error.message;
            this.update({});
        }
        finally {
            monitor.refreshing.delete(frame);
        }
    }
    async publish(monitor, force = false) {
        const seconds = FRAMES[this.config.timeframe], bars = monitor.frames.get(seconds), now = Math.floor(Date.now() / 1000);
        if (!bars || monitor.busy || this.stopped || Date.now() < monitor.retryAt)
            return;
        const latestClosed = bars.findLast(b => b.time + seconds <= now)?.time || 0;
        if (!force && latestClosed === monitor.lastClosed && (now - monitor.lastPublished < (monitor.market.open ? 30 : 60) || (!monitor.dirty && monitor.market.open)))
            return;
        monitor.busy = true;
        try {
            const result = this.config.strategy === 'scalp_ribbon' ? calculate(bars, this.config.settings, monitor.market.tickSize, monitor.market.digits, seconds, now) : null;
            const session = this.config.strategy === 'session_fvg' ? calculateSessionFvg(bars, this.config.session, monitor.market.tickSize, monitor.market.digits, this.config.session.atrPeriod, now) : null;
            const candidates = session?.signals || result.signals;
            const newSignals = candidates.filter(s => !monitor.sent.has(s.candleTime));
            const signals = await Promise.all(newSignals.map(async (s) => ({ ...s, strategyId: this.config.strategy, strategyVersion: STRATEGIES[this.config.strategy].version, id: await sha256(monitor.streamId + ':' + s.candleTime) })));
            const trends = [{ frame: this.config.timeframe + ' (chart)', state: session?.state || result.state }, ...[['M15', 900], ['M45', 2700], ['H1', 3600], ['H4', 14400], ['D1', 86400]].map(([label, sec]) => {
                    const source = sec === 2700 ? aggregate45(monitor.frames.get(900) || [], now) : monitor.frames.get(Number(sec)) || [];
                    return { frame: String(label), state: trendFromBars(source, this.config.settings.periods, Number(sec), now) };
                })];
            const close = bars.at(-1).close;
            await this.callbacks.snapshot({ streamId: monitor.streamId, source: 'Deriv API', symbolCode: monitor.market.code, scannerMode: this.mode, scannerOwner: this.owner,
                strategyId: this.config.strategy, strategyVersion: STRATEGIES[this.config.strategy].version,
                ...(session ? { sessionSettings: this.config.session, sessionContext: session.context } : {}),
                backfill: monitor.lastPublished === 0, symbol: monitor.market.name, timeframe: this.config.timeframe, timeframeSeconds: seconds, broker: 'Deriv API · public prices',
                digits: monitor.market.digits, tickSize: monitor.market.tickSize, generatedAt: now, quoteTime: monitor.quoteTime, bid: close, ask: close,
                marketOpen: monitor.market.open, settings: session ? { ...this.config.settings, atrPeriod: this.config.session.atrPeriod, targets: this.config.session.targets } : this.config.settings, trends: trends,
                candles: session ? bars.slice(-180).map(bar => ({ ...bar, emas: Array(5).fill(bar.close), state: 'Neutral' })) : result.candles, signals });
            for (const s of newSignals)
                monitor.sent.add(s.candleTime);
            monitor.lastPublished = now;
            monitor.lastClosed = latestClosed;
            monitor.dirty = false;
            delete this.status.errors[monitor.market.code + '-save'];
        }
        catch (error) {
            monitor.retryAt = Date.now() + 10000;
            this.status.errors[monitor.market.code + '-save'] = error.message;
            this.update({});
        }
        finally {
            monitor.busy = false;
        }
    }
    stop() { this.stopped = true; this.client?.close(); clearInterval(this.timer); }
}
