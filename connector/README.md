# Scalp Signal Desk — Windows MT5 connector

1. Open MetaTrader 5 on your Windows computer and sign in to your broker account.
2. Open your gold chart and let its history load. Use the exact symbol from Market Watch.
3. Install 64-bit Python 3.12 or newer from https://www.python.org/downloads/windows/ if needed.
4. Extract the complete ZIP, then double-click start_windows.bat.
5. Enter your symbol and timeframe. Defaults are XAUUSD and M5.
6. A browser opens on the same computer. Sign in using the same ChatGPT account that owns the app, then press "Pair my MT5 connector".
7. Leave the terminal and connector window running. Open the app on your phone or computer.
8. In the app, enable alerts and keep the app open to receive browser notifications. A fully closed app does not receive push messages.

The connector reads OHLC prices and quotes through the official MetaTrader5 Python integration.
Broker passwords stay in your MT5 terminal. Pairing encrypts the app connection credential
for this running connector. The credential stays in memory and is discarded when it exits.
Pair again when restarting. Ctrl+C stops the connector.

If multiple MT5 terminals are installed, run:
.venv\Scripts\python.exe connector.py --terminal "C:\path\terminal64.exe" --symbol XAUUSD --timeframe M5

## Strategy
The calculations follow the supplied Scalp_Ribbon_MT5.mq5 reconstruction.
EMA periods are 8, 13, 21, 34 and 55. A strictly ordered bullish or bearish stack first confirms
a BUY or SELL at the close of a candle. A neutral stack can precede another same-direction signal.
The stop distance is 1.5 times Wilder ATR(14), rounded upward to the symbol tick.
Targets use 1.5R, 2R and 3R, each snapped to a tradable tick. Levels stay fixed for that setup.
Changing settings.json requires restarting. Use the same settings and available price history as
the indicator for parity. Older history or broker corrections can affect the EMA seed.
These are the reconstructed indicator rules. The original screenshot did not expose its source.

M45 is synthesized from M15 buckets anchored to the MT5 timestamps, exactly as in the reconstruction.
All table rows use closed candles. The ribbon also draws the current forming candle.

The connector uploads a snapshot about every 10 seconds. Retry IDs prevent duplicate signal records.
On first connection it also uploads up to 100 historical setups, labelled by their original candle time.
Only recent newly received setups trigger app alerts. No trade orders are placed by this connector.

## Reporting
Each report contains symbol, timeframe, direction, candle time, entry, stop and three targets.
An app badge distinguishes an active connector, stale quotes, and a disconnected connector.
A stale quote can occur when the market is closed. Heartbeats and price timestamps are displayed separately.
The connector must run during the monitoring period. Signals during a short disconnection are retried.
After a restart, historical backfill covers the most recent 100 setups available in MT5.

Sources
https://www.mql5.com/en/docs/python_metatrader5
https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py
