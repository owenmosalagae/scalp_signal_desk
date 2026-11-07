# Scalp Signal Desk on Vercel

This is a standard Next.js frontend for the existing Scalp Signal Desk. It reuses the dashboard and browser Deriv scanner from the parent project. An authenticated server-side proxy reads and writes the existing private backend, keeping signal history, scanner settings and the scanner lease in one database.

The original Cloudflare/Sites build stays at the repository root. This frontend lives under `vercel/`; it does not migrate or reset the database.

## Deployment

1. Import `owenmosalagae/scalp_signal_desk` into the `mossnet` Vercel team, selecting the branch with this change.
2. Set **Root Directory** to `vercel` and enable **Include source files outside of the Root Directory in the Build Step**. The prebuild copies the shared dashboard, scanner and static files from the parent directory.
3. Use the Next.js preset and Node.js 22. The checked-in configuration uses `npm ci` and `npm run build`. Leave Output Directory at the framework default.
4. Add the encrypted server environment variables below to the target environment.
5. Deploy, configure the GitHub OAuth callback for the resulting stable domain, then verify owner sign-in and saved signal history.

| Variable | Value or purpose |
| --- | --- |
| `AUTH_SECRET` | A generated secret, at least 32 random bytes. Store only in Vercel environment settings. |
| `AUTH_GITHUB_ID` | Client ID of a GitHub OAuth App created in the owner's account. |
| `AUTH_GITHUB_SECRET` | That OAuth App's client secret; set it directly in Vercel, never in chat or Git. |
| `OWNER_GITHUB_ID` | `282092099`, the stable GitHub user ID for `owenmosalagae`. |
| `SCALP_BACKEND_URL` | `https://moss-scalp-signals.owenmosalagae.chatgpt.site` |
| `SCALP_BACKEND_TOKEN` | The existing private backend's service-access bearer token, configured server-side. |

For the GitHub OAuth App, set the homepage to the stable Vercel domain and **Authorization callback URL** to `https://YOUR-STABLE-DOMAIN/api/auth/callback/github`. Use a separate OAuth App for local development or a different preview domain. No repository permissions or GitHub personal access token are needed for visitor sign-in. Auth.js checks the stable owner ID after GitHub authenticates the account; other accounts are rejected.

The configured production address is `https://scalp-signal-desk-mossnet.vercel.app`. Its GitHub callback is `https://scalp-signal-desk-mossnet.vercel.app/api/auth/callback/github`. Create the OAuth App in the owner's GitHub account, then put its Client ID and Client Secret into the Vercel project's `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` Production variables. Redeploy after saving them.

The existing sensitive Production variables `Client_ID` and `Client_Secret` are also supported directly. There is no need to rename or re-enter them. If both naming conventions are configured, the `AUTH_GITHUB_*` values take precedence.

## Run locally

From `vercel/`, run `npm ci`, copy `.env.example` to `.env.local`, set its values privately and add `AUTH_TRUST_HOST=true` for local development. Then run `npm run dev`. Local GitHub callback: `http://localhost:3000/api/auth/callback/github`.

## Verify

```sh
npm test
npm run check
npm run build
```

Before signing in, `/` redirects to `/sign-in` and `/api/state` returns 401. After owner sign-in, check saved signals, selected chart history, a timeframe/settings change, scanner lease handling and a new confirmed signal. Sign out and confirm the API again returns 401. Verify a different GitHub account cannot enter. Backend credentials are never sent to the browser or copied from request headers.

Connector pairing and runner-configuration downloads remain on the existing private desk, using its existing ChatGPT sign-in. A link above the Vercel dashboard opens that desk; the Vercel proxy deliberately does not expose service-token download or connector pairing endpoints. Existing paired connectors and a configured cloud runner continue to use their original backend address. The direct browser scanner supports the same markets and timeframes as the original app.

This deployment does not start a 24/7 cloud scanner or enable closed-app push notifications. The browser scanner runs while the app is open. Both addresses share the scanner lease, so an existing active scanner can prevent a second tab or cloud runner from acquiring it.

## Implementation references

- [Auth.js Next.js integration](https://authjs.dev/reference/nextjs)
- [Auth.js deployment](https://authjs.dev/getting-started/deployment)
- [Vercel monorepos](https://vercel.com/docs/monorepos)

The Auth.js v5 package is pinned to `5.0.0-beta.32`; upgrade it deliberately and rerun sign-in and API protection checks.

The Vercel application uses Next.js `16.4.5` and Zod `4.6.7` to include fixes for the dependency advisories reported by the first cloud build. Contract compatibility tests cover a scanner snapshot, invalid ribbon settings, candle limits and finite prices alongside the API proxy tests.
