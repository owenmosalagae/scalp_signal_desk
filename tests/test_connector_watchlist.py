"""Watchlist setup and isolation of concurrent market reports."""
import copy
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "connector"))
import connector
import preferences
from strategy import DEFAULT_SETTINGS


def arguments(**overrides):
    values = dict(symbol=None, symbols=None, timeframe=None, terminal=None,
                  configure=False, remember_pairing=None)
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeTerminal:
    def __init__(self):
        self.bars = {}
        for symbol, side in [("Step Index", -1), ("Boom 500 Index", 1)]:
            self.bars[symbol] = []
            for i in range(70):
                close = 7300.0 if i < 65 else 7300.0 + side * (i - 60)
                self.bars[symbol].append(dict(time=1700000000 + i * 300, open=close,
                                             high=close + 1, low=close - 1, close=close))
        self.shutdown_called = False
        self.terminal = SimpleNamespace(maxbars=100000, connected=True, path="not-an-installed-test-terminal")
        self.account = SimpleNamespace(server="Test Server", login=1)
        for name in connector.FRAMES:
            setattr(self, "TIMEFRAME_" + name, name)

    def initialize(self, *args, **kwargs):
        return True

    def terminal_info(self):
        return self.terminal

    def account_info(self):
        return self.account

    def symbol_info(self, symbol):
        if symbol in self.bars:
            return SimpleNamespace(trade_tick_size=.1, point=.1, digits=1)
        return None

    def symbol_select(self, symbol, selected):
        return symbol in self.bars

    def copy_rates_from_pos(self, symbol, frame, start, count):
        return self.bars[symbol][-count:]

    def symbol_info_tick(self, symbol):
        bar = self.bars[symbol][-1]
        return SimpleNamespace(time=bar["time"], bid=bar["close"], ask=bar["close"] + .1)

    def shutdown(self):
        self.shutdown_called = True


class WatchlistTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"LOCALAPPDATA": self.directory.name})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def test_symbols_preserve_names_and_remove_duplicates(self):
        self.assertEqual(connector.parse_symbols("Step Index, Boom 500 Index, Step Index"),
                         ["Step Index", "Boom 500 Index"])
        for value in (" , ", [1], ",".join("Symbol" + str(i) for i in range(21))):
            with self.assertRaises(ValueError):
                connector.parse_symbols(value)

    def test_setup_is_saved_and_next_start_needs_no_prompts(self):
        with patch("builtins.input", side_effect=["Step Index, Boom 500 Index", "M5", "y"]):
            first = connector.resolve_profile(arguments())
        with patch("builtins.input", side_effect=AssertionError("Unexpected prompt")):
            second = connector.resolve_profile(arguments())
        self.assertEqual(first, second)
        self.assertEqual(second["symbols"], ["Step Index", "Boom 500 Index"])
        self.assertTrue(second["rememberPairing"])

    def test_unclear_pairing_answer_is_not_saved(self):
        with patch("builtins.input", side_effect=["Step Index", "M5", "maybe"]):
            with self.assertRaisesRegex(ValueError, "Choose Y or N"):
                connector.resolve_profile(arguments())
        self.assertIsNone(preferences.load_profile())

    def test_legacy_single_symbol_flags_remain_supported(self):
        with patch("builtins.input", side_effect=AssertionError("Unexpected prompt")):
            profile = connector.resolve_profile(arguments(symbol="Step Index", timeframe="M5"))
        self.assertEqual(profile["symbols"], ["Step Index"])
        self.assertFalse(profile["rememberPairing"])

    def test_configure_can_replace_a_corrupted_watchlist(self):
        preferences.data_directory().mkdir()
        (preferences.data_directory() / "watchlist.json").write_text("invalid JSON")
        with patch("builtins.input", side_effect=["Step Index", "M15", "n"]):
            profile = connector.resolve_profile(arguments(configure=True))
        self.assertEqual(profile["timeframe"], "M15")
        self.assertFalse(profile["rememberPairing"])

    def test_saved_pairing_avoids_the_browser(self):
        with patch.object(preferences, "load_pairing", return_value="fixture-key"), patch.object(connector, "pair") as browser:
            self.assertEqual(connector.session_token(True), "fixture-key")
            browser.assert_not_called()

    def test_pairing_still_works_when_windows_cannot_save_it(self):
        with patch.object(preferences, "load_pairing", return_value=None),              patch.object(connector, "pair", return_value="fixture-key"),              patch.object(preferences, "save_pairing", side_effect=OSError("fixture protection failure")):
            self.assertEqual(connector.session_token(True), "fixture-key")

    def monitors(self, mt5):
        return connector.create_monitors(mt5, {"symbols": list(mt5.bars), "timeframe": "M5"},
                                         DEFAULT_SETTINGS, "Test Server", mt5.terminal)

    def test_each_market_keeps_its_own_signals_and_prices(self):
        mt5 = FakeTerminal()
        first, second = self.monitors(mt5)
        a = connector.market_snapshot(mt5, first, DEFAULT_SETTINGS, "Test Server")
        b = connector.market_snapshot(mt5, second, DEFAULT_SETTINGS, "Test Server")
        self.assertNotEqual(a["streamId"], b["streamId"])
        self.assertEqual(a["signals"][-1]["direction"], "SELL")
        self.assertEqual(b["signals"][-1]["direction"], "BUY")
        self.assertLess(a["bid"], b["bid"])
        self.assertIsNot(first.pending, second.pending)
        self.assertIsNot(first.trend_cache, second.trend_cache)

    def test_forming_candle_does_not_confirm_a_new_setup(self):
        mt5 = FakeTerminal()
        monitor = self.monitors(mt5)[0]
        original = connector.market_snapshot(mt5, monitor, DEFAULT_SETTINGS, "Test Server")
        saved = copy.deepcopy(original["signals"])
        mt5.bars["Step Index"][-1].update(close=7500.0, high=7501.0)
        forming = connector.market_snapshot(mt5, monitor, DEFAULT_SETTINGS, "Test Server")
        self.assertEqual(forming["signals"], saved)
        self.assertEqual(forming["trends"][0]["state"], "Bearish")
        mt5.bars["Step Index"].append(dict(time=mt5.bars["Step Index"][-1]["time"] + 300,
                                          open=7500., close=7501., high=7502., low=7499.))
        confirmed = connector.market_snapshot(mt5, monitor, DEFAULT_SETTINGS, "Test Server")
        self.assertEqual(confirmed["signals"][-1]["direction"], "BUY")
        self.assertEqual(confirmed["signals"][0], saved[0])

    def test_unavailable_symbols_do_not_discard_valid_markets(self):
        mt5 = FakeTerminal()
        monitors = connector.create_monitors(mt5, {"symbols": ["Missing", "Step Index"], "timeframe": "M5"},
                                              DEFAULT_SETTINGS, "Test Server", mt5.terminal)
        self.assertEqual([monitor.symbol for monitor in monitors], ["Step Index"])

    def test_one_failed_report_does_not_block_other_markets_and_is_retried(self):
        mt5 = FakeTerminal()
        calls = []
        clock = [0]

        def send(site, token, snapshot):
            calls.append(copy.deepcopy(snapshot))
            if len(calls) == 1:
                raise urllib.error.URLError("fixture interruption")

        def sleep(seconds):
            clock[0] += seconds
            if clock[0] >= 20:
                raise KeyboardInterrupt()

        with patch.dict(sys.modules, {"MetaTrader5": mt5}),              patch.object(connector, "session_token", return_value="fixture-key"),              patch.object(connector, "post_snapshot", side_effect=send),              patch.object(connector.time, "monotonic", side_effect=lambda: clock[0]),              patch.object(connector.time, "sleep", side_effect=sleep):
            with self.assertRaises(KeyboardInterrupt):
                connector.run(arguments(symbols="Step Index,Boom 500 Index", timeframe="M5"))
        self.assertEqual([snapshot["symbol"] for snapshot in calls],
                         ["Step Index", "Boom 500 Index", "Step Index", "Boom 500 Index"])
        self.assertEqual(calls[0]["signals"], calls[2]["signals"])
        self.assertEqual(calls[3]["signals"], [])
        self.assertTrue(mt5.shutdown_called)


if __name__ == "__main__":
    unittest.main()
