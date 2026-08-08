"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { PasswordField, TextField } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { signIn, signUp } from "@/lib/api";
import { writeToken } from "@/lib/session";

type Mode = "signin" | "signup";

interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
}

/** AU-03: validation runs before submission and reports per field. */
function validate(mode: Mode, form: { username: string; email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};

  if (mode === "signup" && form.username.trim() === "") {
    errors.username = "Enter your full name.";
  }

  if (form.email.trim() === "") {
    errors.email = "Enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "That does not look like an email address.";
  }

  if (form.password === "") {
    errors.password = "Enter your password.";
  } else if (mode === "signup" && form.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }

  return errors;
}

/** AU-09: a hint, not a gate — the server enforces no complexity rules. */
function strengthHint(password: string): string {
  if (password.length === 0) return "At least 8 characters.";
  if (password.length < 8) return `${8 - password.length} more character(s) needed.`;
  const varieties = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (varieties >= 3) return "Strong enough.";
  return "Long enough. Mixing cases, digits or symbols would help.";
}

interface Props {
  defaultMode: Mode;
}

/**
 * Sign in and sign up (AU-01).
 *
 * `/auth` renders without the application shell by design (GL-06): it is a
 * single focused task, and the header's session control would be meaningless
 * on it.
 */
export default function AuthForm({ defaultMode }: Props) {
  const router = useRouter();
  const tablistRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const [mode, setMode] = useState<Mode>(defaultMode);
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);

  function switchTo(next: Mode) {
    setMode(next);
    setErrors({});
    setServerError("");
  }

  function update(patch: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...patch }));
    // Clear a field's error as soon as the user starts correcting it.
    const touched = Object.keys(patch)[0] as keyof FieldErrors;
    if (errors[touched]) setErrors((prev) => ({ ...prev, [touched]: undefined }));
    if (serverError) setServerError("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validate(mode, form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setServerError("");

    const result =
      mode === "signup"
        ? await signUp(form.username.trim(), form.email.trim(), form.password)
        : await signIn(form.email.trim(), form.password);

    if (!result.ok) {
      // AU-04: attribute the failure to its field where the server identifies one.
      if (result.status === 409) {
        setErrors({ email: result.error });
      } else if (result.status === 401) {
        setErrors({ password: "Those credentials were not recognised." });
      } else {
        setServerError(result.error);
      }
      setBusy(false);
      return;
    }

    writeToken(result.data.token);
    // AU-07. Mandate state on /interact is component-local, so a sign-in detour
    // mid-analysis loses it — recorded as the open half of GL-17.
    router.push("/interact");
  }

  const tabClass = (active: boolean) =>
    cn(
      "flex-1 py-sm rounded-md text-body-sm font-medium transition-colors",
      active
        ? "bg-surface-container-highest text-on-surface"
        : "text-on-surface-variant hover:text-on-surface",
    );

  return (
    <main className="min-h-screen bg-background text-on-background flex items-center justify-center px-margin py-2xl">
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 h-[480px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 0%, color-mix(in oklab, var(--color-primary) 10%, transparent), transparent 70%)",
        }}
      />

      {/* Explicit width: `max-w-md` would resolve against our `--spacing-md`
          token rather than Tailwind's container scale. See globals.css. */}
      <div className="relative w-full max-w-[28rem]">
        <div className="text-center mb-xl">
          {/* AX-09: exactly one h1 per route, and on a single-task screen the
              wordmark is the page's name. */}
          <h1 className="text-title-xl font-semibold tracking-tight">
            <Link href="/" className="text-primary">
              PortfolioIQ
            </Link>
          </h1>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            {/* AU-08: an account adds the explanatory signal. It is not required
                for a recommendation, and federated learning is not a user benefit. */}
            An account adds the secondary model signal. The verdict itself works without one.
          </p>
        </div>

        <div className="bg-surface-container border border-outline-variant/40 rounded-2xl p-lg">
          <div
            ref={tablistRef}
            role="tablist"
            aria-label="Sign in or create an account"
            className="flex gap-xs rounded-lg bg-surface p-1 mb-lg"
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const next = mode === "signin" ? "signup" : "signin";
              switchTo(next);
              tablistRef.current
                ?.querySelector<HTMLButtonElement>(`#tab-${next}`)
                ?.focus();
            }}
          >
            <button
              type="button"
              role="tab"
              id="tab-signin"
              aria-selected={mode === "signin"}
              aria-controls={panelId}
              tabIndex={mode === "signin" ? 0 : -1}
              onClick={() => switchTo("signin")}
              className={tabClass(mode === "signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              id="tab-signup"
              aria-selected={mode === "signup"}
              aria-controls={panelId}
              tabIndex={mode === "signup" ? 0 : -1}
              onClick={() => switchTo("signup")}
              className={tabClass(mode === "signup")}
            >
              Sign up
            </button>
          </div>

          <div id={panelId} role="tabpanel" aria-labelledby={`tab-${mode}`}>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-md">
            {mode === "signup" && (
              <TextField
                label="Full name"
                name="username"
                value={form.username}
                onChange={(v) => update({ username: v })}
                autoComplete="name"
                placeholder="Your name"
                error={errors.username}
                disabled={busy}
              />
            )}

            <TextField
              label="Email"
              type="email"
              name="email"
              value={form.email}
              onChange={(v) => update({ email: v })}
              autoComplete="email"
              placeholder="you@example.com"
              error={errors.email}
              disabled={busy}
            />

            <PasswordField
              label="Password"
              name="password"
              value={form.password}
              onChange={(v) => update({ password: v })}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              minLength={mode === "signup" ? 8 : undefined}
              error={errors.password}
              hint={mode === "signup" ? strengthHint(form.password) : undefined}
              disabled={busy}
            />

            {serverError && (
              <Alert tone="error" role="alert">
                {serverError}
              </Alert>
            )}

            <Button
              type="submit"
              fullWidth
              busy={busy}
              busyLabel={mode === "signin" ? "Signing in…" : "Creating account…"}
            >
              {mode === "signin" ? "Sign in" : "Create account"}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </form>
          </div>
        </div>

        <p className="text-center text-body-sm text-on-surface-variant mt-lg">
          {mode === "signin" ? "No account yet? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => switchTo(mode === "signin" ? "signup" : "signin")}
            className="text-primary hover:text-primary-container font-medium transition-colors rounded"
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>

        <p className="text-center text-label-xs font-normal text-on-surface-variant mt-md">
          <Link href="/interact" className="text-primary hover:text-primary-container">
            Continue without an account
          </Link>{" "}
          — the rebalancing verdict does not require one.
        </p>
      </div>
    </main>
  );
}
