import type { Metadata } from 'next';
import './shared/globals.css';

export const metadata: Metadata = {
  title: 'Scalp Signal Desk',
  description: 'Private Deriv and MT5 signal dashboard.',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
