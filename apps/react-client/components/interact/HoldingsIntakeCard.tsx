"use client";

import { Download } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Alert } from "@/components/ui/Alert";
import { COLUMN_ALIASES, TEMPLATE_COLUMNS } from "@/lib/copy";
import { formatCurrency, pluralise } from "@/lib/format";

interface ColumnTier {
  label: string;
  /** Dot colour — paired with the tier label, never the only signal (AX-06). */
  dot: string;
  columns: readonly string[];
}

/** AN-02: the three tiers are visually distinct because they mean different things. */
const TIERS: ColumnTier[] = [
  { label: "Required", dot: "bg-error", columns: TEMPLATE_COLUMNS.required },
  {
    label: "Required for a decision",
    dot: "bg-tertiary",
    columns: TEMPLATE_COLUMNS.requiredForDecision,
  },
  { label: "Optional", dot: "bg-outline", columns: TEMPLATE_COLUMNS.optional },
];

export interface FilePreview {
  holdings: number;
  totalValueInr: number;
  declaredTargetTotal: number | null;
}

interface HoldingsIntakeCardProps {
  file: File | null;
  onFileSelected: (file: File) => void;
  rejection: string | null;
  onRejected: (reason: string) => void;
  /** AN-06: what the file contains, shown before the run rather than after it. */
  preview: FilePreview | null;
  disabled?: boolean;
}

export function HoldingsIntakeCard({
  file,
  onFileSelected,
  rejection,
  onRejected,
  preview,
  disabled,
}: HoldingsIntakeCardProps) {
  return (
    <Card aria-labelledby="intake-heading">
      <CardHeader
        id="intake-heading"
        title="1. Holdings data"
        level={2}
        action={
          <a
            href="/templates/portfolio-template.xlsx"
            download="portfolio-template.xlsx"
            className="text-label-xs text-primary hover:text-primary-container transition-colors flex items-center gap-xs rounded-lg"
          >
            <Download aria-hidden="true" className="size-4" />
            Download template
          </a>
        }
      />

      <FileDropzone
        label="Upload file (.csv, .xlsx, .xls)"
        file={file}
        onFileSelected={onFileSelected}
        onRejected={onRejected}
        disabled={disabled}
      />

      {rejection && (
        <Alert tone="error" role="alert">
          {rejection}
        </Alert>
      )}

      {preview && (
        <div className="grid grid-cols-3 gap-sm rounded-lg bg-surface p-sm">
          <PreviewFigure label="Holdings" value={String(preview.holdings)} />
          <PreviewFigure label="Portfolio value" value={formatCurrency(preview.totalValueInr)} />
          <PreviewFigure
            label="Declared targets"
            value={
              preview.declaredTargetTotal === null
                ? "Incomplete"
                : `${preview.declaredTargetTotal.toFixed(1)}%`
            }
            tone={preview.declaredTargetTotal === null ? "warn" : "normal"}
          />
        </div>
      )}

      <div className="rounded-lg bg-surface p-sm flex flex-col gap-xs">
        {TIERS.map((tier) => (
          <div key={tier.label} className="flex flex-wrap items-baseline gap-x-xs gap-y-0.5">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full inline-block translate-y-px ${tier.dot}`}
            />
            <span className="text-label-xs text-on-surface-variant">{tier.label}:</span>
            <span className="font-mono text-[11px] text-on-surface break-words">
              {tier.columns.join(" · ")}
            </span>
          </div>
        ))}
        <p className="text-label-xs font-normal text-outline mt-xs">
          Header names are matched case-insensitively. Also accepted:{" "}
          {Object.entries(COLUMN_ALIASES)
            .map(([canonical, aliases]) => `${canonical} → ${aliases.join(", ")}`)
            .join("; ")}
          .
        </p>
        <p className="text-label-xs font-normal text-outline">
          {pluralise(TEMPLATE_COLUMNS.required.length, "required column")}. This is a fixed
          template — broker exports are not auto-mapped.
        </p>
      </div>
    </Card>
  );
}

function PreviewFigure({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "warn";
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-label-xs uppercase tracking-wider text-on-surface-variant">{label}</span>
      <span
        className={`text-body-sm font-semibold break-words ${tone === "warn" ? "text-tertiary" : "text-on-surface"}`}
      >
        {value}
      </span>
    </div>
  );
}
