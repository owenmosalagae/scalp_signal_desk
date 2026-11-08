# Strategy switching review

Review prepared 8 November 2026. Validation was local; repository publication was authorized after review. The live backend configuration and database were not changed. Release requirements are documented below.

## Result

Markets & connection now offers Scalp Ribbon and Session Range + FVG. Save scanner settings to apply the selection. The Deriv scanner runs one selected strategy at a time; it does not place orders. Both browser scanning and the generated cloud runtime share the strategy implementation.

Scalp Ribbon remains the default for legacy configurations and MT5 connector records. Its original stream identity and EMA/ATR calculations are preserved. Session FVG receives a separate stream identity derived from symbol, strategy version and session settings. Switching or changing FVG rules cannot relabel existing signals. Historical streams remain selectable; history, reports and CSV exports identify the strategy/version, and new records retain their original settings.

The overview displays the selected stream's strategy. Session streams show their range, FVG zones and setup lifecycle. Pending, expired and invalidated setups do not become signal-history entries or entry alerts. Loading/replaying historical signals marks the first batch as backfill and suppresses historical alerts.

## Session Range + FVG rules

1. Fix a 15-minute reference range from exactly three contiguous, closed M5 candles. The default uses the fifteen minutes before 09:30 America/New_York. Opening-range mode instead uses the first fifteen minutes after the selected session time. Missing candles block the range.
2. Require an M5 close beyond the fixed high or low. All three candles of the subsequent FVG must start after that breakout confirmation. A reversal through the opposite range boundary invalidates a pending setup.
3. The middle FVG candle must move in the breakout direction with a body strictly greater than the configured multiple of an earlier, closed ATR. A bullish gap lies between the first candle's high and third candle's low; a bearish gap is the inverse. The gap must meet its ATR/tick minimum.
4. Freeze a structural stop using the known setup candles/lookback and an ATR buffer of at least the configured number of ticks. ATR and structure do not use future candles.
5. Wait for a later closed M5 candle to touch the selected near edge or midpoint and reject in the setup direction. Its close must be beyond both the gap and the reference range. A stop breach on that candle invalidates the setup before entry confirmation.
6. Use that confirmation close as the reference entry, rather than assuming a historical limit-order fill. Calculate three increasing targets from the entry-to-stop risk, rounded to the instrument tick. Collapsed or unusable rounded levels are rejected.
7. Enforce expiry, the session trade-window end and the confirmed-signal cap. Missing candles invalidate a pending setup. No late fill is invented after expiry.

### Defaults

| Setting | Value |
| --- | --- |
| Session | New York reference, 09:30 America/New_York, weekdays |
| Range | 15 minutes before session time |
| Confirmation timeframe | M5 |
| Trade window | 120 minutes after the reference range closes |
| ATR | 14 periods |
| Displacement body | Strictly greater than 1.2 × preceding ATR |
| Minimum FVG | 0.1 × ATR, at least one tick |
| Retest level | Near edge |
| Stop structure | 20 M5 candles ending at FVG detection |
| Stop buffer | Greater of 0.1 × ATR or 2 ticks |
| Retest expiry | 6 M5 bars, capped at trade-window end |
| Confirmed signals | At most 1 per symbol/session/configuration |
| Targets | 1R, 2R, 3R |

All FVG parameters above are configurable within validated limits, except New York mode's fixed reference time/timezone and M5 confirmation frame. Custom mode allows an IANA timezone and a session start on a five-minute boundary. Session timing follows daylight-saving changes. A nonexistent local clock time skips that session; a repeated clock time uses its first occurrence. Overnight custom sessions retain their original session date.

New York mode excludes synthetic markets. Its 09:30 reference is a strategy reference time, not a forex market opening or an exchange-holiday calendar. Custom mode supports synthetic indices and forex and runs on every calendar day where sufficient candle data exists. Candle history must cover the complete reference range; the engine does not fabricate one.

## Integration and release requirements

No SQL migration is required: configuration, snapshots and signal metadata use the existing JSON records. The backend now advertises `capabilities.strategySwitching: 1`; the updated frontend blocks Session FVG against a legacy backend rather than allowing settings to be silently discarded.

A later release must update the private backend and Vercel frontend, plus any deployed cloud runner using `cloud-runner/runtime`. Pause the scanner and stop any old cloud runner during that coordinated update. An old runner does not understand the new strategy. Update it before resuming scanning. Existing authentication, connection keys and scanner lease ownership remain in use.

The generated runtime is checked into this patch. Regenerate it after strategy changes with:

```sh
node scripts/build-deriv-runner.mjs
```

The Vercel test pre-step also regenerates it. The script resolves the repository from its own file path and supports the Vercel-only dependency installation.

The current Windows MT5 connector and downloadable MT5 indicator remain Scalp Ribbon. This change adds Session FVG to the direct Deriv scanner and shared cloud runner; it is not a new `.mq5` indicator or an MT5 FVG connector port.

## Validation completed

- 44 automated tests passed, including BUY/SELL confirmation, DST transitions, missing/forming candles, pre-breakout gap rejection, midpoint retests, expiry, stop breach, overnight sessions, trade-window boundaries, signal caps, tick rounding, replay deduplication, legacy defaults and stream isolation.
- Backend route tests round-trip the selected configuration and preserve strategy/settings metadata in stored signals using an in-memory database stub. Existing authentication/proxy/contract checks pass.
- The same tests also passed with root dependencies hidden, using only the Vercel dependency installation.
- `node tests/check-deriv.mjs` passed: 71 Ribbon signals match the Python MT5 implementation across four settings/precision cases; shared generated runtime, forming candles, aggregation and market/polling behavior also passed.
- `npm run check --prefix vercel` passed.
- `npm run build --prefix vercel` passed with Next.js 16.4.5.
- The shared configuration schema was also exercised with Zod 3.25.76 for the root backend and Zod 4.6.7 for the Vercel frontend.

Browser interaction and visual QA remain unverified. The managed preview could not resolve the available Next.js dependencies in its isolated environment. No live account, live backend, broker execution, deployment or live strategy signal was used for validation. The root Cloudflare production bundle was not rebuilt in this isolated review checkout.

This is signal-generation logic. These checks do not measure profitability or win rate, simulate spread/slippage, resolve stop/target outcomes, or prove a broker fill. Rolling API history and indicator warmup can limit which older sessions can be reconstructed.

## Local review commands

From the repository root, after installing Vercel dependencies using its lockfile:

```sh
npm ci --prefix vercel
npm test --prefix vercel
npm run check --prefix vercel
npm run build --prefix vercel
```

For the Python MT5 parity check, also install the root dependencies using the existing project setup and have Python 3 available, then run:

```sh
node tests/check-deriv.mjs
```

The review patch was generated against the captured local baseline before these changes. In the intended repository checkout, first run `git apply --check Scalp_Strategy_Switching.patch`. Only apply it if that succeeds; inspect any divergent existing work before resolving a conflict. Applying the patch does not push or deploy it.
