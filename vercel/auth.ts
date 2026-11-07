import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { isOwnerAccount, ownerId } from './server/policy.mjs';
import { githubCredentials } from './server/github-config.mjs';

declare module 'next-auth' {
  interface User { ownerId?: string }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub(githubCredentials())],
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: '/sign-in', error: '/sign-in' },
  callbacks: {
    signIn({ account }) {
      return isOwnerAccount(account);
    },
    jwt({ token, account }) {
      if (account) token.ownerId = isOwnerAccount(account) ? account.providerAccountId : null;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.ownerId = token.ownerId === ownerId() ? ownerId() : undefined;
      return session;
    },
  },
});
