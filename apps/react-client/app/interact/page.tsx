import type { Metadata } from "next";
import InteractClient from "./InteractClient";

export const metadata: Metadata = {
  title: "Portfolio analysis — PortfolioIQ",
  description:
    "Upload your holdings and declare your target allocation to get a deterministic rebalance verdict, a trade list, and the estimated cost and tax behind it.",
};

export default function InteractPage() {
  return <InteractClient />;
}
