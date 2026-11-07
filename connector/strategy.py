"""The Scalp_Ribbon_MT5.mq5 calculation, ported without changing its rules."""
import hashlib
import json
import math

DEFAULT_SETTINGS = {
    "periods": [8, 13, 21, 34, 55],
    "atrPeriod": 14, "atrMultiplier": 1.5, "targets": [1.5, 2.0, 3.0],
}
STATES = ["Neutral", "Bullish", "Bearish"]


def validate(settings):
    periods = settings["periods"]
    targets = settings["targets"]
    if (len(periods) != 5 or any(type(p) is not int or p < 1 or p > 500 for p in periods)
            or any(a >= b for a, b in zip(periods, periods[1:]))
            or type(settings["atrPeriod"]) is not int or not 1 <= settings["atrPeriod"] <= 500
            or not math.isfinite(settings["atrMultiplier"]) or settings["atrMultiplier"] <= 0
            or len(targets) != 3 or any(not math.isfinite(t) or t <= 0 for t in targets)
            or any(a >= b for a, b in zip(targets, targets[1:]))):
        raise ValueError("Use increasing EMA periods and targets, and positive ATR settings.")


def trend(averages):
    if all(a > b for a, b in zip(averages, averages[1:])):
        return 1
    if all(a < b for a, b in zip(averages, averages[1:])):
        return 2
    return 0


def mql_round(value):
    return math.floor(value + 0.5) if value >= 0 else math.ceil(value - 0.5)


def snap(price, tick_size, digits):
    ticks = price / tick_size
    ticks += -1e-9 if ticks < 0 else 1e-9
    return round(mql_round(ticks) * tick_size, digits)


def levels(direction, close, atr, tick_size, digits, settings):
    entry = snap(close, tick_size, digits)
    risk = max(1, math.ceil(atr * settings["atrMultiplier"] / tick_size - 1e-9)) * tick_size
    side = 1 if direction == 1 else -1
    return {
        "entry": entry,
        "stop": snap(entry - side * risk, tick_size, digits),
        "targets": [snap(entry + side * risk * r, tick_size, digits) for r in settings["targets"]],
    }


def stream_id(broker, symbol, timeframe, settings):
    source = json.dumps([broker, symbol, timeframe, settings], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(("scalp-ribbon-v1:" + source).encode()).hexdigest()


def calculate(bars, settings, tick_size, digits, stream, seconds):
    """bars are chronological and include the current forming candle as the last item."""
    if not bars:
        return [], []
    factors = [2.0 / (p + 1) for p in settings["periods"]]
    averages = [bars[0]["close"]] * 5
    atr = 0.0
    previous_state = 0
    first_valid = max(settings["periods"][-1] - 1, settings["atrPeriod"] - 1)
    candles, signals = [], []
    for i, bar in enumerate(bars):
        close = bar["close"]
        if i == 0:
            atr = bar["high"] - bar["low"]
        else:
            averages = [value + factor * (close - value) for value, factor in zip(averages, factors)]
            previous_close = bars[i - 1]["close"]
            true_range = max(bar["high"] - bar["low"], abs(bar["high"] - previous_close), abs(bar["low"] - previous_close))
            atr += (true_range - atr) / min(i + 1, settings["atrPeriod"])
        state = trend(averages)
        if (i >= first_valid + 1 and i < len(bars) - 1 and state != 0 and state != previous_state):
            signal_id = hashlib.sha256((stream + ":" + str(bar["time"])).encode()).hexdigest()
            signals.append({
                "id": signal_id, "direction": "BUY" if state == 1 else "SELL",
                "candleTime": bar["time"], "confirmedAt": bar["time"] + seconds,
                **levels(state, close, atr, tick_size, digits, settings),
            })
        if i >= len(bars) - 180 and i >= settings["periods"][-1] - 1:
            candles.append({**bar, "emas": list(averages), "state": STATES[state]})
        previous_state = state
    return candles, signals[-100:]


def trend_from_closes(closes, periods):
    if len(closes) < periods[-1]:
        return "Loading"
    averages = [closes[0]] * 5
    for close in closes[1:]:
        averages = [v + 2.0 / (p + 1) * (close - v) for v, p in zip(averages, periods)]
    return STATES[trend(averages)]


def closed_45_closes(bars):
    if not bars:
        return []
    active = bars[-1]["time"] // 2700 * 2700
    oldest = bars[0]["time"] // 2700 * 2700
    grouped = {}
    for bar in bars:
        bucket = bar["time"] // 2700 * 2700
        if oldest < bucket < active:
            grouped[bucket] = bar["close"]
    return list(grouped.values())
