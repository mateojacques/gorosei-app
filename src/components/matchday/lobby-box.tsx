import { useId, useState } from "react";
import { t } from "@/shared/i18n";
import { postLobbyFn } from "../../server/matchday/matchday.functions";
import { Field, FormAlert } from "../site/form";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useMatchAction } from "./action";

/** The lobby the teams join. Moderators with no lobby yet get the form to publish one. */
export function LobbyBox({
  matchId,
  lobby,
  canCreate,
}: {
  matchId: string;
  lobby: { name: string; password: string } | null;
  canCreate: boolean;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { run, error, pending } = useMatchAction();
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <h2 id={`${id}-h`} className="font-display text-2xl font-extrabold uppercase">
        {t("matchday.lobby.title")}
      </h2>
      {lobby ? (
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-lg">
          <dt className="text-ink-muted">{t("matchday.lobby.name")}</dt>
          <dd className="font-semibold [overflow-wrap:anywhere] select-all">{lobby.name}</dd>
          <dt className="text-ink-muted">{t("matchday.lobby.password")}</dt>
          <dd className="font-semibold [overflow-wrap:anywhere] select-all">{lobby.password}</dd>
        </dl>
      ) : canCreate ? (
        <form
          method="post"
          className="flex max-w-md flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => postLobbyFn({ data: { matchId, name, password } }));
          }}
        >
          <Field id={`${id}-name`} label={t("matchday.lobby.createName")}>
            <Input id={`${id}-name`} value={name} required maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id={`${id}-pw`} label={t("matchday.lobby.createPassword")}>
            <Input id={`${id}-pw`} value={password} required maxLength={60} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" className="self-start" disabled={pending || !name.trim() || !password.trim()}>
            {t("matchday.lobby.create")}
          </Button>
          {error && <FormAlert>{error}</FormAlert>}
        </form>
      ) : (
        <p className="max-w-prose text-ink-muted">{t("matchday.lobby.none")}</p>
      )}
    </section>
  );
}
