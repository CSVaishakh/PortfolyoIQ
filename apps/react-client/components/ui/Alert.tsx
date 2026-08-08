import type { ReactNode } from "react";
import { AlertTriangle, CircleAlert, Info, CircleCheck } from "lucide-react";
import { cn } from "./cn";

export type AlertTone = "info" | "warning" | "error" | "success";

const TONES: Record<AlertTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: {
    box: "bg-surface-container-low border-outline-variant",
    icon: "text-on-surface-variant",
    Icon: Info,
  },
  warning: {
    box: "bg-tertiary/5 border-tertiary/30",
    icon: "text-tertiary",
    Icon: AlertTriangle,
  },
  error: {
    box: "bg-error-container/10 border-error/25",
    icon: "text-error",
    Icon: CircleAlert,
  },
  success: {
    box: "bg-success/5 border-success/30",
    icon: "text-success",
    Icon: CircleCheck,
  },
};

interface AlertProps {
  tone?: AlertTone;
  /** Bolded lead-in, e.g. "Educational Prototype:". */
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * `alert` announces immediately — use for validation and failures. Leave unset
   * for standing disclosures, which should not interrupt (AX-05).
   */
  role?: "alert" | "status";
}

/**
 * Inline notice.
 *
 * Every tone pairs a colour with a distinct icon so the severity survives
 * greyscale and colour-vision differences (AX-06).
 */
export function Alert({ tone = "info", title, children, className, role }: AlertProps) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={role}
      className={cn("flex items-start gap-sm rounded-xl border p-md text-body-sm", box, className)}
    >
      <Icon aria-hidden="true" className={cn("size-5 shrink-0 mt-px", icon)} />
      <div className="text-on-surface-variant min-w-0">
        {title && <strong className="text-on-surface font-semibold">{title} </strong>}
        {children}
      </div>
    </div>
  );
}
