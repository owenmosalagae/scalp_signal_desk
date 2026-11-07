# Scalp Signal Desk

A personal Deriv and MT5 signal dashboard by Owen Mosalagae.

Scalp Signal Desk follows a five-EMA ribbon strategy and reports each confirmed
BUY or SELL with its entry, stop loss, three targets, symbol, timeframe and timestamp.
Direct Deriv mode discovers synthetic and forex markets and streams candles in an open app window. An optional cloud runner supports scanning while devices are off. The Windows MT5 connector remains available for broker-terminal prices.

[Open the app](https://moss-scalp-signals.owenmosalagae.chatgpt.site)

The deployed app requires the owner's ChatGPT sign-in.

## Direct Deriv mode

Open **Markets & connection** in the app. The default is all API-available synthetic indices and forex pairs on M5. Choose either category or a custom watchlist, choose the timeframe, then save. Names and symbol codes are discovered from Deriv rather than entered manually. The checked catalogue returned 46 synthetic indices and 25 forex pairs during validation; availability is refreshed dynamically.

No MT5 terminal, Python installation or Deriv login is required for public data. The app uses 1,000 API candles per timeframe, then streams updates. Initial history and trend-table warmup across all markets takes several minutes. API prices, history seeds and precision can differ from MT5, so the source is labelled per stream. Closed markets retain their history until reopening.

**Current execution modes:** app scanning requires an open, active browser. The optional cloud runner is prepared but must be deployed to a continuously running host before it can scan while the app is closed. See [cloud-runner/README.md](cloud-runner/README.md) and the optional paid Render blueprint in [render.yaml](render.yaml). Deploying this dashboard alone does not deploy that worker.

Both modes record confirmed setups. Background notifications for a fully closed phone app are not implemented; alerts and sounds require an open app.

## Features

- Responsive candlestick chart with five EMA lines and a shaded trend ribbon.
- BUY and SELL setups confirmed after the candle closes.
- Fixed entry, stop loss and three take-profit levels for each setup.
- Trend table for the chart timeframe, 15m, 45m, 1h, 4h and 1D.
- Persistent signal history, filters, report copying and CSV export.
- Browser notifications and optional sound while the app is open.
- Automatic Deriv synthetic/forex discovery, category selection and custom watchlists.
- Shared browser/cloud EMA and ATR engine with exclusive scanner ownership.
- All-market signal history and source-labelled chart selection.
- One Windows MT5 connector for a saved watchlist of up to 20 symbols.
- Optional user-scoped Windows encryption for remembered pairing.
- Optional minimized startup when signing in to Windows.
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

A stack ordered from fastest EMA above each slower EMA confirms a bullish state.
The inverse ordering confirms a bearish state. Mixed alignment is neutral. A new BUY or SELL
confirms when a closed candle first enters an ordered stack from a different state.
Returning from neutral can generate another setup in the same direction.

The entry is the confirmed candle's closing price. The stop distance is rounded
upward to the source's price increment (MT5 tradable tick size or Deriv API precision). Targets are snapped to tradable ticks,
and the original levels remain fixed. The trend table provides context and does
not add a signal filter.

The indicator was reconstructed from a screenshot. Its rules and adjustable defaults
are explicit in this repository because the screenshot did not expose the original source.

## Connect MetaTrader 5

1. Open MT5 on Windows, sign in and load the desired symbol's chart.
2. Install 64-bit Python 3.12 if needed.
3. Download the connector from the app's MT5 connection page, or use the connector directory.
4. Extract the ZIP and double-click start_windows.bat.
5. Enter comma-separated Market Watch names, such as Step Index, Volatility 75 Index, Boom 500 Index.
6. Choose one timeframe for the watchlist, then choose whether to remember pairing securely.
7. Approve the first pairing in the browser on that computer. Later starts reuse the saved setup.
8. Keep the connector running and select markets from the app dropdown.

Use configure_windows.bat to edit the watchlist. After first setup, optional
enable_startup.bat starts the connector minimized at Windows sign-in. Use
disable_startup.bat to undo that, and forget_pairing.bat to remove the saved app key.
Watchlist preferences and protected pairing are stored under %LOCALAPPDATA%\ScalpSignalDesk.
The connector can find or launch the saved MT5 terminal; broker sign-in may still be needed.

The app shows labelled example data until the first real connector update arrives.
The connector sends snapshots approximately every 10 seconds. Signals received
during a short interruption are retried. On connection it backfills up to 100
historical setups per symbol, identified by their original candle time.

Browser alerts require the app to remain open. A fully closed app does not receive
push messages. The connector reports setups without placing trade orders.

Read the complete connector instructions in [connector/README.md](connector/README.md).
Edit connector/settings.json and restart to change the strategy settings.

## Mobile installation

Open the deployed app in Chrome on Android, sign in, and choose the browser's
Install or Add to Home screen option. Direct Deriv mode works on the phone while the app remains active. MT5 mode uses the Windows connector.

## Technology

- React, TypeScript and Vinext
- Cloudflare Workers and D1
- Drizzle ORM and schema migrations
- Deriv public WebSocket market-data API
- Optional dependency-free Node.js cloud worker
- Python and MetaQuotes' official MetaTrader5 integration
- RSA-OAEP and AES-GCM for connector pairing

## Run the web app locally

Use Node.js 22.13 or newer and the pnpm version declared in package.json.

```sh
pnpm install --frozen-lockfile
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_chemical_speed_demon.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_smart_ravenous.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_plain_steve_rogers.sql
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
| lib/ | Shared contracts, Deriv strategy/client/engine and labelled example data |
| cloud-runner/ | Always-on service and generated shared runtime |
| db/ and drizzle/ | Database schema and migrations |
| public/ | App icons, manifest, service worker and connector download |
| .openai/hosting.json | Current deployment identity and storage binding |

## Deriv checks

```sh
node scripts/build-deriv-runner.mjs
node tests/check-deriv.mjs
node tests/check-api.mjs
# Optional: live public-data test, no credentials or orders
node tests/check-deriv-live.mjs
```

The offline test compares the shared JavaScript engine against the Python MT5 calculation across four settings/precision cases. The API checks cover scanner exclusivity, lease expiry/takeover, settings, source ingestion, original-level preservation and guarded credential download. The HTTP-only internal preview displays the catalogue but direct scanning requires HTTPS; Node smoke tests can exercise the live engine independently.

## Validation

Run python -m unittest discover -s tests -v for connector regression checks.
Run node tests/check-api.mjs after installing dependencies for API, retry and per-market history checks.
Native Windows encryption, instance-lock and startup tests run on Windows and are skipped on other platforms.


The Python strategy matched the existing indicator calculations across 157 test
setups using four parameter configurations and multiple tick sizes. TypeScript
checking, production builds, Python syntax checks, API retry tests and encrypted
pairing tests passed during development. Live validation with a Windows MT5
terminal remains required.

## References

- [MetaTrader 5 Python integration](https://www.mql5.com/en/docs/python_metatrader5)
- [MetaTrader 5 candle history API](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py)
