import { type ReactNode, useMemo } from "react";
import { Field } from "@/components/site/form";
import { Input } from "@/components/ui/input";
import { describeRule, eligibilityRulesSchema } from "@/shared/eligibility";
import { t } from "@/shared/i18n";
import { RANK_SOURCES, type TournamentInput } from "@/shared/tournament";

/** The fields a tournament and a recurring template share, as form strings. */
export type SharedFieldValues = Record<
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

export type SharedInput = Omit<TournamentInput, "title" | "edition" | "startsAt" | "registrationClosesAt">;

export const DEFAULT_SHARED_VALUES: SharedFieldValues = {
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

export function toSharedValues(input: SharedInput): SharedFieldValues {
  return {
    bracket: input.bracket,
    draftMode: input.draftMode,
    bestOf: String(input.bestOf),
    finalsBestOf: String(input.finalsBestOf),
    teamCap: String(input.teamCap),
    maxSubs: String(input.maxSubs),
    subsCountForTeamRules: input.subsCountForTeamRules,
    rankSource: input.rankSource,
    eligibilityRules: JSON.stringify(input.eligibilityRules, null, 2),
    entryFeeArs: String(input.entryFeeArs),
    prizeGoalArs: String(input.prizeGoalArs),
    prizeSplit: input.prizeSplit.join(", "),
    paymentInstructions: input.paymentInstructions,
    rulesText: input.rulesText,
    streamUrl: input.streamUrl,
  };
}

export type Issue = { path: string; message: string };

function parseRules(text: string): { ok: true; rules: unknown } | { ok: false; issues: Issue[] } {
  try {
    return { ok: true, rules: JSON.parse(text) };
  } catch (error) {
    return { ok: false, issues: [{ path: "eligibilityRules", message: t("admin.form.rulesInvalidJson", { message: (error as Error).message }) }] };
  }
}

/** The shared values converted for schema parsing; the schema does the validating. */
export function sharedFromValues(v: SharedFieldValues): { ok: true; data: Record<string, unknown> } | { ok: false; issues: Issue[] } {
  const rules = parseRules(v.eligibilityRules);
  if (!rules.ok) return rules;
  return {
    ok: true,
    data: {
      ...v,
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
    },
  };
}

export const controlClass = "h-11 w-full rounded-[4px] border border-line bg-surface-raised px-3 text-ink";

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
      <legend className="pr-3 font-display text-xl font-extrabold uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  ...props
}: { id: string; label: string; value: string; onChange: (value: string) => void } & Omit<
  React.ComponentProps<typeof Input>,
  "id" | "value" | "onChange"
>) {
  return (
    <Field id={id} label={label}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...props} />
    </Field>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <Field id={id} label={label}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={controlClass}>
        {options.map(([option, name]) => (
          <option key={option} value={option}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="border border-line bg-surface-raised px-3 py-2.5 text-sm">
      <p className="font-semibold">{t("admin.form.issues")}</p>
      <ul className="mt-1 list-disc pl-5">
        {issues.map((issue) => (
          <li key={`${issue.path}-${issue.message}`}>{t("admin.form.issue", issue)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Format, roster and eligibility, money and texts: everything after the form's own basics. */
export function TournamentFields({
  id,
  values,
  onChange,
}: {
  id: string;
  values: SharedFieldValues;
  onChange: (patch: Partial<SharedFieldValues>) => void;
}) {
  const preview = useMemo(() => {
    const rules = parseRules(values.eligibilityRules);
    if (!rules.ok) return null;
    const parsed = eligibilityRulesSchema.safeParse(rules.rules);
    return parsed.success ? parsed.data.map(describeRule) : null;
  }, [values.eligibilityRules]);

  type Key = Exclude<keyof SharedFieldValues, "subsCountForTeamRules">;
  const text = (key: Key, label: string, props: Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange"> = {}) => (
    <TextField id={`${id}-${key}`} label={label} value={values[key]} onChange={(value) => onChange({ [key]: value })} {...props} />
  );
  const select = (key: Key, label: string, options: [string, string][]) => (
    <SelectField id={`${id}-${key}`} label={label} value={values[key]} onChange={(value) => onChange({ [key]: value })} options={options} />
  );
  const textarea = (key: Key, label: string, rows: number, mono = false) => (
    <Field id={`${id}-${key}`} label={label}>
      <textarea
        id={`${id}-${key}`}
        rows={rows}
        value={values[key]}
        onChange={(e) => onChange({ [key]: e.target.value })}
        className={`${controlClass} h-auto py-2 ${mono ? "font-mono text-sm" : ""}`}
      />
    </Field>
  );
  const bestOfOptions: [string, string][] = ["1", "3", "5"].map((n) => [n, `Bo${n}`]);

  return (
    <>
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
            onChange={(e) => onChange({ subsCountForTeamRules: e.target.checked })}
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
    </>
  );
}
