import { type FormEvent, useId, useState } from "react";
import { FormAlert } from "@/components/site/form";
import { Button } from "@/components/ui/button";
import { fromArtDateTimeLocal, toArtDateTimeLocal } from "@/shared/art-datetime";
import { t } from "@/shared/i18n";
import { type TournamentInput, tournamentInputSchema } from "@/shared/tournament";
import {
  DEFAULT_SHARED_VALUES,
  Group,
  type Issue,
  IssueList,
  type SharedFieldValues,
  TextField,
  TournamentFields,
  sharedFromValues,
  toSharedValues,
} from "./tournament-fields";

export type TournamentFormResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input"; issues: { path: string; message: string }[] }
  | { ok: false; reason: "not_found" | "not_editable" };

type Values = SharedFieldValues & Record<"title" | "edition" | "startsAt" | "registrationClosesAt", string>;

const NEW_TOURNAMENT: Values = {
  title: "",
  edition: "1",
  startsAt: "",
  registrationClosesAt: "",
  ...DEFAULT_SHARED_VALUES,
};

export function toFormValues(input: TournamentInput): Values {
  return {
    ...toSharedValues(input),
    title: input.title,
    edition: String(input.edition),
    startsAt: toArtDateTimeLocal(new Date(input.startsAt)),
    registrationClosesAt: toArtDateTimeLocal(new Date(input.registrationClosesAt)),
  };
}

/** Builds the input from the form and validates it with the same schema the server uses. */
function toInput(v: Values): { ok: true; input: TournamentInput } | { ok: false; issues: Issue[] } {
  const shared = sharedFromValues(v);
  if (!shared.ok) return shared;
  const parsed = tournamentInputSchema.safeParse({
    ...shared.data,
    title: v.title,
    edition: Number(v.edition),
    startsAt: fromArtDateTimeLocal(v.startsAt),
    registrationClosesAt: fromArtDateTimeLocal(v.registrationClosesAt),
  });
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

export function TournamentForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Values;
  submitLabel: string;
  onSubmit: (input: TournamentInput) => Promise<TournamentFormResult>;
}) {
  const id = useId();
  const [values, setValues] = useState<Values>(initial ?? NEW_TOURNAMENT);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const patch = (p: Partial<Values>) => setValues((v) => ({ ...v, ...p }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssues([]);
    setError(null);
    setSaved(false);
    const built = toInput(values);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setPending(true);
    try {
      const result = await onSubmit(built.input);
      if (result.ok) setSaved(true);
      else if (result.reason === "invalid_input") setIssues(result.issues);
      else setError(t(`admin.error.${result.reason}`));
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  const text = (key: "title" | "edition" | "startsAt" | "registrationClosesAt", label: string, props: object) => (
    <TextField id={`${id}-${key}`} label={label} value={values[key]} onChange={(value) => patch({ [key]: value })} {...props} />
  );

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-10">
      <Group title={t("admin.form.basics")}>
        {text("title", t("admin.form.title"), { required: true })}
        {text("edition", t("admin.form.edition"), { type: "number", min: 1, required: true })}
        {text("startsAt", t("admin.form.startsAt"), { type: "datetime-local", required: true })}
        {text("registrationClosesAt", t("admin.form.registrationClosesAt"), { type: "datetime-local", required: true })}
      </Group>
      <TournamentFields id={id} values={values} onChange={patch} />

      <IssueList issues={issues} />
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <p role="status">{t("admin.form.saved")}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
