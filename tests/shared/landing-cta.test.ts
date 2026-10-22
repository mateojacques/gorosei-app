import { expect, test } from "bun:test";
import { getLandingCta } from "../../src/shared/landing-cta";

const linked = { signedIn: true as const, userId: "u", role: "player" as const, riotAccount: { gameName: "Señor Café", tagLine: "LAS" }, unreadNotifications: 0 };
const open = { slug: "copa-semanal-las-1", status: "registration_open" as const };

test("signed-out visitors are asked to create an account", () => {
  expect(getLandingCta({ signedIn: false }, open)).toEqual({ labelKey: "cup.cta.signUp", href: "/ingresar" });
});

test("signed-in visitors without Riot are asked to link it", () => {
  expect(getLandingCta({ signedIn: true, userId: "u", role: "player", riotAccount: null, unreadNotifications: 0 }, open)).toEqual({
    labelKey: "cup.cta.linkRiot",
    href: "/vincular-riot",
  });
});

test("linked players are sent to register while registration is open", () => {
  expect(getLandingCta(linked, open)).toEqual({ labelKey: "cup.cta.register", href: "/torneos/copa-semanal-las-1/inscribir" });
});

test("linked players are sent to the tournament once registration is past", () => {
  expect(getLandingCta(linked, { slug: "copa-semanal-las-1", status: "live" })).toEqual({
    labelKey: "cup.cta.viewTournament",
    href: "/torneos/copa-semanal-las-1",
  });
});

test("linked players with no tournament on are told they are ready and pointed at their profile", () => {
  expect(getLandingCta(linked, null)).toEqual({ labelKey: "cup.cta.ready", href: "/jugador/Se%C3%B1or%20Caf%C3%A9-LAS" });
});
