import { auth, signOut } from '@/auth';
import { isOwnerSession, privateDeskUrl } from '@/server/policy.mjs';
import { redirect } from 'next/navigation';
import Desk from './shared/desk';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isOwnerSession(await auth())) redirect('/sign-in');
  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 18, padding: '10px 20px', borderBottom: '1px solid #262d38', fontSize: 12 }}>
      <a href={privateDeskUrl().toString()} target="_blank" rel="noopener noreferrer">Connector pairing &amp; runner downloads ↗</a>
      <form action={async () => { 'use server'; await signOut({ redirectTo: '/sign-in' }); }}><button>Sign out</button></form>
    </div>
    <Desk />
  </>;
}
