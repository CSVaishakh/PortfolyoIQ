import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * CN-02: the output is an estimate, not a prediction, and no page may sell it
 * as "AI-powered" — the verdict is deterministic arithmetic. The previous title
 * and description claimed both AI and federated learning as user benefits.
 */
export const metadata: Metadata = {
  title: {
    default: "PortfolioIQ — deterministic portfolio rebalancing estimates",
    template: "%s",
  },
  description:
    "Weigh portfolio drift against trading cost and tax with a target-relative model. An educational prototype; its output is a deterministic estimate, not investment advice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
