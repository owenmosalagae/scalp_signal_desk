"""Opt-in account-bound execution of the paired connector's fresh Scalp Ribbon signals.

SQLite records intent BEFORE sending. An ambiguous send latches a durable halt;
there is deliberately no automatic retry or live-account override.
"""
import json
import math
import sqlite3
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path

DEFAULTS = dict(riskPercent=0.25, dailyLossPercent=2.0, maxOpenRiskPercent=1.0,
                maxPositions=3, maxSignalAgeSeconds=30, maxQuoteAgeSeconds=10,
                maxSpreadR=0.10, maxEntryDriftR=0.20, costReservePercent=10.0,
                magic=7311701)


class Rejected(RuntimeError):
    pass


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load_config(path):
    return validate_config(json.loads(Path(path).read_text()))


def validate_config(config):
    if set(config) != set(DEFAULTS):
        raise ValueError("Robot settings must contain exactly the keys in robot-settings.json.")
    limits = dict(riskPercent=(0, 1), dailyLossPercent=(0, 5), maxOpenRiskPercent=(0, 3),
                  maxPositions=(0, 10), maxSignalAgeSeconds=(0, 60), maxQuoteAgeSeconds=(0, 30),
                  maxSpreadR=(0, .5), maxEntryDriftR=(0, .5), costReservePercent=(0, 100),
                  magic=(0, 2147483647))
    for key, (low, high) in limits.items():
        if not finite(config[key]) or not low < config[key] <= high:
            raise ValueError(f"Invalid robot setting: {key}")
    for key in ("maxPositions", "maxSignalAgeSeconds", "maxQuoteAgeSeconds", "magic"):
        if type(config[key]) is not int:
            raise ValueError(f"{key} must be an integer.")
    if config["riskPercent"] > config["maxOpenRiskPercent"]:
        raise ValueError("Per-trade risk cannot exceed total open risk.")
    return config


class Robot:
    def __init__(self, mt5, config, directory, clock=time.time, account_mode="demo", expected_login=None):
        self.mt5, self.config, self.clock = mt5, config, clock
        if account_mode not in ("demo", "real"):
            raise Rejected("Choose demo or real account mode.")
        if account_mode == "real" and (not isinstance(expected_login, str) or not expected_login.isascii() or not expected_login.isdigit()):
            raise Rejected("Real mode requires the exact MT5 account number supplied explicitly at launch.")
        self.account_mode, self.expected_login = account_mode, expected_login
        self.remote = None
        self.started = clock()
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.stop_file = self.directory / "ROBOT_STOP"
        self.db = sqlite3.connect(self.directory / "robot.sqlite3")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS attempts (
              account TEXT, signal TEXT, status TEXT, detail TEXT, created REAL,
              PRIMARY KEY(account,signal));
            CREATE TABLE IF NOT EXISTS days (
              account TEXT, day TEXT, baseline REAL, halted INTEGER DEFAULT 0,
              PRIMARY KEY(account,day));
            CREATE TABLE IF NOT EXISTS halts (account TEXT PRIMARY KEY, reason TEXT);
        """)
        account = mt5.account_info()
        try:
            self.check_account(account)
        except Exception:
            self.db.close()
            raise
        # A file-backed SQLite lock covers other Windows sessions using this profile too.
        self.lock = sqlite3.connect(self.directory / "robot-lock.sqlite3", timeout=0)
        try:
            self.lock.execute("BEGIN EXCLUSIVE")
        except sqlite3.OperationalError as error:
            self.lock.close()
            self.db.close()
            raise Rejected("Another robot owns this Windows profile's execution lock.") from error
        self.identity = (account.server, account.login)
        self.account_key = json.dumps(self.identity if self.account_mode == "demo" else (*self.identity, "real"))
        # Earlier releases latched account changes even without an uncertain order.
        # Retire only that exact reason; never clear execution uncertainty or daily latches.
        with self.db:
            self.db.execute("DELETE FROM halts WHERE account=? AND reason=? AND NOT EXISTS "
                            "(SELECT 1 FROM attempts WHERE account=? AND status IN ('sending','uncertain'))",
                            (self.account_key, "MT5 account changed during robot execution. Inspect account and restart after review.", self.account_key))
        # A previous crash after intent is an uncertain broker outcome. Stop all new sends.
        if self.db.execute("SELECT 1 FROM attempts WHERE account=? AND status='sending'",
                           (self.account_key,)).fetchone():
            self.halt("Unresolved send intent. Inspect MT5 history and robot.sqlite3 before operator recovery.")
        try:
            self.guard(initializing=True)
        except Exception:
            self.close()
            raise
        print(self.account_mode.upper(), "ROBOT ready for account", account.login, "on", account.server, "| Emergency stop file:", self.stop_file)

    def check_account(self, account):
        expected_mode = (self.mt5.ACCOUNT_TRADE_MODE_DEMO if self.account_mode == "demo"
                         else self.mt5.ACCOUNT_TRADE_MODE_REAL)
        if account is None or account.trade_mode != expected_mode:
            raise Rejected(f"This launcher requires an MT5 {self.account_mode.upper()} account. Contest and mismatched accounts are blocked.")
        if self.expected_login is not None and str(account.login) != self.expected_login:
            raise Rejected("Connected account does not match the account verified at launch.")
        if not account.trade_allowed or not account.trade_expert:
            raise Rejected("MT5 account does not allow automated trading.")
        if not finite(account.equity) or account.equity <= 0:
            raise Rejected("Invalid account equity.")

    def halt(self, reason):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO halts VALUES (?,?)", (self.account_key, reason))

    def guard(self, initializing=False):
        if self.stop_file.exists():
            raise Rejected("Emergency stop file is present.")
        account = self.mt5.account_info()
        self.check_account(account)
        if (account.server, account.login) != self.identity:
            raise Rejected("MT5 account changed. Restart and explicitly arm the robot on the intended account.")
        terminal = self.mt5.terminal_info()
        if terminal is None or not terminal.connected:
            raise Rejected("MT5 is disconnected. Open MT5 and sign in to the intended account.")
        if not terminal.trade_allowed:
            raise Rejected("MT5 Algo Trading is off. Enable its toolbar button for the intended account.")
        if terminal.tradeapi_disabled:
            raise Rejected("Python trading is blocked. In MT5 Tools > Options > Expert Advisors, uncheck Disable automated trading through the external Python API.")
        halt = self.db.execute("SELECT reason FROM halts WHERE account=?", (self.account_key,)).fetchone()
        if halt:
            raise Rejected(halt[0])
        day = datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO days(account,day,baseline) VALUES (?,?,?)",
                            (self.account_key, day, account.equity))
            baseline, halted = self.db.execute("SELECT baseline,halted FROM days WHERE account=? AND day=?",
                                              (self.account_key, day)).fetchone()
            if account.equity <= baseline * (1 - self.config["dailyLossPercent"] / 100):
                self.db.execute("UPDATE days SET halted=1 WHERE account=? AND day=?", (self.account_key, day))
                halted = 1
        if halted:
            raise Rejected("Daily equity loss limit reached; new trades blocked until the next UTC day.")
        if self.remote is not None:
            self.remote.check()
        elif self.account_mode == "real" and not initializing:
            raise Rejected("Real entries require the app-controlled runner and a current Start confirmation.")
        return account

    def loss(self, side, symbol, volume, entry, stop):
        profit = self.mt5.order_calc_profit(side, symbol, volume, entry, stop)
        if not finite(profit):
            raise Rejected("Broker could not calculate stop-loss risk.")
        return max(0, -profit)

    def prepare(self, symbol, signal):
        m, c = self.mt5, self.config
        account = self.guard()
        if self.remote is not None and symbol not in self.remote.symbols:
            raise Rejected("Market is disabled in the app.")
        now = self.clock()
        confirmed = signal["confirmedAt"]
        if not finite(confirmed) or confirmed <= self.started or not 0 <= now - confirmed <= c["maxSignalAgeSeconds"]:
            raise Rejected("Historical, pre-start or expired signal.")
        if signal["direction"] not in ("BUY", "SELL"):
            raise Rejected("Invalid signal direction.")
        prices = [signal["entry"], signal["stop"], *signal["targets"]]
        if len(signal["targets"]) != 3 or any(not finite(p) or p <= 0 for p in prices):
            raise Rejected("Invalid signal prices.")
        buy = signal["direction"] == "BUY"
        sign = 1 if buy else -1
        stop, target = signal["stop"], signal["targets"][0]
        distance = sign * (signal["entry"] - stop)
        if distance <= 0 or any(sign * (p - signal["entry"]) <= 0 for p in signal["targets"]):
            raise Rejected("Stop or target on the wrong side.")
        info, quote = m.symbol_info(symbol), m.symbol_info_tick(symbol)
        if info is None or quote is None or not 0 <= now - quote.time <= c["maxQuoteAgeSeconds"]:
            raise Rejected("Missing symbol or stale quote.")
        if not all(finite(v) and v > 0 for v in (quote.ask, quote.bid, info.point, info.trade_tick_size,
                                                info.volume_min, info.volume_max, info.volume_step)):
            raise Rejected("Invalid broker quote or contract specifications.")
        if quote.ask < quote.bid or quote.ask - quote.bid > distance * c["maxSpreadR"]:
            raise Rejected("Spread exceeds risk allowance.")
        entry = quote.ask if buy else quote.bid
        if abs(entry - signal["entry"]) > distance * c["maxEntryDriftR"]:
            raise Rejected("Price moved too far from the app signal.")
        # SL/TP must also clear the exit-side quote (bid for BUY, ask for SELL).
        exit_quote = quote.bid if buy else quote.ask
        minimum = max(info.trade_stops_level * info.point, info.trade_tick_size)
        if sign * (exit_quote - stop) < minimum or sign * (target - exit_quote) < minimum:
            raise Rejected("Stop or take-profit violates broker minimum distance.")
        for price in (stop, target):
            if abs(price / info.trade_tick_size - round(price / info.trade_tick_size)) > 1e-6:
                raise Rejected("Signal levels are not aligned to broker ticks.")
        positions, orders = m.positions_get(), m.orders_get()
        if positions is None or orders is None:
            raise Rejected("Could not verify existing account exposure.")
        if orders:
            raise Rejected("Pending account orders exist; cancel them before arming automatic entries.")
        if len(positions) >= c["maxPositions"] or any(p.symbol == symbol for p in positions):
            raise Rejected("Position limit reached or symbol already has a position.")
        open_risk = 0
        for position in positions:
            if not finite(position.sl) or position.sl <= 0:
                raise Rejected("An account position has no stop-loss.")
            # Include manual positions, using current exit price and current equity.
            q = m.symbol_info_tick(position.symbol)
            if q is None or not 0 <= now - q.time <= c["maxQuoteAgeSeconds"]:
                raise Rejected("Cannot price existing exposure.")
            side = m.ORDER_TYPE_BUY if position.type == m.POSITION_TYPE_BUY else m.ORDER_TYPE_SELL
            mark = q.bid if side == m.ORDER_TYPE_BUY else q.ask
            open_risk += self.loss(side, position.symbol, position.volume, mark, position.sl)
        reserve = 1 + c["costReservePercent"] / 100
        budget = min(account.equity * c["riskPercent"] / 100,
                     account.equity * c["maxOpenRiskPercent"] / 100 - open_risk * reserve) / reserve
        side = m.ORDER_TYPE_BUY if buy else m.ORDER_TYPE_SELL
        unit_loss = self.loss(side, symbol, info.volume_min, entry, stop) / info.volume_min
        if budget <= 0 or unit_loss <= 0:
            raise Rejected("No remaining risk budget.")
        step = Decimal(str(info.volume_step))
        volume = float((Decimal(str(min(budget / unit_loss, info.volume_max))) / step)
                       .to_integral_value(rounding=ROUND_FLOOR) * step)
        if volume < info.volume_min or self.loss(side, symbol, volume, entry, stop) > budget + 1e-8:
            raise Rejected("Broker minimum volume exceeds risk budget.")
        margin = m.order_calc_margin(side, symbol, volume, entry)
        if not finite(margin) or margin < 0 or margin > account.margin_free * .5:
            raise Rejected("Insufficient margin headroom.")
        filling = m.ORDER_FILLING_FOK if info.filling_mode & 1 else m.ORDER_FILLING_IOC if info.filling_mode & 2 else None
        if filling is None:
            raise Rejected("Symbol does not support FOK or IOC execution.")
        return dict(action=m.TRADE_ACTION_DEAL, symbol=symbol, volume=volume, type=side,
                    price=entry, sl=stop, tp=target, deviation=0, magic=c["magic"],
                    comment="SSD-" + signal["id"][:20], type_time=m.ORDER_TIME_GTC,
                    type_filling=filling)

    def execute(self, symbol, signal):
        signal_id = signal["id"]
        if self.db.execute("SELECT 1 FROM attempts WHERE account=? AND signal=?",
                           (self.account_key, signal_id)).fetchone():
            return "duplicate"
        try:
            request = self.prepare(symbol, signal)
            check = self.mt5.order_check(request)
            if check is None or check.retcode != 0:
                raise Rejected("Broker order_check rejected the request.")
            # Recheck account binding, daily latch and emergency stop immediately before intent.
            fresh = self.prepare(symbol, signal)
            if fresh["volume"] < request["volume"]:
                raise Rejected("Risk budget changed during broker validation.")
        except Rejected as error:
            self.record(signal_id, "skipped", str(error))
            print(f"ROBOT {symbol}: skipped — {error}")
            return "skipped"
        if not self.record(signal_id, "sending", json.dumps(request)):
            return "duplicate"
        try:
            result = self.mt5.order_send(request)
            if result is None or result.retcode not in (self.mt5.TRADE_RETCODE_DONE, self.mt5.TRADE_RETCODE_DONE_PARTIAL):
                detail = f"Broker outcome requires review: {result}"
                self.halt(detail)
                self.record(signal_id, "uncertain", detail)
                print("ROBOT HALTED:", detail)
                return "uncertain"
            # A partial fill is kept as-is; never top up or resend.
            self.record(signal_id, "filled", json.dumps(dict(symbol=symbol, direction=signal["direction"], volume=result.volume, stop=request["sl"], target=request["tp"], result=result._asdict()), default=str))
            print(f"ROBOT {symbol}: filled {result.volume} lots, SL {request['sl']}, TP {request['tp']}")
            return "filled"
        except Exception:
            self.halt("Exception after send intent; inspect broker history before operator recovery.")
            raise

    def record(self, signal_id, status, detail):
        with self.db:
            if status in ("sending", "skipped"):
                result = self.db.execute("INSERT OR IGNORE INTO attempts VALUES (?,?,?,?,?)",
                                         (self.account_key, signal_id, status, detail, self.clock()))
            else:
                result = self.db.execute("UPDATE attempts SET status=?,detail=? WHERE account=? AND signal=? AND status='sending'",
                                         (status, detail, self.account_key, signal_id))
            return result.rowcount == 1

    def observe(self):
        """Observe the daily equity latch each connector cycle, including quiet markets."""
        try:
            self.guard()
            message = "ready"
        except Rejected as error:
            message = str(error)
        if message != getattr(self, "last_status", None):
            print("ROBOT:", message)
            self.last_status = message

    def process(self, snapshot):
        # Only the newest confirmation is actionable; historical backfill is display-only.
        if snapshot["signals"]:
            self.execute(snapshot["symbol"], max(snapshot["signals"], key=lambda s: s["confirmedAt"]))

    def close(self):
        if getattr(self, "closed", False):
            return
        self.closed = True
        if self.remote is not None:
            try:
                self.remote.release()
            except Exception:
                print("App disconnect could not be confirmed. The runner lease will expire automatically.")
        self.db.close()
        self.lock.close()
