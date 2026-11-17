# Real MT5 accounts

For easier account switching, use [Quick start](QUICK_START.md) and
`start_trading.bat`. It detects and pins the real account automatically; the app
still requires the same real-money confirmation before Start. The explicit legacy
real launcher below remains supported.

Real-account support is an explicit, separate mode. The normal demo launchers still
reject real accounts, and contest accounts remain blocked. One MT5 account and one
runner can be active at a time; this version does not trade multiple accounts in
parallel. Your broker password stays inside MT5.

## Connect a real account without starting orders

1. Pause new entries in the app and stop the existing connector with Ctrl+C.
   Pausing/stopping does not close existing positions.
2. Download the latest runner ZIP from the app and extract the whole folder. Keep
   the persistent journal in `%LOCALAPPDATA%\ScalpSignalDesk` in place. Do not delete
   it during upgrades; it holds duplicate checks and daily-loss/uncertainty latches.
3. Sign in to the intended real account inside MT5. Enable Algo Trading and external
   Python trading. Confirm that the broker permits automated trading on that account.
4. Run `configure_windows.bat` if the market names differ from your demo account.
   Stop its monitor with Ctrl+C after configuration.
5. Run **start_robot_real.bat**. Enter the exact MT5 real account number when asked.
   This is an account identifier, not your password. The launcher passes it through
   its process environment; it does not save it in a configuration file.
6. Complete the existing private-app pairing if needed. The runner starts paused.
   A previous runner's heartbeat lease can take up to 45 seconds to expire.
7. Open Trading robot in the app. Verify **REAL ACCOUNT · REAL MONEY**, the broker
   server, account number, currency, markets and current positions. Connecting and
   viewing reports does not place an order.

## Explicitly start automatic real trading

Select Real money mode and your markets, review the risk limits, check the real-money
acknowledgement, and type the displayed MT5 account number. Only then can you press
**Start real trading / apply limits**. This action authorizes automatic future orders
on that account. Each process restart clears the runner binding, and you must issue
Start again. A demo Start command cannot authorize real orders.

Risk fields are the same engineering controls used in demo, not a guarantee or a
recommendation for your finances. Demo connectivity and passing software tests do
not establish profitability or real-broker compatibility. The robot sizes using
current equity and broker contract specifications; actual fills, gaps, commissions
and slippage can exceed the estimated loss. Small accounts can be skipped when the
broker's minimum lot exceeds the permitted risk. Do not raise risk merely to force
an order to happen.

The following protections remain in both modes: only fresh MT5 Scalp Ribbon signals,
original stop and first target, spread and entry drift checks, conservative lot
rounding, total account exposure, pending/unprotected-position checks, daily equity
loss latch, broker preflight, account binding, duplicate journal, emergency stop
file and a halt after uncertain order outcomes. Real entries always require a current
app permission check; offline/local-only real execution is blocked.

Pause blocks new entries and leaves positions and broker exits in place. Orders
already in flight may finish. Close positions in MT5 yourself if desired. Switching
MT5 accounts terminates the runner instead of transferring authorization. To return
to demo, stop it, switch MT5 to demo, and use `start_robot_cloud.bat`.

Real and demo execution journals/latches are isolated. Legacy demo journal keys are
preserved. The existing Windows startup shortcut remains monitor-only; it cannot
start real trading unattended.

## Validation scope

Real-mode tests use a simulated MT5 broker. No actual real account, broker password
or real order is used during development. Verify the exact downloaded runner and
broker behavior on demo before making your own decision to enable real trading.
