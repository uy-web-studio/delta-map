import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delta Community Map",
  description: "Buildings, offices, services and events at San Joaquin Delta College, on one map.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1e3a8a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
