import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calistar — Ecosystem Analytics",
  description:
    "Privacy-first web and API analytics for Stellar ecosystem projects.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
