import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyBackend } from '../server/backend.mjs';
import { isOwnerAccount, isOwnerSession, privateDeskUrl } from '../server/policy.mjs';

const environment = {
  OWNER_GITHUB_ID: '282092099',
  SCALP_BACKEND_URL: 'https://private.example',
  SCALP_BACKEND_TOKEN: 'test-only-backend-token',
};
const session = { user: { ownerId: '282092099' } };
const post = (path, body = '{}', origin = 'https://desk.example') => new Request(`https://desk.example${path}`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
});
const never = () => { throw new Error('Backend must not be called'); };

test('only the stable owner GitHub account is admitted', () => {
  assert.equal(isOwnerAccount({ provider: 'github', providerAccountId: '282092099' }, environment), true);
  assert.equal(isOwnerAccount({ provider: 'github', providerAccountId: '123', login: 'owenmosalagae' }, environment), false);
  assert.equal(isOwnerAccount({ provider: 'credentials', providerAccountId: '282092099' }, environment), false);
  assert.equal(isOwnerSession({ user: { email: 'owenmosalagae@gmail.com' } }, environment), false);
});

test('unauthenticated and non-owner requests cannot read history', async () => {
  for (const visitor of [null, {}, { user: { ownerId: '123' } }]) {
    const request = new Request('https://desk.example/api/state', { headers: {
      'OAI-Sites-Authorization': 'Bearer attacker', 'oai-authenticated-user-id': '282092099',
    } });
    const result = await proxyBackend(request, visitor, { environment, fetcher: never });
    assert.equal(result.status, 401);
  }
});

test('configuration writes reject foreign or absent origins', async () => {
  for (const origin of ['https://attacker.example', 'null', '']) {
    const result = await proxyBackend(post('/api/deriv/config', '{}', origin), session, { environment, fetcher: never });
    assert.equal(result.status, 403);
  }
});

test('only scanner API routes and intended methods are forwarded', async () => {
  for (const request of [post('/api/pair'), post('/api/deriv/runner-config'), post('/api/state'), new Request('https://desk.example/api/deriv/lease')]) {
    assert.equal((await proxyBackend(request, session, { environment, fetcher: never })).status, 404);
  }
});

test('history query and scanner response pass through without cookies or upstream credentials', async () => {
  let called = false;
  const request = new Request('https://desk.example/api/state?stream=R_100%3AM5&all=1', {
    headers: { Cookie: 'session=private', Authorization: 'Bearer user', 'oai-authenticated-user-id': 'spoofed' },
  });
  const response = await proxyBackend(request, session, { environment, fetcher: async (url, options) => {
    called = true;
    assert.equal(url.toString(), 'https://private.example/api/state?stream=R_100%3AM5&all=1');
    assert.equal(options.headers['OAI-Sites-Authorization'], 'Bearer test-only-backend-token');
    assert.equal(options.headers.Origin, 'https://private.example');
    for (const header of ['Cookie', 'Authorization', 'oai-authenticated-user-id']) assert.equal(options.headers[header], undefined);
    assert.equal(options.redirect, 'manual');
    return Response.json({ streams: [], signals: [{ id: 'retained-history' }] }, { headers: {
      'Set-Cookie': 'backend=secret', 'OAI-Sites-Authorization': 'Bearer test-only-backend-token',
    } });
  } });
  assert.equal(called, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { streams: [], signals: [{ id: 'retained-history' }] });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('oai-sites-authorization'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('scanner writes preserve the body and backend lease conflict status', async () => {
  const body = JSON.stringify({ owner: 'browser-test', mode: 'browser', action: 'acquire' });
  const response = await proxyBackend(post('/api/deriv/lease', body), session, { environment, fetcher: async (url, options) => {
    assert.equal(new TextDecoder().decode(options.body), body);
    return Response.json({ error: 'Scanner is active elsewhere.' }, { status: 409 });
  } });
  assert.equal(response.status, 409);
});

test('oversized streamed writes are rejected before contacting the backend', async () => {
  const response = await proxyBackend(post('/api/ingest', 'x'.repeat(240001)), session, { environment, fetcher: never });
  assert.equal(response.status, 413);
});

test('missing server configuration fails closed', async () => {
  for (const overrides of [{ SCALP_BACKEND_TOKEN: '' }, { SCALP_BACKEND_URL: '' }, { SCALP_BACKEND_URL: 'http://private.example' }]) {
    const result = await proxyBackend(new Request('https://desk.example/api/state'), session, {
      environment: { ...environment, ...overrides }, fetcher: never,
    });
    assert.equal(result.status, 503);
  }
});

test('redirects, sign-in HTML, and network failures do not leak upstream data', async () => {
  for (const fetcher of [
    async () => Response.redirect('https://login.example'),
    async () => new Response('private backend error', { headers: { 'Content-Type': 'text/html' } }),
    async () => { throw new Error('sensitive transport details'); },
  ]) {
    const result = await proxyBackend(new Request('https://desk.example/api/state'), session, { environment, fetcher });
    assert.equal(result.status, 502);
    const text = await result.text();
    assert.equal(/test-only-backend-token|sensitive|login\.example|private backend error/.test(text), false);
  }
});

test('backend targets stay on the configured HTTPS origin', () => {
  assert.throws(() => privateDeskUrl('//attacker.example', '', environment));
  for (const origin of ['https://user:password@private.example', 'https://private.example/path', 'https://private.example?query=1']) {
    assert.throws(() => privateDeskUrl('/', '', { ...environment, SCALP_BACKEND_URL: origin }));
  }
});
