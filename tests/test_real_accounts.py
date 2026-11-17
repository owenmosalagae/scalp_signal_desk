"""Account-mode coverage; fake broker only, no real terminal or credentials."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock
from test_robot import Broker
from robot import DEFAULTS, Robot, Rejected
from remote_control import RemoteControl


class RealAccountTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.broker=Broker()
        self.broker.account.trade_mode=2
        self.now=1000
        self.robots=[]
        self.signal=dict(id='a'*64,confirmedAt=1005,direction='BUY',entry=100.,stop=99.,targets=[101.5,102.,103.])

    def tearDown(self):
        for robot in self.robots:robot.close()
        self.tmp.cleanup()

    def real(self, **kwargs):
        args=dict(account_mode='real',expected_login='7',clock=lambda:self.now)
        args.update(kwargs)
        robot=Robot(self.broker,dict(DEFAULTS),self.tmp.name,**args)
        self.robots.append(robot)
        return robot

    def authorize(self, robot):
        remote=RemoteControl('https://desk.test','fixture',robot,[NS(symbol='XAUUSD')])
        remote.request=Mock(return_value=dict(enabled=True,revision=1,accountMode='real',symbols=['XAUUSD'],
                            risk={key:DEFAULTS[key] for key in ('riskPercent','dailyLossPercent','maxOpenRiskPercent','maxPositions')}))
        robot.remote=remote
        self.now=1010
        return remote

    def test_default_demo_launcher_never_accepts_real_account(self):
        with self.assertRaises(Rejected):Robot(self.broker,dict(DEFAULTS),self.tmp.name)
        self.assertFalse(self.broker.sent)

    def test_missing_wrong_or_malformed_login_blocks_real_initialization(self):
        for login in [None,'8','7 & command','７']:
            with self.assertRaises(Rejected):self.real(expected_login=login)
        self.assertFalse(self.broker.sent)

    def test_real_launcher_rejects_demo_and_contest_accounts(self):
        for mode in [0,1,999]:
            self.broker.account.trade_mode=mode
            with self.assertRaises(Rejected):self.real()
        self.assertFalse(self.broker.sent)

    def test_real_requires_fresh_app_authorization(self):
        robot=self.real();self.now=1010
        self.assertEqual(robot.execute('XAUUSD',self.signal),'skipped')
        self.assertFalse(self.broker.sent)

    def test_real_mode_cannot_use_demo_or_legacy_permission(self):
        robot=self.real();remote=self.authorize(robot)
        remote.request.return_value.pop('accountMode')
        self.assertEqual(robot.execute('XAUUSD',self.signal),'skipped')
        self.assertFalse(self.broker.sent)

    def test_simulated_real_fill_keeps_volume_stop_target_and_duplicate_controls(self):
        robot=self.real();self.authorize(robot)
        self.assertEqual(robot.execute('XAUUSD',self.signal),'filled')
        order=self.broker.sent[0]
        self.assertEqual((order['volume'],order['sl'],order['tp']),(.22,99.,101.5))
        self.assertEqual(robot.execute('XAUUSD',self.signal),'duplicate')
        self.assertEqual(len(self.broker.sent),1)
        self.assertTrue(robot.account_key.endswith('"real"]'))

    def test_account_switch_before_broker_send_blocks(self):
        robot=self.real();self.authorize(robot)
        self.broker.after_check=lambda:setattr(self.broker.account,'login',8)
        self.assertEqual(robot.execute('XAUUSD',self.signal),'skipped')
        self.assertFalse(self.broker.sent)

    def test_real_daily_limit_still_blocks_new_orders(self):
        robot=self.real();self.authorize(robot)
        self.broker.account.equity=9700
        self.assertEqual(robot.execute('XAUUSD',self.signal),'skipped')
        self.assertFalse(self.broker.sent)

    def test_remote_pause_and_network_loss_block_real_orders(self):
        robot=self.real();remote=self.authorize(robot)
        remote.request.return_value['enabled']=False
        self.assertEqual(robot.execute('XAUUSD',self.signal),'skipped')
        self.signal['id']='b'*64
        remote.request.side_effect=TimeoutError()
        self.assertEqual(robot.execute('XAUUSD',self.signal),'skipped')
        self.assertFalse(self.broker.sent)


if __name__=='__main__':unittest.main()
