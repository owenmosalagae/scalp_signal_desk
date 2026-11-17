"""Execution tests use a fake MT5 broker; no credentials or orders leave the process."""
import json
import sys
import tempfile
import unittest
from collections import namedtuple
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'connector'))
from robot import DEFAULTS, Robot, Rejected, load_config

Result = namedtuple('Result', 'retcode volume order')


class Broker:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_REAL = 2
    ORDER_TYPE_BUY = POSITION_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    ORDER_TIME_GTC = 0
    TRADE_ACTION_DEAL = 1
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_DONE_PARTIAL = 10010

    def __init__(self):
        self.account = NS(server='Demo', login=7, trade_mode=0, trade_allowed=True,
                          trade_expert=True, equity=10000., margin_free=10000.)
        self.terminal = NS(connected=True, trade_allowed=True, tradeapi_disabled=False)
        self.info = NS(point=.01, trade_tick_size=.01, volume_min=.01,
                       volume_max=100., volume_step=.01, filling_mode=3, trade_stops_level=10)
        self.quote = NS(time=1010, bid=100., ask=100.02)
        self.positions, self.orders, self.sent = [], [], []
        self.result = Result(self.TRADE_RETCODE_DONE, .22, 123)
        self.check_code = 0
        self.after_check = lambda: None

    def account_info(self): return self.account
    def terminal_info(self): return self.terminal
    def symbol_info(self, symbol): return self.info
    def symbol_info_tick(self, symbol): return self.quote
    def positions_get(self): return self.positions
    def orders_get(self): return self.orders
    def order_calc_profit(self, side, symbol, volume, entry, stop):
        return (stop - entry) * (1 if side == 0 else -1) * volume * 100
    def order_calc_margin(self, *args): return 100.
    def order_check(self, request):
        self.after_check()
        return NS(retcode=self.check_code)
    def order_send(self, request):
        self.sent.append(request)
        return self.result


class RobotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.broker = Broker()
        self.now = 1000.
        self.robot = Robot(self.broker, dict(DEFAULTS), self.tmp.name, lambda: self.now)
        self.now = 1010.
        self.signal = dict(id='a'*64, confirmedAt=1005, direction='BUY', entry=100., stop=99.,
                           targets=[101.5, 102., 103.])

    def tearDown(self):
        self.robot.close()
        self.tmp.cleanup()

    def execute(self): return self.robot.execute('XAUUSD', self.signal)
    def test_order_has_protection_and_volume_is_rounded_down(self):
        self.assertEqual(self.execute(), 'filled')
        order = self.broker.sent[0]
        self.assertEqual(order['volume'], .22)
        self.assertEqual((order['sl'], order['tp']), (99., 101.5))
        self.assertLessEqual(abs(self.broker.order_calc_profit(0, 'XAUUSD', order['volume'],
                                                              order['price'], order['sl'])) * 1.1, 25)

    def test_sell_uses_bid_and_sell_side_risk(self):
        self.signal.update(direction='SELL', stop=101., targets=[98.5, 98., 97.])
        self.assertEqual(self.execute(), 'filled')
        self.assertEqual(self.broker.sent[0]['type'], 1)
        self.assertEqual(self.broker.sent[0]['price'], 100.)

    def test_duplicate_is_persistent_after_restart(self):
        self.execute()
        self.robot.close()
        self.robot = Robot(self.broker, dict(DEFAULTS), self.tmp.name, lambda: self.now)
        self.assertEqual(self.execute(), 'duplicate')
        self.assertEqual(len(self.broker.sent), 1)

    def test_no_backfill_or_pre_start_trade(self):
        self.signal['confirmedAt'] = 999
        self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_expired_and_future_signals(self):
        for timestamp in [1001, 1100]:
            self.now = 1040
            self.signal.update(id=str(timestamp), confirmedAt=timestamp)
            self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_no_minimum_lot_round_up(self):
        self.broker.info.volume_min = 1
        self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_manual_unprotected_position_blocks_entries(self):
        self.broker.positions = [NS(symbol='EURUSD', sl=0)]
        self.assertEqual(self.execute(), 'skipped')

    def test_manual_exposure_counts_toward_total_budget(self):
        self.broker.positions = [NS(symbol='EURUSD', sl=99., volume=1., type=0)]
        self.assertEqual(self.execute(), 'skipped')

    def test_null_exposure_query_and_pending_orders_block(self):
        self.broker.positions = None
        self.assertEqual(self.execute(), 'skipped')
        self.signal['id'] = 'b'*64
        self.broker.positions = []
        self.broker.orders = [NS(ticket=1)]
        self.assertEqual(self.execute(), 'skipped')

    def test_daily_limit_is_latched_across_recovery_and_restart(self):
        self.broker.account.equity = 9799
        with self.assertRaises(Rejected): self.robot.guard()
        self.broker.account.equity = 11000
        self.robot.close()
        with self.assertRaises(Rejected):
            Robot(self.broker, dict(DEFAULTS), self.tmp.name, lambda: self.now)

    def test_real_account_and_account_switch_are_blocked(self):
        self.broker.account.trade_mode = 2
        self.assertEqual(self.execute(), 'skipped')
        self.broker.account.trade_mode = 0
        self.broker.account.login = 8
        self.signal['id'] = 'b'*64
        self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_stop_file_checked_after_broker_check(self):
        self.broker.after_check = lambda: self.robot.stop_file.touch()
        self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_uncertain_send_halts_all_later_entries(self):
        self.broker.result = None
        self.assertEqual(self.execute(), 'uncertain')
        self.signal['id'] = 'b'*64
        self.assertEqual(self.execute(), 'skipped')
        self.assertEqual(len(self.broker.sent), 1)

    def test_crash_after_intent_is_detected_on_restart(self):
        self.robot.record(self.signal['id'], 'sending', '{}')
        self.robot.close()
        with self.assertRaises(Rejected):
            Robot(self.broker, dict(DEFAULTS), self.tmp.name, lambda: self.now)
        self.assertFalse(self.broker.sent)

    def test_partial_fill_is_not_topped_up(self):
        self.broker.result = Result(10010, .1, 123)
        self.assertEqual(self.execute(), 'filled')
        self.assertEqual(self.execute(), 'duplicate')
        self.assertEqual(len(self.broker.sent), 1)

    def test_spread_drift_and_stale_quote_block(self):
        for i, (bid, ask, timestamp) in enumerate([(100., 100.5, 1010), (100.5, 100.52, 1010),
                                                  (100., 100.02, 900)]):
            self.signal['id'] = str(i)
            self.broker.quote = NS(bid=bid, ask=ask, time=timestamp)
            self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_order_check_rejection_does_not_send(self):
        self.broker.check_code = 10019
        self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_all_market_names_pass_through_unchanged(self):
        for i, symbol in enumerate(['Volatility 75 Index', 'EURUSD', 'XAUUSD']):
            self.signal['id'] = str(i)
            self.assertEqual(self.robot.execute(symbol, self.signal), 'filled')
            self.assertEqual(self.broker.sent[-1]['symbol'], symbol)

    def test_other_robot_cannot_acquire_profile_lock(self):
        with self.assertRaisesRegex(Rejected, "execution lock"):
            Robot(self.broker, dict(DEFAULTS), self.tmp.name, lambda: self.now)
        self.assertEqual(self.execute(), 'filled')

    def test_quiet_market_observation_latches_daily_loss(self):
        self.broker.account.equity = 9799
        self.robot.observe()
        self.broker.account.equity = 10000
        self.assertEqual(self.execute(), 'skipped')

    def test_daily_latch_resets_on_next_utc_day(self):
        self.broker.account.equity = 9799
        self.robot.observe()
        self.now += 86400
        self.robot.guard()

    def test_broker_minimum_stop_and_margin_are_checked(self):
        self.broker.info.trade_stops_level = 200
        self.assertEqual(self.execute(), 'skipped')
        self.broker.info.trade_stops_level = 10
        self.broker.account.margin_free = 100
        self.signal['id'] = 'b'*64
        self.assertEqual(self.execute(), 'skipped')
        self.assertFalse(self.broker.sent)

    def test_invalid_settings_fail_closed(self):
        path = Path(self.tmp.name) / 'settings.json'
        for config in [{**DEFAULTS, 'riskPercent': float('nan')}, {**DEFAULTS, 'maxPositions': 1.5},
                       {**DEFAULTS, 'riskPercent': 2}, {'riskPercent': .25}]:
            path.write_text(json.dumps(config))
            with self.assertRaises(ValueError): load_config(path)


if __name__ == '__main__': unittest.main()
