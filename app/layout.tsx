import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karters Dashboard — JARVIS AI Command Center",
  description:
    "Karters Dashboard: a futuristic AI command center built around JARVIS, a living 3D particle intelligence at its core.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
