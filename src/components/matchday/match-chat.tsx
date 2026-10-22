import { useEffect, useId, useRef, useState } from "react";
import { formatDateTime, t } from "@/shared/i18n";
import type { ChatMessage } from "../../server/matchday/chat";
import { postMessageFn } from "../../server/matchday/matchday.functions";
import { FormAlert } from "../site/form";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useMatchAction } from "./action";

const time = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function MatchChat({ matchId, messages }: { matchId: string; messages: ChatMessage[] }) {
  const id = useId();
  const [body, setBody] = useState("");
  const { run, error, pending } = useMatchAction();
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <h2 id={`${id}-h`} className="font-display text-2xl font-extrabold uppercase">
        {t("matchday.chat.title")}
      </h2>
      {messages.length === 0 ? (
        <p className="text-ink-muted">{t("matchday.chat.empty")}</p>
      ) : (
        <ol ref={list} aria-live="polite" className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-2">
          {messages.map((m) => (
            <li key={m.id} className="text-base [overflow-wrap:anywhere]">
              <span className="mr-2 text-sm text-ink-muted tabular-nums" title={formatDateTime(new Date(m.createdAt))}>
                {time.format(new Date(m.createdAt))}
              </span>
              {m.kind === "lobby" ? (
                <span className="text-ink-muted">{t("matchday.chat.lobbyLine", { name: m.body })}</span>
              ) : m.kind === "system" ? (
                <span className="text-ink-muted">{m.body}</span>
              ) : (
                <>
                  <strong className="mr-2 font-bold">{m.authorRiotId ?? "—"}</strong>
                  <span className="whitespace-pre-line">{m.body}</span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <form
        method="post"
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = body;
          void run(() => postMessageFn({ data: { matchId, body: text } })).then((ok) => ok && setBody(""));
        }}
      >
        <label htmlFor={`${id}-body`} className="sr-only">
          {t("matchday.chat.message")}
        </label>
        <Input id={`${id}-body`} value={body} maxLength={1000} placeholder={t("matchday.chat.message")} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={pending || !body.trim()}>
          {t("matchday.chat.send")}
        </Button>
      </form>
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
