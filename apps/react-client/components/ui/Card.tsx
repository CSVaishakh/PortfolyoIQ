import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** `section` by default; pass `div` where the content isn't a landmark. */
  as?: ElementType;
  /** Wires the section to its heading for assistive technology. */
  "aria-labelledby"?: string;
  "aria-live"?: "polite" | "assertive" | "off";
  id?: string;
}

/**
 * The panel surface used by every zone on every screen: `surface-container`,
 * 16px radius, 24px padding, 16px internal gap.
 */
export function Card({ children, className, as: Tag = "section", ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        "bg-surface-container rounded-2xl p-lg flex flex-col gap-md",
        "shadow-sm border border-outline-variant/40",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  /** Rendered as the card's heading. Pair with `id` so `Card` can reference it. */
  title: ReactNode;
  id?: string;
  /** Heading rank — kept sequential per route (AX-09). */
  level?: 2 | 3 | 4;
  /** Right-aligned control: an action link, a badge, a timestamp. */
  action?: ReactNode;
  className?: string;
}

/** Card heading with its underline rule and optional trailing action. */
export function CardHeader({ title, id, level = 3, action, className }: CardHeaderProps) {
  const Heading = `h${level}` as ElementType;
  return (
    <header
      className={cn(
        "flex flex-wrap justify-between items-center gap-sm pb-sm border-b border-outline-variant",
        className,
      )}
    >
      <Heading id={id} className="text-title-lg text-on-surface flex items-center gap-sm">
        {title}
      </Heading>
      {action}
    </header>
  );
}

/** Uppercase micro-label introducing a block inside a card. */
export function FieldsetLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-label-xs uppercase tracking-wider text-on-surface-variant", className)}>
      {children}
    </span>
  );
}
