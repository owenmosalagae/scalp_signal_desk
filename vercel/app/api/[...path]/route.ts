import { auth } from '@/auth';
import { proxyBackend } from '@/server/backend.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  return proxyBackend(request, await auth());
}
export { handle as GET, handle as POST };
