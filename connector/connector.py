"""Run on the Windows computer where MetaTrader 5 is installed."""
import argparse
from dataclasses import dataclass, field
import base64
import json
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from strategy import DEFAULT_SETTINGS, STATES, calculate, stream_id, trend, trend_from_closes, closed_45_closes, validate
import preferences

SITE_URL = "https://moss-scalp-signals.owenmosalagae.chatgpt.site"
FRAMES = {"M1": 60, "M2": 120, "M3": 180, "M4": 240, "M5": 300, "M6": 360,
          "M10": 600, "M12": 720, "M15": 900, "M20": 1200, "M30": 1800,
          "H1": 3600, "H2": 7200, "H3": 10800, "H4": 14400, "H6": 21600,
          "H8": 28800, "H12": 43200, "D1": 86400}


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(data):
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def pair(site):
    from cryptography.hazmat.primitives.asymmetric import rsa, padding
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    state = secrets.token_hex(32)
    paired = threading.Event()
    credentials = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            route = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(route.query)
            if route.path != "/paired" or query.get("state") != [state] or len(self.path) > 12000:
                self.send_error(400, "Invalid pairing request")
                return
            try:
                payload = json.loads(unb64(query["payload"][0]))
                key = private_key.decrypt(unb64(payload["key"]), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
                result = json.loads(AESGCM(key).decrypt(unb64(payload["iv"]), unb64(payload["data"]), None))
                if result.get("site") != site or not result.get("token"):
                    raise ValueError("Unexpected site")
                credentials.update(result)
            except (ValueError, KeyError, TypeError):
                self.send_error(400, "Pairing could not be verified")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b"<html><title>MT5 connected</title><body style='background:#10141d;color:#e8efdb;font:18px system-ui;padding:60px'><h1>MT5 connector paired.</h1><p>Return to the connector window. You can close this tab.</p></body></html>")
            paired.set()

        def log_message(self, *args):
            pass  # Pairing ciphertext and state must stay out of logs.

    server = HTTPServer(("127.0.0.1", 0), Handler)
    server.timeout = 1
    query = urllib.parse.urlencode({"key": b64(public_key), "port": server.server_port, "state": state})
    link = site + "/pair?" + query
    print("Your browser will open. Sign in and choose 'Pair my MT5 connector'.")
    print("If the browser does not open, copy this pairing link into your browser on THIS computer:")
    print(link)
    webbrowser.open(link)
    deadline = time.monotonic() + 600
    try:
        while not paired.is_set() and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()
    if not paired.is_set():
        raise RuntimeError("Pairing timed out. Start the connector again.")
    return credentials["token"]


def bars_from_mt5(mt5, symbol, frame, count):
    result = mt5.copy_rates_from_pos(symbol, frame, 0, count)
    if result is None or len(result) == 0:
        error = mt5.last_error()
        raise RuntimeError(
            f"MT5 history request failed for {symbol}, timeframe {frame}, {count} bars. "
            f"MT5 error {error}. Open this symbol's chart in the connected terminal and let it load."
        )
    return [{name: int(row[name]) if name == "time" else float(row[name])
             for name in ("time", "open", "high", "low", "close")} for row in result]


def load_chart_history(mt5, symbol, frame, requested_count, minimum_count):
    """Bound oversized terminal limits and retry smaller supported history requests."""
    if requested_count < minimum_count:
        raise RuntimeError(f"The MT5 chart limit must allow at least {minimum_count} candles.")
    counts = sorted({max(minimum_count, min(requested_count, limit))
                     for limit in (100000, 10000, 2000, 500, minimum_count)}, reverse=True)
    last_failure = RuntimeError("MT5 history is unavailable.")
    for count in counts:
        try:
            bars = bars_from_mt5(mt5, symbol, frame, count)
        except RuntimeError as error:
            last_failure = error
            continue
        if len(bars) < minimum_count:
            raise RuntimeError(
                f"MT5 returned {len(bars)} candles for {symbol}; {minimum_count} are required. "
                "Load more history in this symbol's chart, then let the connector retry."
            )
        return bars, count
    raise last_failure


def post_snapshot(site, token, snapshot):
    data = json.dumps(snapshot, separators=(",", ":"), allow_nan=False).encode()
    request = urllib.request.Request(site + "/api/ingest", data=data, method="POST", headers={
        "Content-Type": "application/json",
        "OAI-Sites-Authorization": "Bearer " + token,
    })
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def parse_symbols(value):
    names = value.split(",") if isinstance(value, str) else value
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
        raise ValueError("The watchlist must contain symbol names.")
    symbols = list(dict.fromkeys(name.strip() for name in names if name.strip()))
    if not symbols or len(symbols) > 20:
        raise ValueError("Choose between 1 and 20 symbols, separated by commas.")
    return symbols


def resolve_profile(args):
    configuring = getattr(args, "configure", False)
    # A broken saved profile can be replaced by the explicit configuration action.
    saved = None if configuring else preferences.load_profile()
    symbols = getattr(args, "symbols", None) or getattr(args, "symbol", None)
    has_overrides = bool(symbols or args.timeframe or args.terminal)
    if saved is None and configuring:
        try:
            saved = preferences.load_profile()
        except ValueError:
            saved = None
    profile = {
        "symbols": ["Step Index"], "timeframe": "M5",
        "terminal": None, "rememberPairing": False, **(saved or {}),
    }
    if symbols:
        profile["symbols"] = parse_symbols(symbols)
    if args.timeframe:
        profile["timeframe"] = args.timeframe.upper()
    if args.terminal:
        profile["terminal"] = args.terminal
    remember = getattr(args, "remember_pairing", None)
    interactive = configuring or (saved is None and not has_overrides)
    if interactive:
        default_symbols = ", ".join(parse_symbols(profile["symbols"]))
        answer = input(f"MT5 symbols, separated by commas [{default_symbols}]: ").strip()
        profile["symbols"] = parse_symbols(answer or default_symbols)
        answer = input(f"Chart timeframe [{profile['timeframe']}]: ").strip()
        profile["timeframe"] = (answer or profile["timeframe"]).upper()
        if remember is None:
            answer = input("Remember pairing securely for this Windows account? [Y/n]: ").strip().lower()
            if answer not in ("", "y", "yes", "n", "no"):
                raise ValueError("Choose Y or N for remembered pairing. Run configure_windows.bat to try again.")
            profile["rememberPairing"] = answer not in ("n", "no")
    if remember is not None:
        profile["rememberPairing"] = remember
    profile["symbols"] = parse_symbols(profile["symbols"])
    if not isinstance(profile["timeframe"], str) or profile["timeframe"] not in FRAMES:
        raise ValueError("Choose a supported timeframe such as M1, M5, M15, H1, H4 or D1.")
    if not isinstance(profile["rememberPairing"], bool):
        raise ValueError("The rememberPairing setting must be true or false.")
    if profile["terminal"] is not None and not isinstance(profile["terminal"], str):
        raise ValueError("The terminal setting must be an executable path.")
    preferences.save_profile(profile)
    if not profile["rememberPairing"]:
        preferences.forget_pairing()
    return profile


def session_token(remember, refresh=False):
    if remember and not refresh:
        token = preferences.load_pairing(SITE_URL)
        if token:
            print("Using your saved Windows pairing.")
            return token
    token = pair(SITE_URL)
    if remember:
        try:
            preferences.save_pairing(SITE_URL, token)
            print("Pairing saved with Windows Data Protection.")
        except OSError as error:
            print("Pairing will be used for this session only. Windows could not save it:", error)
    return token


@dataclass
class MarketMonitor:
    symbol: str
    timeframe: str
    frame: int
    info: object
    stream: str
    history_count: int
    chart_key: int | None = None
    candles: list = field(default_factory=list)
    pending: dict = field(default_factory=dict)
    trend_cache: dict = field(default_factory=dict)
    next_attempt: float = 0.0
    retry_delay: int = 2


def create_monitors(mt5, profile, settings, broker, terminal):
    monitors = []
    for symbol in profile["symbols"]:
        info = mt5.symbol_info(symbol)
        if info is None or not mt5.symbol_select(symbol, True):
            print(f"Skipping {symbol}: unavailable in the connected MT5 account. Check its exact Market Watch name.")
            continue
        minimum = max(settings["periods"][-1], settings["atrPeriod"]) + 2
        monitors.append(MarketMonitor(
            symbol=symbol, timeframe=profile["timeframe"],
            frame=getattr(mt5, "TIMEFRAME_" + profile["timeframe"]),
            info=info, stream=stream_id(broker, symbol, profile["timeframe"], settings),
            history_count=max(int(getattr(terminal, "maxbars", 100000)), minimum),
        ))
    if not monitors:
        raise ValueError("None of the saved symbols are available. Check MT5 sign-in, then run configure_windows.bat.")
    return monitors


def market_snapshot(mt5, monitor, settings, broker):
    symbol, timeframe = monitor.symbol, monitor.timeframe
    recent = bars_from_mt5(mt5, symbol, monitor.frame, 2)
    if monitor.chart_key != recent[-1]["time"]:
        minimum = max(settings["periods"][-1], settings["atrPeriod"]) + 2
        previous_request = monitor.history_count
        bars, monitor.history_count = load_chart_history(
            mt5, symbol, monitor.frame, monitor.history_count, minimum)
        if monitor.chart_key is None or monitor.history_count != previous_request:
            print(f"Loaded {len(bars)} {symbol} {timeframe} candles (request size {monitor.history_count}).")
        monitor.candles, signals = calculate(
            bars, settings, monitor.info.trade_tick_size or monitor.info.point,
            monitor.info.digits, monitor.stream, FRAMES[timeframe])
        monitor.chart_key = bars[-1]["time"]
        recent = bars[-2:]
        for signal in signals:
            monitor.pending[signal["id"]] = signal

    current = recent[-1]
    previous = monitor.candles[-2]
    current_emas = [value + 2.0 / (period + 1) * (current["close"] - value)
                   for value, period in zip(previous["emas"], settings["periods"])]
    monitor.candles[-1] = {**current, "emas": current_emas, "state": STATES[trend(current_emas)]}
    trends = [{"frame": timeframe + " (chart)", "state": monitor.candles[-2]["state"]}]
    count = settings["periods"][-1] * 6
    for label in ("M15", "M45", "H1", "H4", "D1"):
        source_frame = getattr(mt5, "TIMEFRAME_" + ("M15" if label == "M45" else label))
        try:
            source = bars_from_mt5(mt5, symbol, source_frame, 3 * (count + 2) if label == "M45" else count + 1)
            key = source[-1]["time"] // 2700 if label == "M45" else source[-1]["time"]
            cached = monitor.trend_cache.get(label)
            if cached is None or cached[0] != key or cached[1] == "Loading":
                closes = closed_45_closes(source) if label == "M45" else [bar["close"] for bar in source[:-1]]
                monitor.trend_cache[label] = (key, trend_from_closes(closes, settings["periods"]))
            state = monitor.trend_cache[label][1]
        except RuntimeError:
            state = "Loading"
        trends.append({"frame": label, "state": state})

    quote = mt5.symbol_info_tick(symbol)
    return {
        "streamId": monitor.stream, "symbol": symbol, "timeframe": timeframe,
        "timeframeSeconds": FRAMES[timeframe], "broker": broker,
        "digits": monitor.info.digits, "tickSize": monitor.info.trade_tick_size or monitor.info.point,
        "generatedAt": int(time.time()), "quoteTime": int(quote.time) if quote else 0,
        "bid": float(quote.bid) if quote else monitor.candles[-1]["close"],
        "ask": float(quote.ask) if quote else monitor.candles[-1]["close"],
        "settings": settings, "trends": trends, "candles": monitor.candles,
        "signals": sorted(monitor.pending.values(), key=lambda signal: signal["confirmedAt"])[-100:],
    }


def connect_terminal(mt5, profile):
    while True:
        if profile["terminal"]:
            initialized = mt5.initialize(profile["terminal"], timeout=10000)
        else:
            initialized = mt5.initialize(timeout=10000)
        if initialized:
            terminal, account = mt5.terminal_info(), mt5.account_info()
            if account is not None and getattr(terminal, "connected", True):
                return terminal, account
        print("Waiting for MT5 to connect. Sign in to your terminal if needed. MT5 error:", mt5.last_error())
        time.sleep(10)


def run(args):
    import MetaTrader5 as mt5

    settings_path = Path(__file__).with_name("settings.json")
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else DEFAULT_SETTINGS
    validate(settings)
    profile = resolve_profile(args)
    terminal, account = connect_terminal(mt5, profile)
    try:
        executable = Path(getattr(terminal, "path", "")) / "terminal64.exe"
        if executable.is_file():
            profile["terminal"] = str(executable)
            preferences.save_profile(profile)
        broker = str(account.server)
        monitors = create_monitors(mt5, profile, settings, broker, terminal)
        print("MT5 terminal:", getattr(terminal, "path", "unavailable"))
        print("Broker server:", broker)
        print("Monitoring:", ", ".join(monitor.symbol for monitor in monitors), "|", profile["timeframe"])
        print("Stop with Ctrl+C. Change your watchlist using configure_windows.bat.")
        token = session_token(profile["rememberPairing"])
        reauthenticated = False
        next_status = 0.0
        while True:
            # Rebuild streams after an account switch so different broker feeds keep their own identity.
            current_account = mt5.account_info()
            if current_account is not None and (current_account.server, getattr(current_account, "login", None)) != (
                    account.server, getattr(account, "login", None)):
                terminal, account = connect_terminal(mt5, profile)
                broker = str(account.server)
                monitors = create_monitors(mt5, profile, settings, broker, terminal)
                print("MT5 account changed. Refreshed the saved watchlist for", broker)
            updated = 0
            for monitor in monitors:
                if time.monotonic() < monitor.next_attempt:
                    continue
                try:
                    snapshot = market_snapshot(mt5, monitor, settings, broker)
                    post_snapshot(SITE_URL, token, snapshot)
                    monitor.pending.clear()
                    monitor.retry_delay = 2
                    monitor.next_attempt = 0.0
                    reauthenticated = False
                    updated += 1
                except urllib.error.HTTPError as error:
                    if error.code in (401, 403):
                        if reauthenticated:
                            raise RuntimeError("The app still rejects access after pairing. Check your app connection before restarting.")
                        print("App access needs a fresh pairing.")
                        preferences.forget_pairing()
                        token = session_token(profile["rememberPairing"], refresh=True)
                        reauthenticated = True
                        break
                    print(f"{monitor.symbol}: server returned HTTP {error.code}; retrying.")
                    monitor.next_attempt = time.monotonic() + monitor.retry_delay
                    monitor.retry_delay = min(monitor.retry_delay * 2, 60)
                except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as error:
                    print(f"{monitor.symbol}: {error}")
                    monitor.next_attempt = time.monotonic() + monitor.retry_delay
                    monitor.retry_delay = min(monitor.retry_delay * 2, 60)
            if updated and time.monotonic() >= next_status:
                print(time.strftime("%H:%M:%S"), f"{updated}/{len(monitors)} markets | desk updated")
                next_status = time.monotonic() + 60
            time.sleep(10)
    finally:
        mt5.shutdown()


def main():
    parser = argparse.ArgumentParser(description="Monitor a saved MT5 watchlist and report Scalp Ribbon signals.")
    symbols = parser.add_mutually_exclusive_group()
    symbols.add_argument("--symbol", help="One exact MT5 symbol")
    symbols.add_argument("--symbols", help="Comma-separated exact MT5 symbols")
    parser.add_argument("--timeframe")
    parser.add_argument("--terminal", help="Optional full path to terminal64.exe")
    parser.add_argument("--configure", action="store_true", help="Edit the saved watchlist")
    parser.add_argument("--remember-pairing", action=argparse.BooleanOptionalAction, default=None)
    maintenance = parser.add_mutually_exclusive_group()
    maintenance.add_argument("--enable-startup", action="store_true")
    maintenance.add_argument("--disable-startup", action="store_true")
    maintenance.add_argument("--forget-pairing", action="store_true")
    args = parser.parse_args()
    handle = None
    try:
        if args.enable_startup or args.disable_startup:
            if args.enable_startup and preferences.load_profile() is None:
                raise ValueError("Run start_windows.bat and complete setup before enabling startup.")
            preferences.set_startup(Path(__file__), args.enable_startup)
            print("Windows startup enabled." if args.enable_startup else "Windows startup disabled.")
            return
        if args.forget_pairing:
            preferences.forget_pairing()
            print("Saved pairing removed. Restart the connector to pair again.")
            return
        handle = preferences.acquire_instance_lock()
        run(args)
    except KeyboardInterrupt:
        print("\nConnector stopped.")
    except (ValueError, RuntimeError, ImportError, OSError, subprocess.SubprocessError) as error:
        print("Connector could not continue:", error)
        raise SystemExit(1)
    finally:
        preferences.release_instance_lock(handle)


if __name__ == "__main__":
    main()
