import { expect, test } from "bun:test";
import { createResendMailer } from "../../../src/server/email/mailer";

const message = { to: "p@test.local", subject: "Hola", text: "texto", html: "<p>texto</p>" };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

test("posts the message to Resend with the key", async () => {
  const { calls, fetch } = fakeFetch(() => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
  const mailer = createResendMailer({ apiKey: "re_key", from: "Gorosei <a@gorosei.gg>", fetch });
  expect(await mailer.send(message)).toEqual({ ok: true });
  expect(calls[0]!.url).toBe("https://api.resend.com/emails");
  expect(calls[0]!.init.method).toBe("POST");
  expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer re_key");
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
    from: "Gorosei <a@gorosei.gg>",
    to: ["p@test.local"],
    subject: "Hola",
    text: "texto",
    html: "<p>texto</p>",
  });
});

test("rate limits, server errors and network errors are retryable; a rejected message is not", async () => {
  const send = (respond: () => Response | Promise<Response>) =>
    createResendMailer({ apiKey: "k", from: "f@x", fetch: fakeFetch(respond).fetch }).send(message);
  expect(await send(() => new Response("", { status: 429 }))).toEqual({ ok: false, retryable: true });
  expect(await send(() => new Response("", { status: 500 }))).toEqual({ ok: false, retryable: true });
  expect(await send(() => Promise.reject(new TypeError("network")))).toEqual({ ok: false, retryable: true });
  expect(await send(() => new Response("", { status: 422 }))).toEqual({ ok: false, retryable: false });
});
