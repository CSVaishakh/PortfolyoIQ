import type { Metadata } from "next";
import TrainClient from "./TrainClient";

export const metadata: Metadata = {
  title: "System operations — PortfolioIQ",
  description: "Operator console for model seeding, aggregation and rollback.",
  // GL-03: the route is unlisted and must stay out of search indexes.
  robots: { index: false, follow: false },
};

export default function TrainPage() {
  return <TrainClient />;
}
