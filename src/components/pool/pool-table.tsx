import { Th } from "@/components/team/team-ui";
import { Button } from "@/components/ui/button";
import { t } from "@/shared/i18n";
import { formatRank } from "@/shared/rank";
import type { PoolListing } from "@/server/pool/pool";
import { formatRoles } from "./role-picker";

/** Available free agents, best rank first; captains invite from here. */
export function PoolTable({
  headingId,
  players,
  disabled,
  onInvite,
}: {
  headingId: string;
  players: PoolListing[];
  disabled: boolean;
  onInvite: (userId: string) => void;
}) {
  if (players.length === 0) return <p className="mt-2 text-ink-muted">{t("pool.captain.empty")}</p>;
  return (
    <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
      <thead>
        <tr>
          <Th>{t("pool.col.player")}</Th>
          <Th>{t("pool.col.rank")}</Th>
          <Th>{t("pool.col.roles")}</Th>
          <Th>
            <span className="sr-only">{t("pool.col.actions")}</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {players.map((player) => (
          <tr key={player.userId} className="border-b border-line align-top">
            <td className="py-3 pr-3">
              <span className="font-semibold [overflow-wrap:anywhere]">{player.riotId}</span>
              <span className="block text-sm text-ink-muted">{t("pool.col.level")} {player.level}</span>
            </td>
            <td className="py-3 pr-3 font-display text-lg leading-tight font-extrabold uppercase">{formatRank(player.rank)}</td>
            <td className="py-3 pr-3 text-sm">{formatRoles(player.roles)}</td>
            <td className="py-2 text-right">
              <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onInvite(player.userId)}>
                {t("pool.action.invite")}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
