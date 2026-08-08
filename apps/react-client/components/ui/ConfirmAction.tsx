"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";
import { cn } from "./cn";

interface ConfirmActionProps {
  /** The button label in the resting state. */
  children: ReactNode;
  /** Short, uppercase framing of the consequence — "Destructive action". */
  confirmTitle: string;
  /** One sentence naming exactly what will change (AD-03). */
  confirmMessage: string;
  confirmLabel?: string;
  onConfirm: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  disabled?: boolean;
  /** Reason the action is unavailable; shown instead of the button (AD-05). */
  disabledReason?: string;
  busy?: boolean;
  busyLabel?: string;
}

/**
 * Two-step trigger for state-mutating operations.
 *
 * The confirmation names the effect rather than asking "are you sure?", because
 * the operator needs to know that confirming activates a new global model
 * version for every connected client (AD-03).
 */
export function ConfirmAction({
  children,
  confirmTitle,
  confirmMessage,
  confirmLabel = "Confirm",
  onConfirm,
  variant = "primary",
  icon,
  disabled,
  disabledReason,
  busy,
  busyLabel,
}: ConfirmActionProps) {
  const [armed, setArmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  if (disabled && disabledReason) {
    return (
      <div className="flex flex-col gap-xs">
        <Button variant={variant} fullWidth disabled>
          {icon}
          {children}
        </Button>
        <p className="text-label-xs text-tertiary">{disabledReason}</p>
      </div>
    );
  }

  if (!armed) {
    return (
      <Button
        variant={variant}
        fullWidth
        disabled={disabled}
        busy={busy}
        busyLabel={busyLabel}
        onClick={() => setArmed(true)}
      >
        {!busy && icon}
        {children}
      </Button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={`${messageId}-title`}
      aria-describedby={messageId}
      onKeyDown={(e) => {
        if (e.key === "Escape") setArmed(false);
      }}
      className={cn(
        "flex flex-col gap-sm rounded-lg border border-error/40 bg-error-container/10 p-sm",
      )}
    >
      <p
        id={`${messageId}-title`}
        className="text-label-xs uppercase tracking-widest text-error font-semibold"
      >
        {confirmTitle}
      </p>
      <p id={messageId} className="text-label-xs text-on-surface-variant">
        {confirmMessage}
      </p>
      <div className="flex gap-sm">
        <Button variant="secondary" size="sm" fullWidth onClick={() => setArmed(false)}>
          Cancel
        </Button>
        <Button
          ref={confirmRef}
          variant="danger"
          size="sm"
          fullWidth
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
