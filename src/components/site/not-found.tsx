import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/shared/i18n";

export function NotFound({ message }: { message: string }) {
  return (
    <main className="px-4 py-16 sm:px-8 md:py-24">
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-[clamp(3rem,15vw,5rem)] leading-[0.9] font-black uppercase">
          {t("notFound.title")}
        </h1>
        <p className="mt-4 text-lg">{message}</p>
        <Link to="/" className={buttonVariants({ variant: "secondary", className: "mt-8" })}>
          {t("notFound.backToCup")}
        </Link>
      </div>
    </main>
  );
}
