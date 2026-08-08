import { ArrowRight, Lock, Scale, Receipt, BarChart3, XCircle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ButtonLink } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { IllustrativeOutput } from "@/components/landing/IllustrativeOutput";
import { loadIllustration } from "@/lib/illustration";
import { DISCLOSURE, PRIVACY_CLAIM } from "@/lib/copy";

/**
 * Landing page.
 *
 * A server component with no client JavaScript of its own beyond the shared
 * header, so it renders and states its disclosure without scripting (NFR-03)
 * and keeps TensorFlow.js out of its bundle entirely (PF-01).
 *
 * Every claim below corresponds to shipped behaviour (LP-02). The previous copy
 * promised broker-format auto-mapping, on-device model training, a model that
 * improves as more people use it, P&L views and saved weights — none of which
 * exist.
 */

const PROPERTIES = [
  {
    Icon: Scale,
    title: "Target-relative",
    body: "Drift is measured against the allocation you declare, not against an equal-weight ideal. No declared mandate, no verdict.",
  },
  {
    Icon: Receipt,
    title: "Cost and tax estimation",
    body: "Brokerage, short- and long-term capital gains and the turnover cap are weighed before any trade is proposed.",
  },
  {
    Icon: BarChart3,
    title: "Drift visualisation",
    body: "Every holding is shown against its target and its no-trade band, ordered by how far off it has drifted.",
  },
];

/** LP-03: the steps mirror the real pipeline. */
const STEPS = [
  {
    number: "01",
    title: "Declare your targets",
    body: "Fill the fixed template with your holdings and the target weight you intend for each. That mandate is the baseline every later figure is measured against.",
  },
  {
    number: "02",
    title: "Analyse locally",
    body: "Upload the file. Parsing, feature construction and the economics all run in your browser — your holdings are never transmitted.",
  },
  {
    number: "03",
    title: "Act with the numbers in view",
    body: "Read the verdict, the trade list, the estimated cost and tax, and the caveats that qualify them. Export the trades as CSV.",
  },
];

/** LP-07: the limits, stated as plainly as the capabilities. */
const LIMITS = [
  "No live or streaming quotes — every price is one you enter.",
  "No broker connection and no order placement.",
  "No return forecasting, factor exposure or security-level covariance; risk uses a market-volatility proxy.",
  "No tax filing, and the rates used are policy constants in the engine, not live tax law.",
  "No saved portfolios and no history — nothing is stored between sessions.",
];

export default function Home() {
  const illustration = loadIllustration();

  return (
    <AppShell width="full">
      {/* ── Hero (LP-01) ──────────────────────────────────────────────────── */}
      <section className="relative px-margin pt-2xl pb-xl overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[520px] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 60% at 50% 0%, color-mix(in oklab, var(--color-primary) 12%, transparent), transparent 70%)",
          }}
        />

        <div className="relative max-w-[900px] mx-auto text-center flex flex-col items-center">
          <span className="inline-flex items-center gap-sm bg-surface-container/80 rounded-full px-md py-1.5 mb-xl border border-outline-variant/40">
            <span aria-hidden="true" className="size-2 rounded-full bg-tertiary animate-pulse" />
            <span className="text-label-xs uppercase tracking-widest text-on-surface-variant">
              Experimental build
            </span>
          </span>

          <h1 className="text-verdict-lg-mobile md:text-verdict-xl text-on-surface max-w-[800px] mb-lg">
            Deterministic rebalancing estimates for the{" "}
            <span className="text-primary italic">disciplined investor.</span>
          </h1>

          <p className="text-body-base md:text-title-lg font-normal text-on-surface-variant max-w-[650px] mb-2xl">
            Weigh drift against cost and tax with a target-relative model. Not a prediction, not a
            forecast — an arithmetic estimate from the figures you provide.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-md w-full sm:w-auto">
            {/* LP-06: the product works without an account, so the primary CTA
                goes to the product, not to the sign-in wall. */}
            <ButtonLink href="/interact" size="lg" className="w-full sm:w-auto">
              Start an analysis
              <ArrowRight aria-hidden="true" className="size-5" />
            </ButtonLink>
            <ButtonLink href="/auth" size="lg" variant="secondary" className="w-full sm:w-auto">
              Sign in
            </ButtonLink>
          </div>
          <p className="text-label-xs font-normal text-outline mt-md">
            No account needed. Signing in only adds an explanatory model signal.
          </p>
        </div>
      </section>

      {/* ── Disclosure (LP-04) — above the fold, not only in the footer ───── */}
      <section className="w-full px-margin relative z-10">
        <Alert tone="error" className="max-w-[800px] mx-auto">
          <strong className="text-on-surface font-semibold">Educational prototype: </strong>
          {DISCLOSURE}
        </Alert>
      </section>

      {illustration && <IllustrativeOutput illustration={illustration} />}

      {/* ── What it does ──────────────────────────────────────────────────── */}
      <section className="w-full px-margin py-2xl" aria-labelledby="protocol-heading">
        <div className="max-w-[1280px] mx-auto grid lg:grid-cols-12 gap-xl">
          <div className="lg:col-span-4">
            <h2 id="protocol-heading" className="text-verdict-lg text-on-surface mb-md">
              The method.
            </h2>
            <p className="text-body-base font-normal text-on-surface-variant">
              A strict, deterministic approach to portfolio maintenance. No predictive model decides
              anything — the verdict is arithmetic on your stated intent.
            </p>
          </div>

          <ul className="lg:col-span-8 grid sm:grid-cols-3 gap-md">
            {PROPERTIES.map(({ Icon, title, body }) => (
              <li
                key={title}
                className="rounded-2xl bg-surface-container border border-outline-variant/40 p-lg flex flex-col gap-sm"
              >
                <Icon aria-hidden="true" className="size-6 text-primary" />
                <h3 className="text-title-lg text-on-surface">{title}</h3>
                <p className="text-body-sm text-on-surface-variant">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works (LP-03) ──────────────────────────────────────────── */}
      <section className="w-full px-margin py-2xl" aria-labelledby="how-heading">
        <div className="max-w-[1280px] mx-auto">
          <h2 id="how-heading" className="text-verdict-lg text-on-surface mb-xl">
            How it works.
          </h2>

          <ol className="flex flex-col gap-md">
            {STEPS.map((step) => (
              <li
                key={step.number}
                className="rounded-2xl bg-surface-container border border-outline-variant/40 p-lg flex flex-col sm:flex-row gap-md"
              >
                <span
                  aria-hidden="true"
                  className="size-11 shrink-0 rounded-full bg-primary/10 text-primary grid place-items-center font-mono text-body-sm"
                >
                  {step.number}
                </span>
                <div className="flex flex-col gap-xs min-w-0">
                  <h3 className="text-title-lg text-on-surface">{step.title}</h3>
                  <p className="text-body-sm text-on-surface-variant max-w-prose">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-md rounded-2xl bg-surface-container-low border border-outline-variant/40 p-lg flex items-start gap-md">
            <Lock aria-hidden="true" className="size-5 shrink-0 text-primary mt-0.5" />
            <p className="text-body-sm text-on-surface-variant max-w-prose">{PRIVACY_CLAIM}</p>
          </div>
        </div>
      </section>

      {/* ── Limits (LP-07) ────────────────────────────────────────────────── */}
      <section className="w-full px-margin py-2xl" aria-labelledby="limits-heading">
        <div className="max-w-[1280px] mx-auto grid lg:grid-cols-12 gap-xl">
          <div className="lg:col-span-4">
            <h2 id="limits-heading" className="text-verdict-lg text-on-surface mb-md">
              What it does not do.
            </h2>
            <p className="text-body-base font-normal text-on-surface-variant">
              Stated as plainly as the capabilities, because knowing the edges is what makes the
              output usable.
            </p>
          </div>

          <ul className="lg:col-span-8 flex flex-col gap-sm">
            {LIMITS.map((limit) => (
              <li
                key={limit}
                className="flex items-start gap-sm rounded-xl bg-surface-container-low border border-outline-variant/40 p-md"
              >
                <XCircle aria-hidden="true" className="size-5 shrink-0 text-outline mt-px" />
                <span className="text-body-sm text-on-surface-variant">{limit}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────────── */}
      <section className="w-full px-margin pb-2xl">
        <div className="max-w-[800px] mx-auto rounded-2xl border border-primary/20 bg-primary/5 p-xl text-center flex flex-col items-center gap-md">
          <h2 className="text-title-xl text-on-surface">Ready to check your allocation?</h2>
          <p className="text-body-sm text-on-surface-variant max-w-prose">
            Download the template, fill in your holdings and target weights, and run the engine. It
            takes about a minute and needs no account.
          </p>
          <ButtonLink href="/interact" size="lg">
            Start an analysis
            <ArrowRight aria-hidden="true" className="size-5" />
          </ButtonLink>
        </div>
      </section>
    </AppShell>
  );
}
