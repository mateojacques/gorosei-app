import type * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-[4px] border border-line bg-surface-raised px-3 text-base text-ink transition-colors placeholder:text-ink-muted hover:border-ink-muted focus-visible:border-cobalt-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-light disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
