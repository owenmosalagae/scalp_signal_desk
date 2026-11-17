# Scalp Signal Desk demo trading robot

This opt-in robot extends the existing paired Windows connector. It calculates the
same **Scalp Ribbon** confirmations shown in the app's **MT5** mode, publishes the
snapshot successfully to the app, then automatically submits eligible new signals
to that Windows MT5 terminal. No trade approval is needed for each signal.

It does not execute the separate browser/cloud Deriv scanner or Session FVG signals.
It never uses example data. Broker passwords remain in MT5. No broker credentials
are sent to the app. The ordinary `start_windows.bat` remains a monitor only.

## Start on Windows

1. Download this branch's complete repository ZIP and extract it. Keep the whole
   `connector` folder together. Stop the old connector window with Ctrl+C first.
2. Open MT5 and sign in to the intended **demo** account. Enable Algo Trading and,
   in Tools → Options → Expert Advisors, allow automated trading through the
   external Python API. Exact labels may differ by terminal version.
3. Run `configure_windows.bat` if needed. Add exact Market Watch names for the
   synthetic indices, forex pairs and gold offered by that account. For example,
   `Volatility 75 Index,EURUSD,XAUUSD` only if those exact names exist. The existing
   watchlist supports up to 20 symbols, all using the chosen timeframe.
4. Review `robot-settings.json`. These are demo engineering defaults, not a
   validated profitable strategy or personalized risk recommendation.
5. Double-click **start_robot_demo.bat**. Complete the existing app pairing if
   requested. Confirm the console says `DEMO ROBOT armed` and the correct broker
   and watchlist. In the app, select MT5 mode and the matching symbol/timeframe.
6. Leave Windows, MT5 and the connector running. It waits for a confirmation
   strictly after the robot started; it never trades the initial historical backfill.

Some brokers separate synthetic and financial markets into different accounts.
Only symbols offered in the currently connected account can trade. Changing the
MT5 account stops the robot and requires review and a new launch. This version
runs one robot per Windows profile; it does not coordinate different computers.
Use a dedicated demo account and one execution machine.

## Default controls

| Setting | Default behavior |
| --- | --- |
| Account | Demo only; real and contest accounts are rejected |
| Risk per new trade | 0.25% of current equity, with 10% of calculated stop risk reserved for costs |
| Aggregate open risk | Up to 1% of current equity, including manual positions and the reserve |
| Open positions | At most 3 account positions; at most one per symbol |
| Pending orders | New entries blocked while any pending account order exists |
| Unprotected positions | New entries blocked while any account position has no stop-loss |
| Daily equity loss | 2% below equity first observed by the robot that UTC day; latched for that day |
| Signal freshness | At most 30 seconds old and confirmed after this launch |
| Quote freshness | At most 10 seconds old |
| Spread | At most 0.10 × the signal's entry-to-stop distance |
| Entry drift | At most 0.20 × that distance, in either direction |
| Exit | Original fixed signal stop and **first** target (default 1.5R); no trailing or partial exits |
| Volume | Rounded down to the broker's lot step; skipped if the minimum lot is too large |
| Margin | Required margin must fit within half the available free margin |
| Execution | Broker order_check, FOK/IOC as supported, no automatic order retries |

The daily baseline is first observed equity, not reconstructed midnight equity.
The connector observes equity approximately each polling cycle; deposits,
withdrawals and other trading affect it. A daily stop blocks **new entries**,
without liquidating existing positions. The latch persists across restarts and
resets when the next UTC day's baseline is first observed. Stop-loss and take-profit
are sent with each order and remain at the broker when this connector stops.

Sizing estimates loss at the requested stop, using the broker's profit calculator
in account currency. Slippage, gaps and costs can exceed the estimate and daily
limit. A risk limit is not a guaranteed maximum loss. The polling loop can take
longer than ten seconds on large or slow watchlists, causing fresh signals to be
skipped. Prefer a small watchlist during initial tests.

## Stop and inspect

**Ctrl+C** stops the connector and prevents further submissions. It does not close
positions. To block new orders while leaving monitoring running, create an empty
file named `ROBOT_STOP` (no extension) inside:

`%LOCALAPPDATA%\ScalpSignalDesk\`

The console prints the exact path. PowerShell:

```powershell
New-Item -ItemType File -Force "$env:LOCALAPPDATA\ScalpSignalDesk\ROBOT_STOP"
```

Delete that file to permit future new signals again. Signals skipped while stopped
are not replayed. An order already submitted cannot be recalled by this file.
Close positions manually in MT5 if desired.

The console shows fills, skips and halt reasons. The execution journal is
`%LOCALAPPDATA%\ScalpSignalDesk\robot.sqlite3`; it contains account identity, signal
IDs, requests and results, never passwords. Keep it in place across upgrades.
Local mode displays execution results in the connector and MT5. For app-side
controls and execution reporting, use `start_robot_cloud.bat` and read [CLOUD.md](CLOUD.md).

If an order returns an unclear result or the process crashes after recording send
intent, the robot durably blocks new orders. Inspect MT5 orders/deals/history and
the journal before operator recovery. Do not delete the journal to bypass this:
it holds duplicate protection and daily limits. There is no automatic recovery or
resend, including after a partial fill. Bring the halt details back for diagnosis.

Windows automatic startup still launches **monitor-only** mode. Launch the robot
explicitly each session using `start_robot_demo.bat`.

## Demo verification before considering real-account support

- Confirm ordinary start mode never calls order_send.
- Confirm historical signals do not open trades.
- Wait for a new BUY and SELL; compare the app's MT5 signal with the MT5 deal,
  original SL and first target, lot size, and journal status.
- Restart after a fill and verify there is no duplicate.
- Verify stop-file behavior and test an unaffordable minimum lot on demo.
- Verify behavior for your actual synthetic, forex and gold contracts. A fake broker
  test cannot establish broker-specific execution support or profitability.

The demo launchers remain demo-only. A separate explicit real-account launcher is
available; read [REAL_ACCOUNTS.md](REAL_ACCOUNTS.md) before using it.
Real-mode validation uses a simulated broker and does not establish live readiness.

## Developer checks

```sh
python -m unittest discover -s tests -p 'test_*.py'
```

Tests use a fake broker and exercise sizing, shared exposure, demo/account checks,
freshness, broker rejection, partial fill, persistent duplicates, crash uncertainty,
emergency stop and daily latches. Windows DPAPI tests require Windows.

Official API references:
- https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5ordercalcprofit_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py
