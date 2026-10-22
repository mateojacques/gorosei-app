import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";
import { Field, FormAlert } from "@/components/site/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fromArtDateTimeLocal, toArtDateTimeLocal } from "@/shared/art-datetime";
import { describeRule, eligibilityRulesSchema } from "@/shared/eligibility";
import { t } from "@/shared/i18n";
import { RANK_SOURCES, type TournamentInput, tournamentInputSchema } from "@/shared/tournament";

export type TournamentFormResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input"; issues: { path: string; message: string }[] }
  | { ok: false; reason: "not_found" | "not_editable" };

type Values = Record<
  | "title"
  | "edition"
  | "startsAt"
  | "registrationClosesAt"
  | "bracket"
  | "draftMode"
  | "bestOf"
  | "finalsBestOf"
  | "teamCap"
  | "maxSubs"
  | "rankSource"
  | "eligibilityRules"
  | "entryFeeArs"
  | "prizeGoalArs"
  | "prizeSplit"
  | "paymentInstructions"
  | "rulesText"
  | "streamUrl",
  string
> & { subsCountForTeamRules: boolean };

const NEW_TOURNAMENT: Values = {
  title: "",
  edition: "1",
  startsAt: "",
  registrationClosesAt: "",
  bracket: "double_elimination",
  draftMode: "tournament_draft",
  bestOf: "1",
  finalsBestOf: "3",
  teamCap: "16",
  maxSubs: "1",
  subsCountForTeamRules: false,
  rankSource: "peak_season",
  eligibilityRules: "[]",
  entryFeeArs: "5000",
  prizeGoalArs: "300000",
  prizeSplit: "70, 30",
  paymentInstructions: "",
  rulesText: "",
  streamUrl: "",
};

export function toFormValues(input: TournamentInput): Values {
  return {
    ...input,
    edition: String(input.edition),
    startsAt: toArtDateTimeLocal(new Date(input.startsAt)),
    registrationClosesAt: toArtDateTimeLocal(new Date(input.registrationClosesAt)),
    bestOf: String(input.bestOf),
    finalsBestOf: String(input.finalsBestOf),
    teamCap: String(input.teamCap),
    maxSubs: String(input.maxSubs),
    eligibilityRules: JSON.stringify(input.eligibilityRules, null, 2),
    entryFeeArs: String(input.entryFeeArs),
    prizeGoalArs: String(input.prizeGoalArs),
    prizeSplit: input.prizeSplit.join(", "),
  };
}

type Issue = { path: string; message: string };

function parseRules(text: string): { ok: true; rules: unknown } | { ok: false; issues: Issue[] } {
  try {
    return { ok: true, rules: JSON.parse(text) };
  } catch (error) {
    return { ok: false, issues: [{ path: "eligibilityRules", message: t("admin.form.rulesInvalidJson", { message: (error as Error).message }) }] };
  }
}

/** Builds the input from the form and validates it with the same schema the server uses. */
function toInput(v: Values): { ok: true; input: TournamentInput } | { ok: false; issues: Issue[] } {
  const rules = parseRules(v.eligibilityRules);
  if (!rules.ok) return rules;
  const parsed = tournamentInputSchema.safeParse({
    ...v,
    edition: Number(v.edition),
    startsAt: fromArtDateTimeLocal(v.startsAt),
    registrationClosesAt: fromArtDateTimeLocal(v.registrationClosesAt),
    bestOf: Number(v.bestOf),
    finalsBestOf: Number(v.finalsBestOf),
    teamCap: Number(v.teamCap),
    maxSubs: Number(v.maxSubs),
    eligibilityRules: rules.rules,
    entryFeeArs: Number(v.entryFeeArs),
    prizeGoalArs: Number(v.prizeGoalArs),
    prizeSplit: v.prizeSplit
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
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

  const preview = useMemo(() => {
    const rules = parseRules(values.eligibilityRules);
    if (!rules.ok) return null;
    const parsed = eligibilityRulesSchema.safeParse(rules.rules);
    return parsed.success ? parsed.data.map(describeRule) : null;
  }, [values.eligibilityRules]);

  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

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

  const text = (key: keyof Values, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field id={`${id}-${key}`} label={label}>
      <Input id={`${id}-${key}`} value={values[key] as string} onChange={set(key)} {...props} />
    </Field>
  );
  const select = (key: keyof Values, label: string, options: [string, string][]) => (
    <Field id={`${id}-${key}`} label={label}>
      <select id={`${id}-${key}`} value={values[key] as string} onChange={set(key)} className={controlClass}>
        {options.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );
  const textarea = (key: keyof Values, label: string, rows: number, mono = false) => (
    <Field id={`${id}-${key}`} label={label}>
      <textarea
        id={`${id}-${key}`}
        rows={rows}
        value={values[key] as string}
        onChange={set(key)}
        className={`${controlClass} h-auto py-2 ${mono ? "font-mono text-sm" : ""}`}
      />
    </Field>
  );
  const bestOfOptions: [string, string][] = ["1", "3", "5"].map((n) => [n, `Bo${n}`]);

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-10">
      <Group title={t("admin.form.basics")}>
        {text("title", t("admin.form.title"), { required: true })}
        {text("edition", t("admin.form.edition"), { type: "number", min: 1, required: true })}
        {text("startsAt", t("admin.form.startsAt"), { type: "datetime-local", required: true })}
        {text("registrationClosesAt", t("admin.form.registrationClosesAt"), { type: "datetime-local", required: true })}
      </Group>
      <Group title={t("admin.form.format")}>
        {select("bracket", t("admin.form.bracket"), [
          ["double_elimination", t("cup.bracket.double_elimination")],
          ["single_elimination", t("cup.bracket.single_elimination")],
        ])}
        {select("draftMode", t("admin.form.draftMode"), [
          ["tournament_draft", t("tournament.draftMode.tournament_draft")],
          ["blind_pick", t("tournament.draftMode.blind_pick")],
        ])}
        {select("bestOf", t("admin.form.bestOf"), bestOfOptions)}
        {select("finalsBestOf", t("admin.form.finalsBestOf"), bestOfOptions)}
        {text("teamCap", t("admin.form.teamCap"), { type: "number", min: 2, max: 128 })}
      </Group>
      <Group title={t("admin.form.roster")}>
        {select("maxSubs", t("admin.form.maxSubs"), [
          ["0", "0"],
          ["1", "1"],
          ["2", "2"],
        ])}
        {select(
          "rankSource",
          t("admin.form.rankSource"),
          RANK_SOURCES.map((s) => [s, t(`admin.form.rankSource.${s}`)]),
        )}
        <label className="flex items-center gap-3 sm:col-span-2">
          <input
            type="checkbox"
            className="size-5 accent-cobalt-light"
            checked={values.subsCountForTeamRules}
            onChange={(e) => setValues((v) => ({ ...v, subsCountForTeamRules: e.target.checked }))}
          />
          {t("admin.form.subsCountForTeamRules")}
        </label>
        <div className="flex flex-col gap-3 sm:col-span-2">
          {textarea("eligibilityRules", t("admin.form.eligibilityRules"), 8, true)}
          {preview && preview.length > 0 && (
            <div className="text-sm">
              <p className="text-ink-muted">{t("admin.form.rulesPreview")}</p>
              <ul className="mt-1 list-disc pl-5">
                {preview.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Group>
      <Group title={t("admin.form.money")}>
        {text("entryFeeArs", t("admin.form.entryFeeArs"), { type: "number", min: 0 })}
        {text("prizeGoalArs", t("admin.form.prizeGoalArs"), { type: "number", min: 0 })}
        <div className="sm:col-span-2">{text("prizeSplit", t("admin.form.prizeSplit"))}</div>
      </Group>
      <Group title={t("admin.form.texts")}>
        <div className="sm:col-span-2">{textarea("paymentInstructions", t("admin.form.paymentInstructions"), 3)}</div>
        <div className="sm:col-span-2">{textarea("rulesText", t("admin.form.rulesText"), 8)}</div>
        <div className="sm:col-span-2">{text("streamUrl", t("admin.form.streamUrl"), { type: "url" })}</div>
      </Group>

      {issues.length > 0 && (
        <div role="alert" className="border border-line bg-surface-raised px-3 py-2.5 text-sm">
          <p className="font-semibold">{t("admin.form.issues")}</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>{t("admin.form.issue", issue)}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <p role="status">{t("admin.form.saved")}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}

const controlClass = "h-11 w-full rounded-[4px] border border-line bg-surface-raised px-3 text-ink";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
      <legend className="pr-3 font-display text-xl font-extrabold uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}
