export function canonicalRedirect(requestUrl, configuredOrigin) {
  if (!configuredOrigin) return null;
  const canonical = new URL(configuredOrigin);
  if (canonical.protocol !== 'https:' || canonical.username || canonical.password ||
      canonical.pathname !== '/' || canonical.search || canonical.hash) {
    throw new Error('AUTH_URL must be an HTTPS origin.');
  }
  const incoming = new URL(requestUrl);
  if (incoming.origin === canonical.origin) return null;
  // Assign URL components individually so a path beginning with // cannot
  // replace the configured destination host.
  canonical.pathname = incoming.pathname;
  canonical.search = incoming.search;
  return canonical.toString();
}
