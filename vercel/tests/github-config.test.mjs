import test from 'node:test';
import assert from 'node:assert/strict';
import { githubCredentials, githubConfigured } from '../server/github-config.mjs';

test('GitHub sign-in reads the saved dashboard credential names', () => {
  const environment = { AUTH_SECRET: 'test-session', Client_ID: 'test-id', Client_Secret: 'test-secret' };
  assert.deepEqual(githubCredentials(environment), { clientId: 'test-id', clientSecret: 'test-secret' });
  assert.equal(githubConfigured(environment), true);
});

test('Auth.js credential names take precedence when both are configured', () => {
  assert.deepEqual(githubCredentials({ AUTH_GITHUB_ID: 'preferred-id', AUTH_GITHUB_SECRET: 'preferred-secret',
    Client_ID: 'fallback-id', Client_Secret: 'fallback-secret' }),
  { clientId: 'preferred-id', clientSecret: 'preferred-secret' });
});

test('partial credentials keep the sign-in configuration incomplete', () => {
  for (const environment of [{}, { AUTH_SECRET: 'test-session', Client_ID: 'test-id' },
    { Client_ID: 'test-id', Client_Secret: 'test-secret' }]) {
    assert.equal(githubConfigured(environment), false);
  }
});
