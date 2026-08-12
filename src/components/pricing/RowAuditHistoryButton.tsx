import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small expand/collapse control for per-row audit history. */
export function RowAuditExpandButton({
  expanded,
  onToggle,
  fsnId,
}: {
  expanded: boolean;
  onToggle: () => void;
  fsnId: string;
}) {
  return (
    <button
      type="button"
      title={expanded ? "Hide audit history" : "Show audit history"}
      aria-expanded={expanded}
      aria-label={`Audit history for ${fsnId}`}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
    </button>
  );
}
