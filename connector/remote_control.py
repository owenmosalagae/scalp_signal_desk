"""Owner-private app control for a Windows/VPS account-bound runner; fail closed on errors."""
import json
import time
import urllib.parse
import urllib.request
import uuid

from robot import Rejected, validate_config


def event_detail(status, detail):
    if status == 'filled':
        try:
            value = json.loads(detail)
            return (f"{value['direction']} {value['symbol']} · {value['volume']} lots · "
                    f"stop {value['stop']} · target {value['target']}")
        except (ValueError, KeyError, TypeError):
            return 'Filled. Review the deal in MT5.'
    if status == 'sending':
        return 'Submission recorded. Broker outcome needs verification before any retry.'
    return detail[:800]


class RemoteControl:
    def __init__(self, site, token, robot, monitors):
        self.site, self.token, self.robot, self.monitors = site, token, robot, monitors
        self.runner_id = str(uuid.uuid4())  # restart always needs a new Start command
        self.revision, self.running = 0, False
        self.symbols = []
        self.mode = getattr(robot, "account_mode", "demo")

    def request(self, path, body=None, method=None):
        payload = None if body is None else json.dumps(body, allow_nan=False).encode()
        request = urllib.request.Request(self.site + path, data=payload, headers={
            'OAI-Sites-Authorization': 'Bearer ' + self.token,
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'Cache-Control': 'no-store',
        }, method=method)
        started = time.monotonic()
        with urllib.request.urlopen(request, timeout=5) as response:
            result = json.loads(response.read(50000))
        if time.monotonic() - started > 5:
            raise Rejected('App control response took too long.')
        return result

    def check(self):
        self.running = False
        query = urllib.parse.urlencode(dict(runnerId=self.runner_id, accountKey=self.robot.account_key))
        try:
            result = self.request('/api/robot/runner?' + query)
            if type(result.get('revision')) is not int or result['revision'] < self.revision:
                raise Rejected('Stale app control revision.')
            self.revision = result['revision']
            if result.get('enabled') is not True:
                raise Rejected('Paused in app. Open Trading robot and start this runner.')
            if self.mode == 'real' and result.get('accountMode') != 'real':
                raise Rejected('Real account has not been explicitly confirmed in the app.')
            if self.mode == 'demo' and result.get('accountMode', 'demo') != 'demo':
                raise Rejected('App permission targets a different account mode.')
            symbols = result['symbols']
            if not isinstance(symbols, list) or not symbols or any(s not in [m.symbol for m in self.monitors] for s in symbols):
                raise Rejected('Remote markets do not match this runner watchlist.')
            self.symbols = symbols
            risk = result['risk']
            keys = {'riskPercent', 'dailyLossPercent', 'maxOpenRiskPercent', 'maxPositions'}
            if set(risk) != keys:
                raise Rejected('Invalid remote risk settings.')
            merged = {**self.robot.config, **risk}
            validate_config(merged)
            self.robot.config.update(merged)
            self.running = True
        except Rejected:
            raise
        except Exception as error:
            raise Rejected('App control unavailable; new entries blocked.') from error

    def release(self):
        return self.request('/api/robot/runner', dict(runnerId=self.runner_id, accountKey=self.robot.account_key), method='DELETE')

    def heartbeat(self):
        r, m = self.robot, self.robot.mt5
        account = m.account_info()
        r.check_account(account)
        if (account.server, account.login) != r.identity:
            raise Rejected('Runner account changed.')
        positions = m.positions_get()
        if positions is None:
            raise Rejected('Cannot report account positions.')
        rows = r.db.execute('SELECT signal,status,detail,created FROM attempts WHERE account=? ORDER BY created DESC LIMIT 20',
                            (r.account_key,)).fetchall()
        return self.request('/api/robot/runner', dict(
            runnerId=self.runner_id, accountKey=r.account_key, demo=self.mode == "demo", accountMode=self.mode, protocolVersion=2, login=str(account.login),
            server=account.server, currency=account.currency, equity=account.equity, balance=account.balance,
            symbols=[monitor.symbol for monitor in self.monitors], timeframe=self.monitors[0].timeframe,
            status=getattr(r, 'last_status', 'Waiting for app Start command.'),
            revision=self.revision, running=self.running and getattr(r, 'last_status', '') == 'ready',
            positions=[dict(ticket=str(p.ticket), symbol=p.symbol, side='BUY' if p.type == m.POSITION_TYPE_BUY else 'SELL',
                            volume=p.volume, profit=p.profit, stop=p.sl, target=p.tp) for p in positions][:100],
            events=[dict(id=row[0], status=row[1], detail=event_detail(row[1], row[2]), time=row[3]) for row in rows],
        ))
