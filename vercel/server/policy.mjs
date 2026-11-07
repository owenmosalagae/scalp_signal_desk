export function ownerId(environment = process.env) {
  return environment.OWNER_GITHUB_ID || '282092099';
}

export function isOwnerAccount(account, environment = process.env) {
  return account?.provider === 'github' && account.providerAccountId === ownerId(environment);
}

export function isOwnerSession(session, environment = process.env) {
  return session?.user?.ownerId === ownerId(environment);
}

const routes = new Map([
  ['/api/state', ['GET']],
  ['/api/deriv/config', ['GET', 'POST']],
  ['/api/deriv/lease', ['POST']],
  ['/api/ingest', ['POST']],
]);

export function permittedRoute(path, method) {
  return routes.get(path)?.includes(method) === true;
}

export function privateDeskUrl(path = '/', search = '', environment = process.env) {
  const origin = environment.SCALP_BACKEND_URL;
  if (!origin) throw new Error('Backend is not configured.');
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Backend must be an HTTPS origin.');
  }
  const result = new URL(path, base);
  if (result.origin !== base.origin) throw new Error('Invalid backend path.');
  result.search = search;
  return result;
}
