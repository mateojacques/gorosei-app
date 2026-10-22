import { ROLES, type Role } from "@/shared/pool";
import { t } from "@/shared/i18n";
import { cn } from "@/lib/utils";

/** Five toggles; the order they are tapped in is the preference order. The hidden input carries it as a list. */
export function RolePicker({ value, onChange, name = "roles" }: { value: Role[]; onChange: (roles: Role[]) => void; name?: string }) {
  function toggle(role: Role) {
    onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role]);
  }
  return (
    <div role="group" aria-label={t("pool.edit.title")} className="flex flex-wrap gap-2">
      <input type="hidden" name={name} value={value.join(",")} />
      {ROLES.map((role) => {
        const position = value.indexOf(role) + 1;
        return (
          <button
            key={role}
            type="button"
            aria-pressed={position > 0}
            aria-label={position > 0 ? t("pool.role.pick", { role: t(`pool.role.${role}`), position }) : t("pool.role.unpicked", { role: t(`pool.role.${role}`) })}
            onClick={() => toggle(role)}
            className={cn(
              "flex h-12 min-w-24 items-center justify-center gap-2 rounded-[4px] border-2 px-4 font-display text-lg font-extrabold uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cobalt-light",
              position > 0 ? "border-cobalt-light bg-cobalt text-ink" : "border-line text-ink-muted hover:border-ink-muted hover:text-ink",
            )}
          >
            {position > 0 && <span aria-hidden="true" className="text-cobalt-light tabular-nums">{position}</span>}
            <span aria-hidden="true">{t(`pool.role.${role}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

export const formatRoles = (roles: Role[]) => roles.map((r) => t(`pool.role.${r}`)).join(" · ");
