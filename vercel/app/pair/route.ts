import { auth } from '@/auth';
import { isOwnerSession, privateDeskUrl } from '@/server/policy.mjs';

export async function GET(request: Request) {
  if (!isOwnerSession(await auth())) return Response.redirect(new URL('/sign-in', request.url));
  return Response.redirect(privateDeskUrl('/pair', new URL(request.url).search));
}
