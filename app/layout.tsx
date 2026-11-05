import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// Self-hosted at build time: the browser never contacts Google.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: { default: "Posty", template: "%s · Posty" },
  description: "Self-hosted social media scheduler",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
