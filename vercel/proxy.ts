import { NextRequest, NextResponse } from 'next/server';
import { canonicalRedirect } from './server/canonical-origin.mjs';

export function proxy(request: NextRequest) {
  const destination = canonicalRedirect(request.url, process.env.AUTH_URL);
  return destination ? NextResponse.redirect(destination, 307) : NextResponse.next();
}

// Start sign-in and set OAuth cookies on the same registered domain that will
// receive GitHub's callback. Static assets and scanner API requests need no hop.
export const config = {
  matcher: ['/', '/sign-in', '/pair', '/api/auth/:path*'],
};
