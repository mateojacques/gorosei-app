import type { EmailMessage, Mailer, SendResult } from "../../src/server/email/mailer";

/** Records every message; answers with the queued results, then ok. */
export class RecordingMailer implements Mailer {
  sent: EmailMessage[] = [];
  private results: SendResult[] = [];

  failWith(...results: SendResult[]): this {
    this.results.push(...results);
    return this;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    this.sent.push(message);
    return this.results.shift() ?? { ok: true };
  }
}
