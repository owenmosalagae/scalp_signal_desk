# Scalp Signal Desk

A personal MT5 signal dashboard by Owen Mosalagae.

Scalp Signal Desk follows a five-EMA ribbon strategy and reports each confirmed
BUY or SELL with its entry, stop loss, three targets, symbol, timeframe and timestamp.
A Windows connector reads prices from the user's running MetaTrader 5 terminal.

[Open the app](https://moss-scalp-signals.owenmosalagae.chatgpt.site)

The deployed app requires the owner's ChatGPT sign-in.

## Features

- Responsive candlestick chart with five EMA lines and a shaded trend ribbon.
- BUY and SELL setups confirmed after the candle closes.
- Fixed entry, stop loss and three take-profit levels for each setup.
- Trend table for the chart timeframe, 15m, 45m, 1h, 4h and 1D.
- Persistent signal history, filters, report copying and CSV export.
- Browser notifications and optional sound while the app is open.
- Windows MT5 connector with encrypted pairing and connection status.
- Retry-safe signal ingestion that preserves the original setup levels.
- Installable mobile web app with home-screen icons.

## Strategy

The defaults match the Scalp_Ribbon_MT5.mq5 indicator included in this project.

| Setting | Default |
| --- | --- |
| EMA periods | 8, 13, 21, 34, 55 |
| ATR period | 14 |
| Stop distance | 1.5 x Wilder ATR |
| Take-profit multiples | 1.5R, 2R, 3R |

A strictly increasing EMA stack confirms a bullish state. A strictly decreasing
stack confirms a bearish state. Mixed alignment is neutral. A new BUY or SELL
confirms when a closed candle first enters an ordered stack from a different state.
Returning from neutral can generate another setup in the same direction.

The entry is the confirmed candle's closing price. The stop distance is rounded
upward to the broker's tradable tick size. Targets are snapped to tradable ticks,
and the original levels remain fixed. The trend table provides context and does
not add a signal filter.

The indicator was reconstructed from a screenshot. Its rules and adjustable defaults
are explicit in this repository because the screenshot did not expose the original source.

## Connect MetaTrader 5

1. Open MT5 on Windows, sign in and load the desired symbol's chart.
2. Install 64-bit Python 3.12 if needed.
3. Download the connector from the app's MT5 connection page, or use the connector directory.
4. Extract the ZIP and double-click start_windows.bat.
5. Enter the exact Market Watch symbol and timeframe, such as XAUUSD and M5.
6. Approve pairing in the browser on that same computer.
7. Keep MT5 and the connector running. Open the app on a phone or computer.

The app shows labelled example data until the first real connector update arrives.
The connector sends snapshots approximately every 10 seconds. Signals received
during a short interruption are retried. On connection it backfills up to 100
historical setups, identified by their original candle time.

Browser alerts require the app to remain open. A fully closed app does not receive
push messages. The connector reports setups without placing trade orders.

Read the complete connector instructions in [connector/README.md](connector/README.md).
Edit connector/settings.json and restart to change the strategy settings.

## Mobile installation

Open the deployed app in Chrome on Android, sign in, and choose the browser's
Install or Add to Home screen option. The Windows connector remains the price source.

## Technology

- React, TypeScript and Vinext
- Cloudflare Workers and D1
- Drizzle ORM and schema migrations
- Python and MetaQuotes' official MetaTrader5 integration
- RSA-OAEP and AES-GCM for connector pairing

## Run the web app locally

Use Node.js 22.13 or newer and the pnpm version declared in package.json.

```sh
pnpm install --frozen-lockfile
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_chemical_speed_demon.sql
pnpm dev
```

The portable development server normally starts at http://localhost:5173.
Its database is local and separate from the deployed app's D1 database.

The deployed version uses ChatGPT Sites' private authentication boundary.
Configure the server-side MT5_SERVICE_TOKEN secret through the hosting environment
to support connector pairing. Credentials stay outside source control.

Publishing a different deployment also requires changing the connector's SITE_URL
and rebuilding public/Scalp_MT5_Connector.zip. Preserve authenticated access around
the API routes when adapting the deployment.

Additional framework details are in [docs/framework-notes.md](docs/framework-notes.md).

## Project structure

| Path | Purpose |
| --- | --- |
| app/ | Dashboard, chart, pairing page and API routes |
| connector/strategy.py | Python port of the indicator calculations |
| connector/connector.py | MT5 connection, encrypted pairing and snapshot delivery |
| indicator/Scalp_Ribbon_MT5.mq5 | Original MT5 reconstruction |
| lib/ | Shared contracts and labelled example data |
| db/ and drizzle/ | Database schema and migrations |
| public/ | App icons, manifest, service worker and connector download |
| .openai/hosting.json | Current deployment identity and storage binding |

## Validation

The Python strategy matched the existing indicator calculations across 157 test
setups using four parameter configurations and multiple tick sizes. TypeScript
checking, production builds, Python syntax checks, API retry tests and encrypted
pairing tests passed during development. Live validation with a Windows MT5
terminal remains required.

## References

- [MetaTrader 5 Python integration](https://www.mql5.com/en/docs/python_metatrader5)
- [MetaTrader 5 candle history API](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py)
