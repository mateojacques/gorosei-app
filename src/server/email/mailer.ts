export type EmailMessage = { to: string; subject: string; text: string; html: string };
export type SendResult = { ok: true } | { ok: false; retryable: boolean };

export interface Mailer {
  send(message: EmailMessage): Promise<SendResult>;
}

const RESEND_URL = "https://api.resend.com/emails";

/** Sends through Resend's HTTP API. Rate limits, server errors and network failures are worth retrying. */
export function createResendMailer(opts: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(message) {
      let res: Response;
      try {
        res = await doFetch(RESEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: opts.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        });
      } catch {
        return { ok: false, retryable: true };
      }
      if (res.ok) return { ok: true };
      return { ok: false, retryable: res.status === 429 || res.status >= 500 };
    },
  };
}

/** Development mailer: logs who would get what, never the body. */
export function createLogMailer(): Mailer {
  return {
    async send(message) {
      console.info(`[email] to ${message.to}: ${message.subject}`);
      return { ok: true };
    },
  };
}
