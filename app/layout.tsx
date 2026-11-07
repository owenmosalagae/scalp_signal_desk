import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Scalp Signal Desk",
  description: "Deriv and MT5 ribbon signals, with confirmed setups and fixed trade levels.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
