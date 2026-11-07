"""Run on the Windows computer where MetaTrader 5 is installed."""
import argparse
import base64
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from strategy import DEFAULT_SETTINGS, calculate, stream_id, trend_from_closes, closed_45_closes, validate

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
        raise RuntimeError("MT5 price history is unavailable. Open the symbol's chart, let it load, then retry.")
    return [{name: int(row[name]) if name == "time" else float(row[name])
             for name in ("time", "open", "high", "low", "close")} for row in result]


def post_snapshot(site, token, snapshot):
    data = json.dumps(snapshot, separators=(",", ":"), allow_nan=False).encode()
    request = urllib.request.Request(site + "/api/ingest", data=data, method="POST", headers={
        "Content-Type": "application/json",
        "OAI-Sites-Authorization": "Bearer " + token,
    })
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def run(args):
    import MetaTrader5 as mt5

    settings_path = Path(__file__).with_name("settings.json")
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else DEFAULT_SETTINGS
    validate(settings)
    symbol = args.symbol or input("MT5 symbol exactly as it appears in Market Watch [XAUUSD]: ").strip() or "XAUUSD"
    timeframe = args.timeframe or input("Chart timeframe [M5]: ").strip().upper() or "M5"
    if timeframe not in FRAMES:
        raise ValueError("Choose a supported timeframe such as M1, M5, M15, H1, H4 or D1.")
    if not (mt5.initialize(path=args.terminal) if args.terminal else mt5.initialize()):
        raise RuntimeError("Could not connect to MT5. Open your desktop terminal and sign in first. " + str(mt5.last_error()))
    try:
        info = mt5.symbol_info(symbol)
        if info is None:
            available = mt5.symbols_get()
            matches = [s.name for s in available or [] if "XAU" in s.name.upper() or "GOLD" in s.name.upper()]
            raise ValueError("Symbol not found. Gold symbols in this terminal: " + ", ".join(matches[:15]))
        if not mt5.symbol_select(symbol, True):
            raise RuntimeError("Could not select this symbol in MT5 Market Watch.")
        token = pair(SITE_URL)
        account = mt5.account_info()
        broker = str(account.server if account else "MT5")
        stream = stream_id(broker, symbol, timeframe, settings)
        terminal = mt5.terminal_info()
        # Use the terminal's complete available chart history for the original EMA seed.
        history_count = int(terminal.maxbars) if terminal else 100000
        history_count = max(history_count, settings["periods"][-1] + 2)
        frame = getattr(mt5, "TIMEFRAME_" + timeframe)
        chart_key = None
        candles, signals = [], []
        trend_cache = {}
        pending = {}
        next_attempt = 0.0
        retry_delay = 2
        print("Connected. Leave MT5 and this window running. Press Ctrl+C to stop.")
        while True:
            try:
                # Refresh the full strategy only at a new bar. Update the forming candle between closes.
                recent = bars_from_mt5(mt5, symbol, frame, 2)
                current_key = recent[-1]["time"]
                if chart_key != current_key:
                    bars = bars_from_mt5(mt5, symbol, frame, history_count)
                    if len(bars) < max(settings["periods"][-1], settings["atrPeriod"]) + 2:
                        raise RuntimeError("Load more MT5 history before monitoring this chart.")
                    candles, signals = calculate(bars, settings, info.trade_tick_size or info.point, info.digits, stream, FRAMES[timeframe])
                    chart_key = bars[-1]["time"]
                    recent = bars[-2:]
                    for signal in signals:
                        pending[signal["id"]] = signal
                # Recalculate the current EMA from the previous closed candle.
                current = recent[-1]
                previous = candles[-2]
                current_emas = [v + 2.0 / (p + 1) * (current["close"] - v)
                                for v, p in zip(previous["emas"], settings["periods"])]
                from strategy import STATES, trend
                candles[-1] = {**current, "emas": current_emas, "state": STATES[trend(current_emas)]}
                trends = [{"frame": timeframe + " (chart)", "state": candles[-2]["state"]}]
                count = settings["periods"][-1] * 6
                for label in ("M15", "M45", "H1", "H4", "D1"):
                    source_frame = getattr(mt5, "TIMEFRAME_" + ("M15" if label == "M45" else label))
                    try:
                        source = bars_from_mt5(mt5, symbol, source_frame, 3 * (count + 2) if label == "M45" else count + 1)
                        key = source[-1]["time"] // 2700 if label == "M45" else source[-1]["time"]
                        if label not in trend_cache or trend_cache[label][0] != key or trend_cache[label][1] == "Loading":
                            closes = closed_45_closes(source) if label == "M45" else [bar["close"] for bar in source[:-1]]
                            trend_cache[label] = (key, trend_from_closes(closes, settings["periods"]))
                        state = trend_cache[label][1]
                    except RuntimeError:
                        state = "Loading"
                    trends.append({"frame": label, "state": state})
                quote = mt5.symbol_info_tick(symbol)
                now = int(time.time())
                snapshot = {
                    "streamId": stream, "symbol": symbol, "timeframe": timeframe, "timeframeSeconds": FRAMES[timeframe],
                    "broker": broker, "digits": info.digits, "tickSize": info.trade_tick_size or info.point,
                    "generatedAt": now, "quoteTime": int(quote.time) if quote else 0,
                    "bid": float(quote.bid) if quote else candles[-1]["close"],
                    "ask": float(quote.ask) if quote else candles[-1]["close"],
                    "settings": settings, "trends": trends, "candles": candles,
                    "signals": sorted(pending.values(), key=lambda s: s["confirmedAt"])[-100:],
                }
                if time.monotonic() >= next_attempt:
                    post_snapshot(SITE_URL, token, snapshot)
                    pending.clear()
                    retry_delay = 2
                    next_attempt = 0
                    print(time.strftime("%H:%M:%S"), symbol, timeframe, trends[0]["state"], "| desk updated")
                time.sleep(10)
            except urllib.error.HTTPError as error:
                if error.code in (401, 403):
                    print("Connection access expired. Pairing again.")
                    token = pair(SITE_URL)
                else:
                    print("Server is temporarily unavailable. Retrying.")
                    next_attempt = time.monotonic() + retry_delay
                    retry_delay = min(retry_delay * 2, 60)
                    time.sleep(min(retry_delay, 10))
            except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as error:
                print("Waiting for the connection:", str(error)[:180])
                next_attempt = time.monotonic() + retry_delay
                retry_delay = min(retry_delay * 2, 60)
                time.sleep(min(retry_delay, 10))
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send confirmed Scalp Ribbon signals to your private app.")
    parser.add_argument("--symbol")
    parser.add_argument("--timeframe")
    parser.add_argument("--terminal", help="Optional full path to terminal64.exe")
    arguments = parser.parse_args()
    try:
        run(arguments)
    except KeyboardInterrupt:
        print("\nConnector stopped.")
    except (ValueError, RuntimeError, ImportError) as error:
        print("Connector could not start:", error)
        input("Press Enter to close.")
        raise SystemExit(1)
