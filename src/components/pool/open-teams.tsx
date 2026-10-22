import { Th } from "@/components/team/team-ui";
import { Button } from "@/components/ui/button";
import { t } from "@/shared/i18n";
import type { OpenTeam } from "@/server/pool/requests";

export function OpenTeamsTable({
  headingId,
  teams,
  disabled,
  onRequest,
}: {
  headingId: string;
  teams: OpenTeam[];
  disabled: boolean;
  onRequest: (registrationId: string) => void;
}) {
  if (teams.length === 0) return <p className="mt-2 text-ink-muted">{t("pool.teams.empty")}</p>;
  return (
    <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
      <thead>
        <tr>
          <Th>{t("pool.col.team")}</Th>
          <Th>{t("pool.col.players")}</Th>
          <Th>
            <span className="sr-only">{t("pool.col.actions")}</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {teams.map((team) => (
          <tr key={team.registrationId} className="border-b border-line align-top">
            <td className="py-3 pr-3">
              <a
                href={`/equipos/${team.teamSlug}`}
                className="font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:text-cobalt-light hover:underline"
              >
                {team.teamName}
              </a>
              <span className="block text-sm text-ink-muted [overflow-wrap:anywhere]">
                {t("pool.col.captain")}: {team.captainRiotId}
              </span>
            </td>
            <td className="py-3 pr-3 tabular-nums">{t("pool.players", { count: team.starterCount })}</td>
            <td className="py-2 text-right">
              <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onRequest(team.registrationId)}>
                {t("pool.action.request")}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
