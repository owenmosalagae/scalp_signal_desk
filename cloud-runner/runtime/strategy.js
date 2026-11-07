// Generated from lib/deriv/strategy.ts. Run node scripts/build-deriv-runner.mjs after changes.
export const STATES = ['Neutral', 'Bullish', 'Bearish'];
export function trend(values) {
    if (values.slice(1).every((v, i) => values[i] > v))
        return 1;
    if (values.slice(1).every((v, i) => values[i] < v))
        return 2;
    return 0;
}
export async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
}
function snap(price, tick, digits) {
    const n = price / tick + (price < 0 ? -1e-9 : 1e-9);
    return Number(((n < 0 ? Math.ceil(n - .5) : Math.floor(n + .5)) * tick).toFixed(digits));
}
export function calculate(bars, settings, tick, digits, seconds, now) {
    const candles = [];
    const signals = [];
    if (!bars.length)
        return { candles, signals, state: 'Loading' };
    let averages = settings.periods.map(() => bars[0].close), atr = 0, previous = 0;
    let closedState = 'Loading';
    const valid = Math.max(settings.periods.at(-1) - 1, settings.atrPeriod - 1);
    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        if (!i)
            atr = bar.high - bar.low;
        else {
            averages = averages.map((v, j) => v + 2 / (settings.periods[j] + 1) * (bar.close - v));
            const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i - 1].close), Math.abs(bar.low - bars[i - 1].close));
            atr += (tr - atr) / Math.min(i + 1, settings.atrPeriod);
        }
        const state = trend(averages), closed = bar.time + seconds <= now;
        if (i >= valid && closed)
            closedState = STATES[state];
        if (i >= valid + 1 && closed && state && state !== previous) {
            const entry = snap(bar.close, tick, digits), side = state === 1 ? 1 : -1;
            const risk = Math.max(1, Math.ceil(atr * settings.atrMultiplier / tick - 1e-9)) * tick;
            signals.push({ direction: state === 1 ? 'BUY' : 'SELL', candleTime: bar.time, confirmedAt: bar.time + seconds, entry,
                stop: snap(entry - side * risk, tick, digits), targets: settings.targets.map(r => snap(entry + side * risk * r, tick, digits)) });
        }
        if (i >= bars.length - 180 && i >= settings.periods.at(-1) - 1)
            candles.push({ ...bar, emas: [...averages], state: STATES[state] });
        previous = state;
    }
    return { candles, signals: signals.slice(-100), state: closedState };
}
export function trendFromBars(bars, periods, seconds, now) {
    const closed = bars.filter(b => b.time + seconds <= now);
    if (closed.length < periods.at(-1))
        return 'Loading';
    let values = periods.map(() => closed[0].close);
    for (const bar of closed.slice(1))
        values = values.map((v, i) => v + 2 / (periods[i] + 1) * (bar.close - v));
    return STATES[trend(values)];
}
export function aggregate45(bars, now) {
    const groups = new Map();
    for (const bar of bars) {
        const t = Math.floor(bar.time / 2700) * 2700;
        const g = groups.get(t) || [];
        g.push(bar);
        groups.set(t, g);
    }
    return [...groups.entries()].filter(([t, g]) => t + 2700 <= now && g.length === 3 && g[0].time === t && g[1].time === t + 900 && g[2].time === t + 1800)
        .map(([time, g]) => ({ time, open: g[0].open, close: g[2].close, high: Math.max(...g.map(b => b.high)), low: Math.min(...g.map(b => b.low)) }));
}
