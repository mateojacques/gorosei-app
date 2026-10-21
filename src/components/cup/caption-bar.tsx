import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A broadcast lower-third: a cobalt block with the compact fact, then a light bar with the running value.
export function CaptionBar({ block, children, className }: { block: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap font-display text-lg leading-none font-extrabold uppercase sm:text-xl", className)}>
      <div className="bg-cobalt px-3 py-2.5 tracking-[0.04em] text-ink">{block}</div>
      <div className="grow bg-ink px-3 sm:grow-0 py-2.5 tracking-[0.02em] text-surface">{children}</div>
    </div>
  );
}
