// Read credentials only in server modules. Support the names entered in the
// dashboard as well as Auth.js's conventional names.
export function githubCredentials(environment = process.env) {
  return {
    clientId: environment.AUTH_GITHUB_ID || environment.Client_ID,
    clientSecret: environment.AUTH_GITHUB_SECRET || environment.Client_Secret,
  };
}

export function githubConfigured(environment = process.env) {
  const credentials = githubCredentials(environment);
  return !!(environment.AUTH_SECRET && credentials.clientId && credentials.clientSecret);
}
