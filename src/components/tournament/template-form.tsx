import { type FormEvent, useId, useState } from "react";
import { FormAlert } from "@/components/site/form";
import { Button } from "@/components/ui/button";
import { t } from "@/shared/i18n";
import { type TemplateInput, templateInputSchema } from "@/shared/templates";
import {
  DEFAULT_SHARED_VALUES,
  Group,
  type Issue,
  IssueList,
  SelectField,
  type SharedFieldValues,
  TextField,
  TournamentFields,
  sharedFromValues,
  toSharedValues,
} from "./tournament-fields";

export type TemplateFormResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input"; issues: { path: string; message: string }[] }
  | { ok: false; reason: "not_found" };

type OwnKey =
  | "title"
  | "weekday"
  | "startTime"
  | "registrationOpensDaysBefore"
  | "registrationClosesMinutesBefore"
  | "nextEdition";
type Values = SharedFieldValues & Record<OwnKey, string> & { active: boolean };

const NEW_TEMPLATE: Values = {
  title: "",
  weekday: "6",
  startTime: "18:00",
  registrationOpensDaysBefore: "7",
  registrationClosesMinutesBefore: "120",
  nextEdition: "1",
  active: true,
  ...DEFAULT_SHARED_VALUES,
};

export function toTemplateFormValues(input: TemplateInput): Values {
  return {
    ...toSharedValues(input),
    title: input.title,
    weekday: String(input.weekday),
    startTime: input.startTime,
    registrationOpensDaysBefore: String(input.registrationOpensDaysBefore),
    registrationClosesMinutesBefore: String(input.registrationClosesMinutesBefore),
    nextEdition: String(input.nextEdition),
    active: input.active,
  };
}

function toInput(v: Values): { ok: true; input: TemplateInput } | { ok: false; issues: Issue[] } {
  const shared = sharedFromValues(v);
  if (!shared.ok) return shared;
  const parsed = templateInputSchema.safeParse({
    ...shared.data,
    title: v.title,
    weekday: Number(v.weekday),
    startTime: v.startTime.trim(),
    registrationOpensDaysBefore: Number(v.registrationOpensDaysBefore),
    registrationClosesMinutesBefore: Number(v.registrationClosesMinutesBefore),
    nextEdition: Number(v.nextEdition),
    active: v.active,
  });
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

export function TemplateForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Values;
  submitLabel: string;
  onSubmit: (input: TemplateInput) => Promise<TemplateFormResult>;
}) {
  const id = useId();
  const [values, setValues] = useState<Values>(initial ?? NEW_TEMPLATE);
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
      else setError(t("admin.template.error.not_found"));
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  const text = (key: OwnKey, label: string, props: object = {}) => (
    <TextField id={`${id}-${key}`} label={label} value={values[key]} onChange={(value) => patch({ [key]: value })} {...props} />
  );
  const startTimeInvalid = issues.some((i) => i.path === "startTime");
  // The start time gets its own message next to the field; the list keeps the rest.
  const otherIssues = issues.filter((i) => i.path !== "startTime");
  const startTimeErrorId = `${id}-startTime-error`;

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-10">
      <Group title={t("admin.form.basics")}>
        <div className="sm:col-span-2">{text("title", t("admin.form.title"), { required: true })}</div>
      </Group>
      <Group title={t("admin.template.form.schedule")}>
        <SelectField
          id={`${id}-weekday`}
          label={t("admin.template.form.weekday")}
          value={values.weekday}
          onChange={(weekday) => patch({ weekday })}
          options={[1, 2, 3, 4, 5, 6, 0].map((d) => [String(d), t(`template.weekday.${d as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)])}
        />
        <div className="flex flex-col gap-2">
          {text("startTime", t("admin.template.form.startTime"), {
            inputMode: "numeric",
            placeholder: "18:00",
            required: true,
            "aria-invalid": startTimeInvalid || undefined,
            "aria-describedby": startTimeInvalid ? startTimeErrorId : undefined,
          })}
          {startTimeInvalid && (
            <p id={startTimeErrorId} className="text-sm font-semibold text-ink">
              {t("admin.template.form.startTimeInvalid")}
            </p>
          )}
        </div>
        {text("registrationOpensDaysBefore", t("admin.template.form.opensDaysBefore"), { type: "number", min: 1, max: 28 })}
        {text("registrationClosesMinutesBefore", t("admin.template.form.closesMinutesBefore"), {
          type: "number",
          min: 60,
          max: 10080,
        })}
        {text("nextEdition", t("admin.template.form.nextEdition"), { type: "number", min: 1, required: true })}
        <label className="flex items-start gap-3 sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 size-5 accent-cobalt-light"
            checked={values.active}
            onChange={(e) => patch({ active: e.target.checked })}
            aria-describedby={`${id}-active-hint`}
          />
          <span>
            {t("admin.template.form.active")}
            <span id={`${id}-active-hint`} className="block text-sm text-ink-muted">
              {t("admin.template.form.activeHint")}
            </span>
          </span>
        </label>
      </Group>
      <TournamentFields id={id} values={values} onChange={patch} />

      <IssueList issues={otherIssues} />
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <p role="status">{t("admin.form.saved")}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
