import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRedirect } from '../server/canonical-origin.mjs';

const origin = 'https://scalp-signal-desk-mossnet.vercel.app';

test('alternate production aliases start sign-in on the registered domain', () => {
  assert.equal(canonicalRedirect('https://scalp-signal-desk.vercel.app/sign-in', origin), origin + '/sign-in');
  assert.equal(canonicalRedirect('https://scalp-signal-desk-gs8qfbo9c-mossnet.vercel.app/', origin), origin + '/');
});

test('OAuth callback parameters survive an alias redirect', () => {
  const path = '/api/auth/callback/github?code=test-only&state=test-only';
  assert.equal(canonicalRedirect('https://scalp-signal-desk.vercel.app' + path, origin), origin + path);
});

test('canonical requests and unconfigured local development do not redirect', () => {
  assert.equal(canonicalRedirect(origin + '/sign-in', origin), null);
  assert.equal(canonicalRedirect('http://localhost:3000/sign-in', undefined), null);
});

test('neither a network-path URL nor an invalid configured origin changes the destination host', () => {
  const target = canonicalRedirect('https://alias.example//attacker.example/sign-in', origin);
  assert.equal(new URL(target).origin, origin);
  for (const invalid of ['http://desk.example', origin + '/api/auth', 'https://user:password@desk.example']) {
    assert.throws(() => canonicalRedirect('https://alias.example/', invalid));
  }
});
