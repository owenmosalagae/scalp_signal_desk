import { isOwnerSession, permittedRoute, privateDeskUrl } from './policy.mjs';

const fail = (message, status) => Response.json({ error: message }, {
  status, headers: { 'Cache-Control': 'no-store' },
});

async function boundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 240_000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function proxyBackend(request, session, {
  environment = process.env, fetcher = fetch,
} = {}) {
  if (!isOwnerSession(session, environment)) return fail('Sign in to your private desk.', 401);
  const incoming = new URL(request.url);
  if (!permittedRoute(incoming.pathname, request.method)) return fail('Route is unavailable.', 404);
  if (request.method !== 'GET' && request.headers.get('origin') !== incoming.origin) {
    return fail('Invalid origin.', 403);
  }
  if (!environment.SCALP_BACKEND_TOKEN) return fail('Backend connection is not configured.', 503);
  let target;
  try { target = privateDeskUrl(incoming.pathname, incoming.search, environment); }
  catch { return fail('Backend connection is not configured.', 503); }
  const body = request.method === 'GET' ? undefined : await boundedBody(request);
  if (body === null) return fail('Snapshot too large.', 413);
  try {
    // Only these server-created headers cross the boundary. Browser cookies,
    // authorization and asserted visitor identity are never forwarded.
    const upstream = await fetcher(target, {
      method: request.method,
      headers: {
        'OAI-Sites-Authorization': `Bearer ${environment.SCALP_BACKEND_TOKEN}`,
        Origin: target.origin,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.headers.get('content-type')?.includes('application/json')) {
      await upstream.body?.cancel();
      return fail('The private backend could not be reached.', 502);
    }
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const retry = upstream.headers.get('retry-after');
    if (retry) headers.set('Retry-After', retry);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return fail('The private backend could not be reached. Please retry.', 502); }
}
