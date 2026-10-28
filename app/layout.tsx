import type { Metadata, Viewport } from "next";
import { Bowlby_One, Open_Sans } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delta Community Map",
  description: "Buildings, offices, services and events at San Joaquin Delta College, on one map.",
};

// Delta's own type: Bowlby One for headings, Open Sans for everything else. Bundled at build time.
const bowlby = Bowlby_One({ weight: "400", subsets: ["latin"], variable: "--font-bowlby", display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-open-sans", display: "swap" });

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffcb05" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bowlby.variable} ${openSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
