import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { FormAlert } from "@/components/site/form";
import { formatRoles } from "@/components/pool/role-picker";
import { Th } from "@/components/team/team-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type getAdminPoolFn, previewPlacementFn, removeFromPoolFn } from "@/server/pool/pool.functions";
import { t } from "@/shared/i18n";
import { formatRank } from "@/shared/rank";

type Row = Awaited<ReturnType<typeof getAdminPoolFn>>[number];
type Preview = Awaited<ReturnType<typeof previewPlacementFn>>;

export function AdminPool({ tournamentId, rows }: { tournamentId: string; rows: Row[] }) {
  const headingId = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function showPreview() {
    setPending(true);
    setError(null);
    try {
      setPreview(await previewPlacementFn({ data: { tournamentId } }));
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="flex flex-col gap-6 border-t border-line pt-6">
      <h2 id={headingId} className="font-display text-2xl font-extrabold uppercase">
        {t("admin.pool.title")}
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-muted">{t("admin.pool.empty")}</p>
      ) : (
        <table aria-labelledby={headingId} className="w-full border-collapse text-left">
          <thead>
            <tr>
              <Th>{t("pool.col.player")}</Th>
              <Th>{t("pool.col.rank")}</Th>
              <Th>{t("pool.col.roles")}</Th>
              <Th>{t("admin.pool.autoPlace")}</Th>
              <Th>{t("pool.col.paid")}</Th>
              <Th>{t("pool.col.state")}</Th>
              <Th>
                <span className="sr-only">{t("pool.col.actions")}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PoolRow key={row.userId} tournamentId={tournamentId} row={row} />
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-col items-start gap-3">
        <Button variant="secondary" disabled={pending} onClick={showPreview}>
          {t("admin.pool.preview")}
        </Button>
        <p className="max-w-prose text-sm text-ink-muted">{t("admin.pool.previewNote")}</p>
        {error && <FormAlert>{error}</FormAlert>}
        {preview && <PreviewResult preview={preview} />}
      </div>
    </section>
  );
}

function PoolRow({ tournamentId, row }: { tournamentId: string; row: Row }) {
  const router = useRouter();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason) return;
    setPending(true);
    setError(null);
    try {
      const result = await removeFromPoolFn({ data: { tournamentId, userId: row.userId, reason } });
      if (!result.ok) setError(t(`pool.error.${result.reason}`));
      else await router.invalidate();
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }
  return (
    <tr className="border-b border-line align-top">
      <td className="py-3 pr-3 font-semibold [overflow-wrap:anywhere]">{row.riotId}</td>
      <td className="py-3 pr-3 font-display text-lg leading-tight font-extrabold uppercase">{formatRank(row.rank)}</td>
      <td className="py-3 pr-3 text-sm">{formatRoles(row.roles)}</td>
      <td className="py-3 pr-3">{t(row.autoPlace ? "admin.pool.yes" : "admin.pool.no")}</td>
      <td className="py-3 pr-3">{t(row.paid ? "admin.pool.yes" : "admin.pool.no")}</td>
      <td className="py-3 pr-3">{t(`admin.pool.state.${row.state}`)}</td>
      <td className="py-2">
        {row.state !== "left" && (
          <form onSubmit={remove} className="flex flex-col items-end gap-1">
            <label htmlFor={`${id}-reason`} className="sr-only">
              {t("admin.pool.removeReason")}
            </label>
            <Input id={`${id}-reason`} name="reason" required placeholder={t("admin.pool.removeReason")} className="h-9 w-40" />
            <Button type="submit" variant="ghost" size="sm" className="px-0" disabled={pending}>
              {t("admin.pool.remove")}
            </Button>
            {error && <FormAlert>{error}</FormAlert>}
          </form>
        )}
      </td>
    </tr>
  );
}

function PreviewResult({ preview }: { preview: Preview }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      {preview.teams.length === 0 && <p>{t("admin.pool.previewNone")}</p>}
      {preview.teams.map((team, i) => (
        <div key={team.captain}>
          <p className="font-semibold">{t("admin.pool.previewTeam", { n: i + 1, captain: team.captain })}</p>
          <ul className="text-sm text-ink-muted">
            {team.members.map((m) => (
              <li key={m.riotId}>
                {t(`pool.role.${m.role}`)}: {m.riotId}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {preview.unplaced.length > 0 && <p>{t("admin.pool.previewUnplaced", { players: preview.unplaced.join(", ") })}</p>}
      {preview.failing.length > 0 && <p>{t("admin.pool.previewFailing", { players: preview.failing.join(", ") })}</p>}
    </div>
  );
}
