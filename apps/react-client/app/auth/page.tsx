import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Sign in — PortfolioIQ",
  description:
    "Sign in or create an account to add the secondary model signal. The rebalancing verdict works without one.",
};

export default function AuthPage() {
  return <AuthForm defaultMode="signin" />;
}
