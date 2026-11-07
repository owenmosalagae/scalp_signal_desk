# Deriv cloud scanner

This optional always-on Node.js service scans the synthetic and forex instruments actually returned by Deriv's public API. It shares the app's EMA/ATR implementation, streams candles, confirms closed-bar setups, and saves reports in the private signal desk. It does not place orders or need a Deriv account password.

**The published dashboard does not host this process.** Until this service is deployed and its heartbeat shows **Cloud scanner**, scanning happens in an open, active app window. Closing or suspending the app stops app scanning. Hosting the runner keeps recording signals while the PC and phone are off. Phone notifications while the app is fully closed are not implemented.

## Deploy with Render

1. Sign in to Render, connect `owenmosalagae/scalp_signal_desk`, and create a Blueprint using the root `render.yaml`.
2. Review the cost of the background worker before creating it. This blueprint selects the smallest listed paid worker plan. There is no free-worker or sleeping-web-service fallback.
3. In the signed-in signal desk, open **Markets & connection → Scan while the app is closed → Download private runner settings**. Set the host's `SCALP_SITE_URL` and secret `SCALP_SITE_TOKEN` from that file. Do not commit it or send its contents in chat. It grants access to the private desk.
4. Deploy the worker, close all app windows for about 90 seconds to release app scanner ownership, then reopen the desk. The mode should show **Cloud scanner**. The app then receives saved signals without taking the scanner lease.
5. Choose markets and timeframe in the app. Changes are picked up within about 20 seconds. Disabling the scanner stops market subscriptions; it does not stop your host's billing. Suspend/delete the hosted service to stop its hosting charge.

A Docker-capable host or VPS can run the same service. It needs outbound HTTPS to the desk and WebSockets to `api.derivws.com`. Run one replica; lease protection allows only one publisher per desk.

## Local validation or another host

Node.js 22+ is sufficient, with no npm dependencies at runtime. From the repository root:

```sh
node --env-file=/private/path/scalp-runner.env cloud-runner/runner.mjs
```

Or build the Docker image using the repository root as context:

```sh
docker build -f cloud-runner/Dockerfile -t scalp-deriv-scanner .
docker run --restart unless-stopped --env-file /private/path/scalp-runner.env scalp-deriv-scanner
```

The Docker runtime is generated from `lib/deriv/*.ts`. After changing the shared engine, run `node scripts/build-deriv-runner.mjs` and commit the updated `cloud-runner/runtime/*.js` too. Tests check that they match.

## Data and strategy details

- Discover the current API catalogue using `active_symbols`, including closed forex markets. Only `synthetic_index` and `forex` are selected; other categories remain outside this feature.
- One chart timeframe per desk selection, initially M5. Scope can be all synthetics, all forex, both, or a custom watchlist. Suspended instruments are not subscribed.
- Five EMAs 8/13/21/34/55, Wilder ATR14, 1.5 ATR stop rounded upward to API precision, targets 1.5R/2R/3R, and closed-candle alignment changes. Mixed alignment is neutral. Trend rows provide context only.
- Warm up from 1,000 API candles. M45 is synthesized only from complete sets of three M15 bars. Missing history displays Loading, rather than a guessed trend.
- Pacing limits requests to at most 150/minute on one connection. Chart histories load first, followed by the trend frames. Warming all markets takes several minutes. Only chart feeds request streaming subscriptions. If the provider declines another subscription, that market falls back to 30-second candle refreshes. Higher frames use history, with larger aligned candles updated from the chart stream and smaller frames refreshed after closing. Refresh/reconnect rebuilds the catalogue and history. Request-rate errors back off.
- Snapshots save around every 30 seconds per changing market, and at candle transitions. Historic imports are labelled internally so opening the scanner does not notify old setups. Failed saves retry, and signal IDs deduplicate database writes. Original stored signal levels do not change on retries.
- Public quotes are not MT5 bid/ask prices. Both internal bid/ask fields contain the public close for API snapshots, and the UI labels the public source. API `pip_size` determines level rounding. These levels can differ from MT5 tick sizes, prices, candle boundaries, and history seeds.
- Market catalogue flags refresh every 15 minutes. Closed markets retain their final history without repeated order attempts. Forex resumes on the next catalogue refresh after reopening.
- The site-wide service token is a private connection credential. Download only from the signed-in owner session, store in the host's secret settings, and rotate the Site service token if it is exposed. No secrets are included in this repository.

Official references

- https://developers.deriv.com/docs/data/active-symbols/
- https://developers.deriv.com/docs/data/ticks-history/
- https://developers.deriv.com/docs/options/ws-public/
- https://developers.deriv.com/docs/limits/
- https://render.com/docs/background-workers
- https://render.com/docs/blueprint-spec
