import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Scalp Signal Desk",
  description: "Your MT5 ribbon strategy, with confirmed signals and fixed trade levels.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
