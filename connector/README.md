# Scalp Signal Desk — Windows MT5 connector

One connector monitors a saved watchlist of up to 20 symbols from the connected MT5 terminal.

## First setup

1. Install 64-bit Python 3.12 or newer if needed.
2. Extract the complete ZIP to a folder you will keep.
3. Double-click start_windows.bat.
4. Enter exact Market Watch symbol names separated by commas.
   Example: Step Index, Volatility 75 Index, Boom 500 Index
5. Choose a timeframe. M5 is the default for every symbol in this watchlist.
6. Choose whether Windows should remember pairing.
7. A browser opens on this computer. Sign in with the app owner's ChatGPT account and approve pairing.
8. Leave the connector running and open the app on your phone or computer.

The connector finds or launches MT5 using its official Python integration.
Sign in to your broker through the terminal when needed. Symbols must be available
in that connected account. Unavailable names are reported and skipped while valid markets continue.

## Later starts

Double-click start_windows.bat. The watchlist, timeframe and detected MT5 terminal
path are reused. If you opted to remember pairing, the connector loads the encrypted
credential and starts monitoring without another browser approval.

Run configure_windows.bat to change symbols, timeframe or the remember-pairing choice.
Stop the running connector with Ctrl+C before changing its configuration.
The connector prevents duplicate instances in the same Windows session.

## Optional Windows startup

After completing first setup, run enable_startup.bat to create a shortcut in your
Windows user's Startup folder. It starts the connector minimized when you sign in
to Windows. This starts after user sign-in, not before Windows login.

Keep the extracted folder and its .venv in place. Re-run enable_startup.bat if you move them.
Run disable_startup.bat to remove the shortcut. To see a startup error, stop the
connector if it is running, then run start_windows.bat normally.

## Pairing and saved preferences

Broker passwords remain in MT5. The connector saves your watchlist and terminal
path under %LOCALAPPDATA%\ScalpSignalDesk\watchlist.json.

If you opt in, it saves the app credential in pairing.dat in the same directory,
encrypted using Windows DPAPI with the current user's scope. It does not fall back
to plaintext if Windows protection fails. Pairing is otherwise kept in memory for
the running session.

Run forget_pairing.bat to remove the saved pairing for future starts. Stop and
restart the connector to end its current in-memory session. A rejected or expired
app credential triggers a fresh browser pairing.

## App reports

Use the overview's market dropdown to select a symbol. Each symbol has its own
ribbon state, historical setups, fixed trade levels and retry queue.
A temporarily unavailable market does not prevent other markets from updating.

Snapshots are sent approximately every 10 seconds per polling cycle. A larger
watchlist and slow history or network requests can lengthen a cycle.
Console heartbeat summaries appear approximately once a minute.

The first successful connection backfills up to 100 setups per symbol.
Only recent newly received setups trigger alerts. Keep the app open for browser
notifications. A fully closed app does not receive push messages.
The connector reads market data and reports setups without placing trade orders.

## Strategy

The calculations follow Scalp_Ribbon_MT5.mq5. Defaults are EMA periods 8, 13, 21,
34 and 55, Wilder ATR(14), a stop distance of 1.5 ATR, and targets of 1.5R, 2R and 3R.
A setup confirms when a closed candle first enters a strictly ordered bullish or
bearish stack from a different state. Returning from neutral can generate another
setup in the same direction. Levels are fixed at confirmation and snapped to broker ticks.

Edit settings.json and restart to change strategy settings. Match the indicator's
settings and available price history for parity. The original screenshot did not
expose its source, so these are the explicit reconstruction rules.

The 45-minute row is synthesized from M15 candles. All trend-table rows use closed
candles. The ribbon also draws the current forming candle.

## Command-line options

Single-symbol compatibility:
.venv\Scripts\python.exe connector.py --symbol "Step Index" --timeframe M5

Multiple symbols:
.venv\Scripts\python.exe connector.py --symbols "Step Index,Volatility 75 Index,Boom 500 Index" --timeframe M5

Specific terminal:
.venv\Scripts\python.exe connector.py --terminal "C:\path\terminal64.exe"

Use --configure to edit the saved watchlist. Use --remember-pairing or
--no-remember-pairing to set the pairing preference explicitly.

## History troubleshooting

Requests are capped at 100,000 candles and fall back to smaller requests down to
the strategy's warmup requirement. The successful request size is reused.
Logs show the terminal, broker server, loaded candle count and native MT5 errors.

If history is unavailable, check the logged terminal and the symbol's exact name.
Open its chart and let history load. A shorter history window can affect the EMA
seed and the number of historical setups available.

## Sources

https://www.mql5.com/en/docs/python_metatrader5
https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py
https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
