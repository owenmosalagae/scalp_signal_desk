import { auth, signIn } from '@/auth';
import { isOwnerSession } from '@/server/policy.mjs';
import { redirect } from 'next/navigation';
import { githubConfigured } from '@/server/github-config.mjs';

export const dynamic = 'force-dynamic';

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (isOwnerSession(await auth())) redirect('/');
  const { error } = await searchParams;
  const configured = githubConfigured();
  return <main className="pair-page"><section className="pair-card">
    <div className="brand-mark">S</div><p className="eyebrow">SCALP SIGNAL DESK</p>
    <h1>Your private signal desk.</h1>
    <p>Sign in with Owen’s GitHub account to view your charts and signal history.</p>
    {error && <p role="alert">Sign-in was not completed. Only the configured owner account can access this desk.</p>}
    {!configured ? <p role="status">Private sign-in is awaiting deployment configuration.</p> :
      <form action={async () => { 'use server'; await signIn('github', { redirectTo: '/' }); }}>
        <button className="button primary" type="submit">Sign in with GitHub ↗</button>
      </form>}
  </section></main>;
}
