"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { FileUp, FileCheck2 } from "lucide-react";
import { cn } from "./cn";

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;
/** DV-06: refuse oversized files rather than freezing the main thread parsing them. */
const MAX_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Named rejection reason, or null when the file is acceptable (AN-03). */
function rejectionReason(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return `“${file.name}” is a ${extension || "an unrecognised"} file. Upload a ${ACCEPTED_EXTENSIONS.join(", ")} file instead.`;
  }
  if (file.size > MAX_BYTES) {
    return `“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`;
  }
  return null;
}

interface FileDropzoneProps {
  file: File | null;
  onFileSelected: (file: File) => void;
  /** Called with a human-readable cause when a dropped or picked file is refused. */
  onRejected: (reason: string) => void;
  label: string;
  disabled?: boolean;
}

/**
 * Upload control.
 *
 * A real `<label>` wrapping a real `<input type="file">`: focusable, activatable
 * with Enter and Space, named by its label, and carrying a visible focus ring —
 * the previous `div` with an `onClick` handler was neither (AN-04, AX-02).
 * Drag-and-drop is layered on top rather than being the only route in.
 */
export function FileDropzone({
  file,
  onFileSelected,
  onRejected,
  label,
  disabled,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const labelId = useId();

  function accept(candidate: File | undefined): void {
    if (!candidate) return;
    const reason = rejectionReason(candidate);
    if (reason) {
      onRejected(reason);
      // Clear the input so re-picking the same bad file fires `change` again.
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onFileSelected(candidate);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    accept(event.dataTransfer.files[0]);
  }

  return (
    <div className="flex flex-col gap-xs">
      <span id={labelId} className="text-label-xs uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center gap-sm text-center",
          "rounded-xl border-2 border-dashed p-lg min-h-40 transition-colors duration-200",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          dragging
            ? "border-primary bg-primary/10"
            : file
              ? "border-success/50 bg-success/5"
              : "border-outline-variant hover:border-outline bg-surface/40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          disabled={disabled}
          aria-labelledby={labelId}
          className="sr-only"
          onChange={(e) => accept(e.target.files?.[0])}
        />
        {file ? (
          <>
            <FileCheck2 aria-hidden="true" className="size-7 text-success" />
            <span className="text-body-sm font-medium text-on-surface break-all">{file.name}</span>
            <span className="text-label-xs text-on-surface-variant">
              {formatBytes(file.size)} · Click or drop to replace
            </span>
          </>
        ) : (
          <>
            <FileUp aria-hidden="true" className="size-7 text-on-surface-variant" />
            <span className="text-body-sm text-on-surface">Drag &amp; drop or click to select</span>
            <span className="text-label-xs text-outline">
              Accepts {ACCEPTED_EXTENSIONS.join(", ")} up to {formatBytes(MAX_BYTES)}
            </span>
          </>
        )}
      </label>
    </div>
  );
}
