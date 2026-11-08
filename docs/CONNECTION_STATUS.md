# Connection status and recovery

The chart header describes saved-data freshness and scanner state separately. A saved snapshot older than 100 seconds is not proof that a Deriv WebSocket has disconnected.

The previous header used snapshot age alone and displayed “Connection interrupted” for old timeframes, inactive strategy configurations and charts still loading. A new-timeframe placeholder could also display a last-update date from epoch zero.

## Current behaviour

- Saved views are identified by their timeframe, strategy, settings and scanner selection. They remain available without a false disconnection alarm.
- Loading, paused scanning, closed markets, stale quotes, active-scanner delays, missing scanner heartbeats, offline browsers and failed desk requests have separate messages.
- A recent scanner lease heartbeat does not make an old market quote appear live. Delayed prices remain marked as delayed.
- The state API returns the lease mode, heartbeat time and expiry, including when no streams exist. It does not return the lease owner or credentials. No migration is required.
- Desk refreshes continue every five seconds. Scanner coordination continues every twenty seconds. Their HTTP requests have a fifteen-second deadline, including response-body parsing where applicable.
- Online, focus and foreground events trigger fresh checks. Request failures release the in-flight guard after timeout so subsequent attempts can proceed. Recovering a successful heartbeat restores the engine's actual status after a temporary settings-request error.
- “Recent market updates” counts recent saved snapshots; it does not claim to count open WebSocket subscriptions.

Signal calculations, frozen trade levels and scanner-lease exclusivity are unchanged. Browser suspension, internet outages and provider interruptions can still delay data; the app must describe those limitations accurately.

## Observed production evidence

A read-only inspection on 8 November 2026 returned HTTP 200, 207 saved streams and 71 snapshots under 100 seconds old. The other 136 streams were more than five minutes old. Volatility 50 (1s) Index M5 was seven seconds behind, while its saved M1 view was about 88 minutes old. A current browser-scanner heartbeat was present.

The recent error-filtered worker-log sample contained scanner-lease HTTP 409 responses with successful Worker execution outcomes. These are expected when another window already owns scanning; they are not evidence of a server crash. This inspection does not establish the cause of every past intermittent delay.

Automated coverage checks state classification, actual failure warnings, stalled-body timeout and recovery, cancellation, and the API heartbeat response. Live UI interaction remains subject to the owner's authenticated browser session.
