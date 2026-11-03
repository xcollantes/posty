import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Posty", template: "%s · Posty" },
  description: "Self-hosted social media scheduler",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
