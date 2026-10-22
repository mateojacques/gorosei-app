import { useId, useState } from "react";
import { t } from "@/shared/i18n";
import { setMatchVodFn } from "../../server/matchday/matchday.functions";
import { Field, FormAlert } from "../site/form";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useMatchAction } from "./action";

/** The match's recorded broadcast as a plain link; moderators get the form to set or clear it. */
export function VodBox({ matchId, vodUrl, canEdit }: { matchId: string; vodUrl: string | null; canEdit: boolean }) {
  const id = useId();
  const [url, setUrl] = useState(vodUrl ?? "");
  const { run, error, pending } = useMatchAction();
  if (!vodUrl && !canEdit) return null;
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <h2 id={`${id}-h`} className="font-display text-2xl font-extrabold uppercase">
        {t("matchday.vod.title")}
      </h2>
      {vodUrl && (
        <p>
          <a href={vodUrl} rel="noopener noreferrer nofollow" target="_blank" className="font-semibold underline [overflow-wrap:anywhere]">
            {t("matchday.vod.watch")}
          </a>
        </p>
      )}
      {canEdit && (
        <form
          method="post"
          className="flex max-w-md flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => setMatchVodFn({ data: { matchId, url: url.trim() || null } }));
          }}
        >
          <Field id={`${id}-url`} label={t("matchday.vod.field")}>
            <Input id={`${id}-url`} type="url" inputMode="url" value={url} maxLength={300} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" className="self-start" disabled={pending}>
            {t("matchday.vod.save")}
          </Button>
          {error && <FormAlert>{error}</FormAlert>}
        </form>
      )}
    </section>
  );
}
