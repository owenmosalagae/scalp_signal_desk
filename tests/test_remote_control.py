import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
from robot import DEFAULTS, Rejected
from remote_control import RemoteControl, event_detail


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.robot=NS(account_key='["Demo",7]',config=dict(DEFAULTS))
        self.remote=RemoteControl('https://desk.test','fixture-token',self.robot,[NS(symbol='XAUUSD')])
        self.response=dict(enabled=True,revision=1,risk={k:DEFAULTS[k] for k in ['riskPercent','dailyLossPercent','maxOpenRiskPercent','maxPositions']},symbols=['XAUUSD'])
        self.remote.request=Mock(return_value=self.response)

    def test_valid_control_updates_risk_and_selected_symbols(self):
        self.response['risk']['riskPercent']=.1
        self.remote.check()
        self.assertTrue(self.remote.running)
        self.assertEqual(self.robot.config['riskPercent'],.1)
        self.assertEqual(self.remote.symbols,['XAUUSD'])

    def test_paused_and_network_error_fail_closed(self):
        self.response['enabled']=False
        with self.assertRaises(Rejected):self.remote.check()
        self.assertFalse(self.remote.running)
        self.remote.request.side_effect=TimeoutError()
        with self.assertRaises(Rejected):self.remote.check()
        self.assertFalse(self.remote.running)

    def test_bad_risk_and_unknown_symbols_fail_closed(self):
        self.response['risk']['riskPercent']=5
        with self.assertRaises(Rejected):self.remote.check()
        self.assertFalse(self.remote.running)
        self.response['symbols']=['Unknown']
        with self.assertRaises(Rejected):self.remote.check()

    def test_old_revision_does_not_reenable_after_pause(self):
        self.remote.revision=5
        with self.assertRaises(Rejected):self.remote.check()
        self.assertFalse(self.remote.running)

    def test_activity_is_readable_without_broker_payloads(self):
        import json
        value=dict(direction='BUY',symbol='XAUUSD',volume=.1,stop=99,target=102,result={'private':'broker-internals'})
        detail=event_detail('filled',json.dumps(value))
        self.assertIn('BUY XAUUSD',detail)
        self.assertNotIn('broker-internals',detail)

    def test_restarts_have_distinct_session_ids(self):
        other=RemoteControl('https://desk.test','fixture-token',self.robot,[])
        self.assertNotEqual(self.remote.runner_id,other.runner_id)


if __name__=='__main__':unittest.main()
