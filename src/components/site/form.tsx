import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border border-line bg-surface-raised px-3 py-2.5 text-sm font-semibold text-ink">
      {children}
    </p>
  );
}
