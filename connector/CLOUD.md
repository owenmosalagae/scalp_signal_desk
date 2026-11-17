# Mobile control and Windows cloud runner

The **Trading robot** tab controls a demo MT5 runner from the app. It shows the
paired account, balance/equity, current account positions, and the last 20 local
execution attempts. Select markets from the runner's saved watchlist, set risk
limits, and press **Start / apply limits**. **Pause new entries** does not liquidate
positions. An in-flight submission may complete after Pause is requested.

## First connection

1. Download the updated connector from the Trading robot tab and extract it.
2. On your Windows PC (for initial testing) or an always-on Windows VPS, install
   64-bit Python 3.12+ and MT5. Sign in to your intended Deriv **demo** account in MT5.
3. Enable Algo Trading and external Python trading in MT5. Run
   `configure_windows.bat` to choose exact MT5 Market Watch symbols and a timeframe.
4. Run **start_robot_cloud.bat** and complete app pairing on that Windows machine.
   This signs the runner into your existing private app; it does not ask the app
   to store your Deriv password. Keep your broker sign-in within MT5.
5. Open Scalp Signal Desk on your phone, select **Trading robot**, inspect the
   account and markets, set limits, and press Start. Confirm the status changes
   from requested to active after the runner's next reports.

This works with a local PC too, but that PC must stay on. To operate when your PC
is off, move these steps to a Windows VPS and keep MT5 and the connector running
there. A VPS has not been purchased, configured or provisioned by this change.
Browser-based app hosting cannot run the Windows MT5 terminal.

The private app continues to require its existing owner sign-in. This is a
single-owner control plane, not a public multi-customer trading service. It
supports **Scalp Ribbon MT5** signals only; Deriv API browser/cloud scanners and
Session FVG do not execute trades through this runner.

## Fail-closed control

- Remote mode starts paused. Every process gets a new runner session ID; a restart
  needs a fresh Start command even when the account is unchanged.
- Start binds the command to the account and runner session currently reporting.
  Commands for another session/account do not authorize new entries.
- One runner holds the server heartbeat lease. Another machine cannot take over
  until the old heartbeat is at least 45 seconds old. Never run independent local
  robots on additional machines against the same account.
- The runner fetches current permission and limits during each entry check; network
  failures, malformed controls, stale heartbeats and disabled markets block new
  entries. The runner does not cache Start authorization for offline trading.
- The app distinguishes requested changes from acknowledged running status. Reports
  normally update each connector cycle, around 10 seconds plus market/API work.
- Pause is accepted even from an out-of-date browser. Start/settings updates require
  the current revision. Changes to risk and markets apply when you press Start.
- Local emergency stop files, duplicate protection, broker checks, demo-only account
  checks and durable uncertainty/daily-loss latches still apply. A remote Start
  cannot clear these local protections.

Existing SL/TP exits remain at the broker if the app, phone, runner or network stops.
No stop can guarantee a loss cap through gaps, slippage and costs. Review the full
risk behavior in ROBOT.md.

`start_robot_demo.bat` is the earlier **local automatic** mode and does not listen
to app Pause. Use **start_robot_cloud.bat** for mobile control. The ordinary
`start_windows.bat` remains monitor only. The existing Windows startup shortcut
also remains monitor only; remote robot startup is explicit in this version.

## Deployment and test notes

The app requires `drizzle/0003_robot_control.sql` and its existing owner-private
authentication. Publishing through the app's existing hosting workflow applies the
migration; an independently hosted backend must apply it too. The Vercel frontend
proxy allows only owner browser access to the robot control route and does not
expose the runner route. Rebuild that frontend to display the new tab there.

Run Python tests and `node tests/robot-api.test.mjs` before deployment. Tests use
simulated brokers and an in-memory SQLite database. Real MT5 execution, Windows
pairing and an actual VPS require forward testing on the intended demo account.

## Separate real-account mode

`start_robot_real.bat` supports a specifically confirmed real MT5 account. See
[REAL_ACCOUNTS.md](REAL_ACCOUNTS.md). The demo launchers in this guide retain their
demo-only behavior; selecting Real money in the app does not change that.
