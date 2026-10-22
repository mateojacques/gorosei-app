import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatLongDate } from "../shared/format";
import { type MessageKey, t } from "../shared/i18n";
import { PRIVACY_CONTACT_EMAIL as CONTACT_EMAIL, PRIVACY_LAST_UPDATED as LAST_UPDATED } from "../shared/privacy";
import { DEFAULT_OG_IMAGE, pageMeta } from "../shared/seo";
import { getSiteOrigin } from "../server/viewer.functions";

export const Route = createFileRoute("/privacidad")({
  loader: async () => ({ origin: await getSiteOrigin() }),
  head: ({ loaderData }) =>
    loaderData
      ? pageMeta({
          origin: loaderData.origin,
          path: "/privacidad",
          title: t("privacy.metaTitle"),
          description: t("privacy.metaDescription"),
          image: DEFAULT_OG_IMAGE,
        })
      : {},
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="px-4 py-12 sm:px-8 md:py-20">
      <article className="mx-auto max-w-[70ch]">
        <h1 className="font-display text-[clamp(2.5rem,12vw,4.5rem)] leading-[0.9] font-black uppercase">
          {t("privacy.title")}
        </h1>
        <p className="mt-4 text-sm text-ink-muted">{t("privacy.updated", { date: formatLongDate(LAST_UPDATED) })}</p>
        <p className="mt-8 text-lg">{t("privacy.intro")}</p>

        <Section title={t("privacy.collect.title")}>
          <List
            keys={[
              "privacy.collect.account",
              "privacy.collect.discord",
              "privacy.collect.riot",
              "privacy.collect.game",
              "privacy.collect.cookie",
            ]}
          />
        </Section>

        <Section title={t("privacy.why.title")}>
          <List keys={["privacy.why.accounts", "privacy.why.verify", "privacy.why.eligibility", "privacy.why.profiles"]} />
          <p className="mt-4 font-semibold">{t("privacy.why.noSale")}</p>
        </Section>

        <Section title={t("privacy.public.title")}>
          <p>{t("privacy.public.body")}</p>
        </Section>

        <Section title={t("privacy.thirdParties.title")}>
          <List
            keys={["privacy.thirdParties.riot", "privacy.thirdParties.discord", "privacy.thirdParties.hosting"]}
          />
        </Section>

        <Section title={t("privacy.retention.title")}>
          <p>{t("privacy.retention.body")}</p>
        </Section>

        <Section title={t("privacy.contact.title")}>
          <p>
            {t("privacy.contact.body")}{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-semibold break-all text-cobalt-light underline underline-offset-4 hover:text-ink"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 font-display text-3xl leading-none font-extrabold uppercase">{title}</h2>
      {children}
    </section>
  );
}

function List({ keys }: { keys: MessageKey[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-cobalt-light">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  );
}
