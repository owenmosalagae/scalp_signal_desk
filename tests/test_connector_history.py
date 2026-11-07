"""Regression coverage for MT5 terminals that reject oversized history reads."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "connector"))
from connector import bars_from_mt5, load_chart_history


class FakeMT5:
    def __init__(self, maximum_request=100000, available=100, error=(-2, "Invalid parameters")):
        self.maximum_request = maximum_request
        self.available = available
        self.error = error
        self.requests = []

    def copy_rates_from_pos(self, symbol, frame, start, count):
        self.requests.append((symbol, frame, start, count))
        if count > self.maximum_request:
            return None
        return [{"time": 1700000000 + i * 300, "open": 7300.0, "high": 7301.0,
                 "low": 7299.0, "close": 7300.5}
                for i in range(min(count, self.available))]

    def last_error(self):
        return self.error


class HistoryTests(unittest.TestCase):
    def test_successful_request_preserves_all_returned_candles(self):
        mt5 = FakeMT5(available=1000)
        bars, request = load_chart_history(mt5, "Step Index", 5, 100000, 57)
        self.assertEqual(request, 100000)
        self.assertEqual(len(bars), 1000)
        self.assertEqual(bars[-1]["time"], 1700000000 + 999 * 300)
        self.assertIsInstance(bars[0]["time"], int)
        self.assertEqual(len(mt5.requests), 1)

    def test_unlimited_chart_setting_is_bounded(self):
        mt5 = FakeMT5()
        load_chart_history(mt5, "Step Index", 5, 2147483647, 57)
        self.assertEqual(mt5.requests[0][3], 100000)

    def test_rejected_large_requests_fall_back_and_reuse_successful_size(self):
        mt5 = FakeMT5(maximum_request=2000)
        bars, request = load_chart_history(mt5, "Step Index", 5, 100000, 57)
        self.assertEqual([r[3] for r in mt5.requests], [100000, 10000, 2000])
        self.assertEqual(len(bars), 100)
        mt5.requests.clear()
        load_chart_history(mt5, "Step Index", 5, request, 57)
        self.assertEqual([r[3] for r in mt5.requests], [2000])

    def test_requests_stay_above_strategy_warmup_and_below_terminal_limit(self):
        mt5 = FakeMT5(maximum_request=602, available=602)
        bars, request = load_chart_history(mt5, "Step Index", 5, 700, 602)
        self.assertEqual([r[3] for r in mt5.requests], [700, 602])
        self.assertEqual(request, 602)
        self.assertEqual(len(bars), 602)

    def test_unavailable_history_reports_native_error_and_request(self):
        mt5 = FakeMT5(maximum_request=0, error=(-4, "No history"))
        with self.assertRaisesRegex(RuntimeError, "Step Index.*57 bars.*-4.*No history"):
            load_chart_history(mt5, "Step Index", 5, 100000, 57)

    def test_recent_candle_failure_keeps_ipc_diagnostics(self):
        mt5 = FakeMT5(maximum_request=0, error=(-10005, "IPC timeout"))
        with self.assertRaisesRegex(RuntimeError, "2 bars.*-10005.*IPC timeout"):
            bars_from_mt5(mt5, "Step Index", 5, 2)

    def test_insufficient_warmup_reports_actual_available_count(self):
        mt5 = FakeMT5(available=20)
        with self.assertRaisesRegex(RuntimeError, "20 candles.*57 are required"):
            load_chart_history(mt5, "Step Index", 5, 100000, 57)
        self.assertEqual(len(mt5.requests), 1)

    def test_insufficient_terminal_limit_is_rejected(self):
        mt5 = FakeMT5()
        with self.assertRaisesRegex(RuntimeError, "at least 57"):
            load_chart_history(mt5, "Step Index", 5, 50, 57)
        self.assertEqual(mt5.requests, [])


if __name__ == "__main__":
    unittest.main()
