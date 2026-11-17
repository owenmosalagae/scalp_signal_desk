# One launcher, one app

## First connection

1. Extract the complete updated runner ZIP. Open MT5 and sign in to the account
   you want to use. Broker passwords stay in MT5.
2. Double-click **start_trading.bat**. The launcher detects Demo or Real from MT5,
   displays the account number and broker, and rejects contest accounts.
3. Press **Enter** to use the displayed watchlist/timeframe, **S** to change them,
   or **Q** to cancel. The first connection can reuse your old shared setup.
4. Complete private-app pairing if requested. Pairing is reused if you opted to
   remember it securely on this Windows account.
5. In the app's **Trading robot** tab, review the detected account, selected markets
   and risk limits. Press Start only when you want automatic entries. Real mode
   still requires the acknowledgement and the account number typed in the app.

Connecting is not starting. Every runner session begins paused. Automatic orders
still require fresh MT5 Scalp Ribbon signals and all broker/risk checks.

## Switch between demo and real

1. Use **Switch account → Pause for switching** in the app. Wait for paused status,
   then stop the runner window with **Ctrl+C**. Positions are not closed.
2. Sign in to the other account in MT5.
3. Run **start_trading.bat** again. Verify the detected account and press Enter.
   Its saved watchlist and limits return. Review them and explicitly Start again.

The updated runner releases its session when closed cleanly; a new session does
not need to wait for the old 45-second lease. If its final network request fails,
that expiry still provides the fallback. An old runner's delayed release cannot
pause or disconnect the new one.

If MT5 changes account while the robot is running, it stops sending entries and
exits. Relaunch to verify the new account. Account switching does not carry trading
authorization across accounts. Uncertain broker outcomes and daily-loss latches
remain separate protections and are not cleared by switching or restarting.

## What is saved

- **On Windows, per account/server/mode:** symbols, timeframe, terminal path and
  remember-pairing preference. These are stored under
  `%LOCALAPPDATA%\ScalpSignalDesk\profiles` with stable hashed filenames.
- **In the private app, per account:** last saved risk limits and
  selected markets. They are saved when Save setup or Start/apply succeeds. Save setup stores preferences without starting or pausing trading. Editing fields alone
  does not save them. Previously used accounts acquire a saved profile the next
  time you apply limits using the updated app.
- **Existing protections:** account-specific trade journals, uncertainty halts and
  daily-loss records remain in place. Never delete robot.sqlite3 to force an entry.
- **Not saved as permission:** the Start authorization and real-money confirmation.
  Restoring preferences never enables orders.

No broker passwords are stored by this feature. The app does not sign MT5 into
another account; it shows the account already connected in MT5. One account/runner
is active at a time. Markets unavailable in that account are skipped.

## Compatibility

Old demo and real launchers still work. The new account-specific watchlist workflow
uses **S in start_trading.bat**. The older configure_windows.bat edits the legacy
shared watchlist; it does not replace an existing account-specific saved setup.
Windows automatic startup remains monitor-only.

The app's three-step strip, account label and Switch account guide explain the
process. Open-position columns now have clear spacing and retain horizontal scroll
on narrow screens. No currently running desktop runner is upgraded automatically;
download and extract the new ZIP, then stop the old runner before launching it.
