import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrowseSection } from "../components/tournament/browse-list";
import { Button } from "../components/ui/button";
import { getBrowsePage } from "../server/tournaments/tournaments.functions";
import { RANK_BRACKETS, browseSearchSchema } from "../shared/browse";
import type { BrowseSearch } from "../shared/browse";
import { type MessageKey, t } from "../shared/i18n";
import { DEFAULT_OG_IMAGE, pageMeta } from "../shared/seo";

export const Route = createFileRoute("/torneos/")({
  validateSearch: browseSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getBrowsePage({ data: deps }),
  head: ({ loaderData }) =>
    loaderData
      ? pageMeta({
          origin: loaderData.origin,
          path: "/torneos",
          title: t("browse.metaTitle"),
          description: t("browse.metaDescription"),
          image: DEFAULT_OG_IMAGE,
        })
      : {},
  component: BrowsePage,
});

function BrowsePage() {
  const page = Route.useLoaderData();
  const filtered = Object.keys(page.filters).length > 0;
  const empty = page.upcoming.length + page.live.length + page.finished.length === 0;
  return (
    <main>
      <section aria-labelledby="browse-title" className="stage relative isolate overflow-hidden px-4 pt-10 pb-10 sm:px-8 md:pt-16 md:pb-14">
        <div className="mx-auto max-w-6xl">
          <h1 id="browse-title" className="font-display text-[clamp(3rem,15vw,5.5rem)] leading-[0.85] font-black tracking-[-0.01em] uppercase">
            {t("browse.title")}
          </h1>
          <p className="mt-4 max-w-prose text-lg text-ink">{t("browse.lede")}</p>
          <Filters filters={page.filters} />
        </div>
      </section>

      <div className="px-4 py-10 sm:px-8 md:py-14">
        <div className="mx-auto flex max-w-6xl flex-col gap-14">
          {!page.hasAny ? (
            <div className="max-w-prose">
              <h2 className="font-display text-3xl font-black uppercase">{t("cup.none.title")}</h2>
              <p className="mt-3 text-lg">{t("cup.none.body")}</p>
            </div>
          ) : empty ? (
            <div className="max-w-prose">
              <p className="text-lg">{t("browse.empty")}</p>
              {filtered && <ClearLink className="mt-3 inline-block" />}
            </div>
          ) : (
            <>
              <BrowseSection section="upcoming" tournaments={page.upcoming} />
              <BrowseSection section="live" tournaments={page.live} />
              <BrowseSection section="finished" tournaments={page.finished} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function ClearLink({ className }: { className?: string }) {
  return (
    <a href="/torneos" className={`font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink ${className ?? ""}`}>
      {t("browse.filter.clear")}
    </a>
  );
}

// A plain GET form: it filters with or without JavaScript, and the URL is shareable.
function Filters({ filters }: { filters: BrowseSearch }) {
  const filtered = Object.keys(filters).length > 0;
  return (
    <form method="get" action="/torneos" aria-label={t("browse.filters")} className="mt-8 flex flex-wrap items-end gap-x-4 gap-y-4">
      <Select name="when" label={t("browse.filter.when")} value={filters.when}>
        <option value="">{t("browse.filter.whenAny")}</option>
        <option value="today">{t("browse.filter.today")}</option>
        <option value="week">{t("browse.filter.week")}</option>
        <option value="weekend">{t("browse.filter.weekend")}</option>
      </Select>
      <Select name="format" label={t("browse.filter.format")} value={filters.format}>
        <option value="">{t("browse.filter.formatAny")}</option>
        <option value="double_elimination">{t("cup.bracket.double_elimination")}</option>
        <option value="single_elimination">{t("cup.bracket.single_elimination")}</option>
      </Select>
      <Select name="rank" label={t("browse.filter.rank")} value={filters.rank}>
        <option value="">{t("browse.filter.rankAny")}</option>
        {RANK_BRACKETS.map((rank) => (
          <option key={rank} value={rank}>
            {rank === "open" ? t("browse.filter.rankOpen") : t(`rank.tier.${rank}` as MessageKey)}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-5">
        <Button type="submit" variant="secondary">
          {t("browse.filter.apply")}
        </Button>
        {filtered && <ClearLink />}
      </div>
    </form>
  );
}

function Select({ name, label, value, children }: { name: string; label: string; value: string | undefined; children: ReactNode }) {
  const id = `browse-${name}`;
  return (
    <div className="flex min-w-[9.5rem] flex-1 flex-col gap-1.5 sm:flex-none">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value ?? ""}
        className="h-11 w-full rounded-[4px] border border-line bg-surface-raised px-3 text-base text-ink hover:border-ink-muted focus-visible:border-cobalt-light"
      >
        {children}
      </select>
    </div>
  );
}
