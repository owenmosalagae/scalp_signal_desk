import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
import connector
import preferences
from robot import Robot, Rejected, DEFAULTS
from test_robot import Broker


class EasyStartTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'LOCALAPPDATA':self.tmp.name})
        self.env.start()
        self.account=NS(server='Server',login=7,trade_mode=0)
        self.mt5=NS(ACCOUNT_TRADE_MODE_DEMO=0,ACCOUNT_TRADE_MODE_REAL=2,account_info=lambda:self.account)
        self.profile=dict(symbols=['EURUSD'],timeframe='M5',terminal=None,rememberPairing=True)
        self.args=NS(symbol=None,symbols=None,timeframe=None,terminal=None,configure=False,remember_pairing=None)

    def tearDown(self):
        self.env.stop();self.tmp.cleanup()

    def test_detect_demo_and_save_preferences_without_enabling_trades(self):
        with patch('builtins.input',return_value=''):
            result=connector.easy_account_setup(self.mt5,self.account,self.args,self.profile)
        self.assertEqual(self.args.account_mode,'demo')
        self.assertEqual(self.args.account_login,'7')
        self.assertTrue(self.args.remote_control)
        self.assertEqual(result['symbols'],['EURUSD'])
        self.assertEqual(preferences.load_account_profile('Server',7,'demo')['timeframe'],'M5')

    def test_saved_real_watchlist_is_restored_separately(self):
        self.account.trade_mode=2
        preferences.save_account_profile('Server',7,'real',{**self.profile,'symbols':['XAUUSDmicro']})
        preferences.save_account_profile('Server',7,'demo',{**self.profile,'symbols':['EURUSD']})
        with patch('builtins.input',return_value=''):
            result=connector.easy_account_setup(self.mt5,self.account,self.args,self.profile)
        self.assertEqual(result['symbols'],['XAUUSDmicro'])
        self.assertEqual(self.args.account_mode,'real')
        self.assertEqual(preferences.load_account_profile('Server',7,'demo')['symbols'],['EURUSD'])

    def test_change_markets_option_updates_only_selected_profile(self):
        with patch('builtins.input',side_effect=['s','USDJPY','M15','n']):
            result=connector.easy_account_setup(self.mt5,self.account,self.args,self.profile)
        self.assertEqual(result['symbols'],['USDJPY'])
        self.assertEqual(result['timeframe'],'M15')

    def test_cancel_unknown_choice_and_contest_do_not_connect(self):
        with patch('builtins.input',return_value='q'):
            with self.assertRaises(KeyboardInterrupt):connector.easy_account_setup(self.mt5,self.account,self.args,self.profile)
        with patch('builtins.input',return_value='bad'):
            with self.assertRaises(ValueError):connector.easy_account_setup(self.mt5,self.account,self.args,self.profile)
        self.account.trade_mode=1
        with self.assertRaises(ValueError):connector.easy_account_setup(self.mt5,self.account,self.args,self.profile)

    def test_account_change_during_prompt_blocks(self):
        def answer(_):
            self.mt5.account_info=lambda:NS(server='Other',login=8,trade_mode=0)
            return ''
        with patch('builtins.input',side_effect=answer):
            with self.assertRaises(RuntimeError):connector.easy_account_setup(self.mt5,self.account,self.args,self.profile)

    def test_saved_profile_does_not_contain_password_or_trading_permission(self):
        preferences.save_account_profile('Server',7,'demo',{**self.profile,'password':'secret','enabled':True})
        value=preferences.load_account_profile('Server',7,'demo')
        self.assertNotIn('password',value);self.assertNotIn('enabled',value)

    def test_only_legacy_account_switch_halt_is_retired(self):
        directory=Path(self.tmp.name)/'robot';m=Broker()
        robot=Robot(m,dict(DEFAULTS),directory)
        reason='MT5 account changed during robot execution. Inspect account and restart after review.'
        robot.halt(reason);robot.close()
        robot=Robot(m,dict(DEFAULTS),directory)
        robot.record('a'*64,'sending','{}');robot.record('a'*64,'uncertain','unknown broker result')
        robot.halt(reason);robot.close()
        with self.assertRaises(Rejected):Robot(m,dict(DEFAULTS),directory)

    def test_close_releases_remote_runner_only_once(self):
        m=Broker();robot=Robot(m,dict(DEFAULTS),Path(self.tmp.name)/'robot')
        remote=Mock();robot.remote=remote
        robot.close();robot.close()
        remote.release.assert_called_once()


if __name__=='__main__':unittest.main()
