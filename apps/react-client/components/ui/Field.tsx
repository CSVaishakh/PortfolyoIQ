"use client";

import { useId, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "./cn";

/**
 * The form field set.
 *
 * Every field is built from one shell so the accessibility wiring cannot drift
 * between them: a real `<label for>` (AX-03), helper and error text referenced
 * by `aria-describedby`, and errors carrying `role="alert"` (AX-05, AU-04).
 * Placeholders are never the label.
 */

const CONTROL =
  "w-full bg-surface text-on-surface text-body-sm rounded-lg py-sm pr-md outline-none " +
  "transition-shadow placeholder:text-outline focus:ring-2 focus:ring-primary " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const LABEL = "text-label-xs uppercase tracking-wider text-on-surface-variant";

interface FieldShellProps {
  id: string;
  label: ReactNode;
  /** One line on what this input changes in the result (AN-11). */
  hint?: ReactNode;
  error?: string;
  describedBy: string;
  /** Right-aligned adornment on the label row — a live value, a "Forgot?" link. */
  labelAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  describedBy,
  labelAction,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-xs min-w-0", className)}>
      <div className="flex items-center justify-between gap-sm">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        {labelAction}
      </div>
      {children}
      {error ? (
        <p id={`${describedBy}-error`} role="alert" className="text-label-xs text-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${describedBy}-hint`} className="text-label-xs font-normal text-outline">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Absolutely-positioned leading glyph; controls reserve space for it with `pl-xl`. */
function LeadingIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="absolute left-sm top-1/2 -translate-y-1/2 text-outline pointer-events-none flex items-center"
    >
      {children}
    </span>
  );
}

// ── Shared prop shape ─────────────────────────────────────────────────────────

interface BaseFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  icon?: ReactNode;
  autoComplete?: string;
  name?: string;
}

function describedByFor(id: string, error?: string, hint?: ReactNode): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

// ── Text ──────────────────────────────────────────────────────────────────────

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  disabled,
  placeholder,
  className,
  icon,
  autoComplete,
  name,
  type = "text",
}: BaseFieldProps & { type?: "text" | "email" }) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      describedBy={id}
      className={className}
    >
      <div className="relative">
        {icon && <LeadingIcon>{icon}</LeadingIcon>}
        <input
          id={id}
          name={name}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByFor(id, error, hint)}
          className={cn(CONTROL, icon ? "pl-xl" : "pl-md", error && "ring-1 ring-error")}
        />
      </div>
    </FieldShell>
  );
}

// ── Password ──────────────────────────────────────────────────────────────────

export function PasswordField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  disabled,
  placeholder,
  className,
  autoComplete,
  name,
  labelAction,
  minLength,
}: BaseFieldProps & { labelAction?: ReactNode; minLength?: number }) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      describedBy={id}
      labelAction={labelAction}
      className={className}
    >
      <div className="relative">
        <input
          id={id}
          name={name}
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          minLength={minLength}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByFor(id, error, hint)}
          className={cn(CONTROL, "pl-md pr-11", error && "ring-1 ring-error")}
        />
        {/*
         * AU-06: defaults to hidden, and reports its own state through
         * `aria-pressed` rather than only through the swapped glyph.
         */}
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-pressed={revealed}
          aria-label={revealed ? "Hide password" : "Show password"}
          className="absolute right-1 top-1/2 -translate-y-1/2 size-9 grid place-items-center rounded-lg text-outline hover:text-on-surface transition-colors"
        >
          {revealed ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    </FieldShell>
  );
}

// ── Number / currency ─────────────────────────────────────────────────────────

interface NumberFieldProps extends BaseFieldProps {
  min?: number;
  max?: number;
  step?: number;
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
  placeholder,
  className,
  icon,
  min,
  max,
  step,
  name,
}: NumberFieldProps) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      describedBy={id}
      className={className}
    >
      <div className="relative">
        {icon && <LeadingIcon>{icon}</LeadingIcon>}
        <input
          id={id}
          name={name}
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByFor(id, error, hint)}
          className={cn(CONTROL, icon ? "pl-xl" : "pl-md", error && "ring-1 ring-error")}
        />
      </div>
    </FieldShell>
  );
}

/** A number field with a ₹ affix. Accepts plain digits; the symbol is decoration (AN-13). */
export function CurrencyField(props: Omit<NumberFieldProps, "icon">) {
  return <NumberField {...props} icon={<span className="text-body-sm">₹</span>} />;
}

// ── Date ──────────────────────────────────────────────────────────────────────

export function DateField({
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
  className,
  icon,
  max,
  name,
}: BaseFieldProps & { max?: string }) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      describedBy={id}
      className={className}
    >
      <div className="relative">
        {icon && <LeadingIcon>{icon}</LeadingIcon>}
        <input
          id={id}
          name={name}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          max={max}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByFor(id, error, hint)}
          className={cn(CONTROL, icon ? "pl-xl" : "pl-md", error && "ring-1 ring-error")}
        />
      </div>
    </FieldShell>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  disabled,
  className,
  icon,
  name,
}: Omit<BaseFieldProps, "placeholder"> & { options: SelectOption[] }) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      describedBy={id}
      className={className}
    >
      <div className="relative">
        {icon && <LeadingIcon>{icon}</LeadingIcon>}
        <select
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByFor(id, error, hint)}
          className={cn(
            CONTROL,
            "appearance-none cursor-pointer pr-10",
            icon ? "pl-xl" : "pl-md",
            error && "ring-1 ring-error",
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="absolute right-sm top-1/2 -translate-y-1/2 text-outline pointer-events-none"
        >
          ▾
        </span>
      </div>
    </FieldShell>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────

interface SliderFieldProps extends Omit<BaseFieldProps, "placeholder" | "icon"> {
  min: number;
  max: number;
  step: number;
  /** Anchor captions under each end of the track (AN-12). */
  minLabel: string;
  maxLabel: string;
}

/**
 * Risk preference.
 *
 * A bare 0–10 number is meaningless to someone meeting the concept for the
 * first time, so the track carries anchored captions and the current value is
 * shown beside the label (AN-12).
 */
export function SliderField({
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
  className,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  name,
}: SliderFieldProps) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      describedBy={id}
      className={className}
      labelAction={<span className="text-body-sm font-semibold text-primary">{value}</span>}
    >
      <input
        id={id}
        name={name}
        type="range"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        aria-describedby={describedByFor(id, error, hint)}
        className="w-full accent-primary h-2 bg-surface rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container"
      />
      <div className="flex justify-between text-label-xs text-outline">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </FieldShell>
  );
}
