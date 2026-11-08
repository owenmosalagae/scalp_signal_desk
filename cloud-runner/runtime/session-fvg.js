// Generated from lib/deriv/session-fvg.ts. Run node scripts/build-deriv-runner.mjs after changes.
const STEP = 300;
const formatters = new Map();
function localParts(epoch, timeZone) {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
        formatters.set(timeZone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch * 1000)).map(part => [part.type, part.value]));
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
const wallTime = (p) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
// Choose the earlier occurrence of a repeated local time. A nonexistent DST
// clock time has no session; it is never silently shifted to another hour.
export function sessionEpoch(date, time, timeZone) {
    const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
    const wanted = Date.UTC(year, month - 1, day, hour, minute) / 1000;
    const offsets = new Set([-86400, 0, 86400].map(delta => wallTime(localParts(wanted + delta, timeZone)) - (wanted + delta)));
    const candidates = [...offsets].map(offset => wanted - offset).filter(epoch => wallTime(localParts(epoch, timeZone)) === wanted);
    return candidates.length ? Math.min(...candidates) : null;
}
function windows(bars, settings, now) {
    const dates = new Set();
    for (const epoch of [...bars.map(bar => bar.time), now]) {
        const p = localParts(epoch, settings.timeZone);
        for (const offset of [-1, 0])
            dates.add(new Date(Date.UTC(p.year, p.month - 1, p.day + offset)).toISOString().slice(0, 10));
    }
    return [...dates].sort().flatMap(date => {
        const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
        if (settings.mode === 'new_york' && (weekday === 0 || weekday === 6))
            return [];
        const anchor = sessionEpoch(date, settings.startTime, settings.timeZone);
        if (anchor === null)
            return [];
        const start = anchor - (settings.rangeMode === 'pre_session' ? 900 : 0), end = start + 900;
        return [{ sessionId: date + '@' + settings.timeZone + ':' + settings.startTime, start, end, tradeEnd: end + settings.tradeWindowMinutes * 60 }];
    });
}
function atrSeries(bars, period) {
    let atr = 0, count = 0;
    return bars.map((bar, index) => {
        if (!index || bar.time !== bars[index - 1].time + STEP) {
            atr = bar.high - bar.low;
            count = 1;
        }
        else {
            const previous = bars[index - 1];
            count++;
            const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close));
            atr += (tr - atr) / Math.min(count, period);
        }
        return count >= period ? atr : null;
    });
}
function rounded(price, tick, digits, direction = 0) {
    const units = price / tick;
    return Number(((direction < 0 ? Math.floor(units + 1e-9) : direction > 0 ? Math.ceil(units - 1e-9) : Math.round(units)) * tick).toFixed(digits));
}
export function calculateSessionFvg(input, settings, tick, digits, atrPeriod, now) {
    const bars = input.filter(bar => bar.time + STEP <= now);
    const signals = [], zones = [];
    const atr = atrSeries(bars, atrPeriod);
    let context = { phase: 'waiting_session', message: 'Waiting for a complete session reference range.', zones: [] };
    let state = 'Neutral';
    for (const window of windows(bars, settings, now)) {
        if (window.start > now)
            continue;
        const current = window.start <= now;
        if (now < window.end) {
            context = { phase: 'building_range', message: 'The M15 reference range is still forming. Signals begin after it closes.', zones: [] };
            state = 'Neutral';
            continue;
        }
        const rangeBars = bars.filter(bar => bar.time >= window.start && bar.time < window.end);
        if (rangeBars.length !== 3 || rangeBars.some((bar, index) => bar.time !== window.start + index * STEP)) {
            if (current)
                context = { phase: now >= window.tradeEnd ? 'outside_window' : 'missing_range', message: now >= window.tradeEnd ? 'Outside the session trade window.' : 'The complete reference range is missing. No range or setup is invented.', zones: [] };
            state = 'Neutral';
            continue;
        }
        const range = { ...window, high: Math.max(...rangeBars.map(bar => bar.high)), low: Math.min(...rangeBars.map(bar => bar.low)) };
        if (range.high <= range.low)
            continue;
        let bias = null, breakoutTime = 0, confirmed = 0;
        let pending, lastSetup;
        for (let index = 0; index < bars.length; index++) {
            const bar = bars[index], closedAt = bar.time + STEP;
            if (bar.time < window.end || closedAt > window.tradeEnd)
                continue;
            if (index > 0 && bar.time !== bars[index - 1].time + STEP) {
                if (pending) {
                    pending.status = 'invalidated';
                    pending.completedAt = closedAt;
                    pending = undefined;
                }
                bias = null;
                breakoutTime = 0;
            }
            const nextBias = bar.close > range.high ? 'BUY' : bar.close < range.low ? 'SELL' : bias;
            if (nextBias !== bias) {
                if (pending) {
                    pending.status = 'invalidated';
                    pending.completedAt = closedAt;
                    pending = undefined;
                }
                bias = nextBias;
                breakoutTime = closedAt;
            }
            if (pending) {
                const stopped = pending.direction === 'BUY' ? bar.low <= pending.stop : bar.high >= pending.stop;
                if (stopped || closedAt > pending.expiresAt) {
                    pending.status = stopped ? 'invalidated' : 'expired';
                    pending.completedAt = closedAt;
                    pending = undefined;
                }
                else {
                    const touches = bar.low <= pending.retestPrice && bar.high >= pending.retestPrice;
                    const reclaims = pending.direction === 'BUY'
                        ? bar.close > pending.gapHigh && bar.close > range.high && bar.close > bar.open
                        : bar.close < pending.gapLow && bar.close < range.low && bar.close < bar.open;
                    if (touches && reclaims) {
                        const side = pending.direction === 'BUY' ? 1 : -1;
                        const entry = rounded(bar.close, tick, digits), risk = side * (entry - pending.stop);
                        const targets = settings.targets.map(target => rounded(entry + side * risk * target, tick, digits));
                        const usableTargets = targets.every((target, n) => side * (target - entry) >= tick - 1e-9 && (n === 0 || side * (target - targets[n - 1]) >= tick - 1e-9));
                        if (risk >= tick - 1e-9 && usableTargets) {
                            signals.push({ direction: pending.direction, candleTime: bar.time, confirmedAt: closedAt, entry, stop: pending.stop,
                                targets,
                                strategyId: 'session_fvg', strategyVersion: '1', sessionId: window.sessionId, setupTime: pending.detectedAt,
                                reason: 'Closed M5 retest and rejection of a post-breakout FVG; entry reference is the confirmation close.' });
                            confirmed++;
                            pending.status = 'confirmed';
                            pending.completedAt = closedAt;
                            pending = undefined;
                        }
                    }
                }
            }
            if (pending || confirmed >= settings.maxSignalsPerSession || !bias || index < 3)
                continue;
            const first = bars[index - 2], middle = bars[index - 1], historicalAtr = atr[index - 2];
            if (first.time < breakoutTime || middle.time !== first.time + STEP || bar.time !== middle.time + STEP || !historicalAtr || historicalAtr <= 0)
                continue;
            const bullish = bias === 'BUY';
            if ((bullish ? middle.close <= middle.open : middle.close >= middle.open) || Math.abs(middle.close - middle.open) <= historicalAtr * settings.displacementAtr)
                continue;
            const gapLow = bullish ? first.high : bar.high, gapHigh = bullish ? bar.low : first.low;
            if (gapHigh - gapLow < Math.max(tick, historicalAtr * settings.minGapAtr) - 1e-9)
                continue;
            const structure = bars.slice(Math.max(0, index - settings.swingLookback + 1), index + 1);
            if (structure.some((value, n) => n > 0 && value.time !== structure[n - 1].time + STEP))
                continue;
            const buffer = Math.max(settings.stopBufferTicks * tick, settings.stopBufferAtr * historicalAtr);
            const stop = rounded(bullish ? Math.min(...structure.map(value => value.low)) - buffer : Math.max(...structure.map(value => value.high)) + buffer, tick, digits, bullish ? -1 : 1);
            const retestPrice = rounded(settings.retestLevel === 'midpoint' ? (gapLow + gapHigh) / 2 : bullish ? gapHigh : gapLow, tick, digits);
            if (bullish ? stop >= retestPrice : stop <= retestPrice)
                continue;
            pending = { id: window.sessionId + ':' + bar.time, direction: bias, gapLow, gapHigh, stop, retestPrice,
                detectedAt: closedAt, expiresAt: Math.min(window.tradeEnd, closedAt + settings.expiryBars * STEP), status: 'waiting_retest' };
            lastSetup = pending;
            zones.push(pending);
        }
        if (pending && now > pending.expiresAt) {
            pending.status = 'expired';
            pending.completedAt = pending.expiresAt;
            pending = undefined;
        }
        state = bias === 'BUY' ? 'Bullish' : bias === 'SELL' ? 'Bearish' : 'Neutral';
        const phase = now >= window.tradeEnd ? 'outside_window' : lastSetup?.status || (bias ? 'waiting_fvg' : 'waiting_breakout');
        const messages = {
            outside_window: 'Outside the session trade window.', waiting_breakout: 'Range locked. Waiting for an M5 close beyond it.',
            waiting_fvg: 'Breakout confirmed. Waiting for a new displacement FVG after the breakout.',
            waiting_retest: 'FVG detected. Waiting for a later closed-candle retest and rejection.',
            confirmed: 'Retest confirmed. Entry reference and trade levels are locked.',
            expired: 'The FVG retest window expired. Waiting for another eligible setup.', invalidated: 'The setup was invalidated before confirmation.',
        };
        context = { phase, message: messages[phase], range, setup: lastSetup, zones: [] };
    }
    context.zones = zones.slice(-20);
    return { signals: signals.slice(-100), context, state };
}
