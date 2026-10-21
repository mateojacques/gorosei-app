import { expect, test } from "bun:test";
import { getLandingCta } from "../../src/shared/landing-cta";

test("signed-out visitors are asked to create an account", () => {
  expect(getLandingCta({ signedIn: false })).toEqual({ labelKey: "cup.cta.signUp", href: "/ingresar" });
});

test("signed-in visitors without Riot are asked to link it", () => {
  expect(getLandingCta({ signedIn: true, role: "player", riotAccount: null })).toEqual({
    labelKey: "cup.cta.linkRiot",
    href: "/vincular-riot",
  });
});

test("linked players are told they are ready and pointed at their profile", () => {
  expect(getLandingCta({ signedIn: true, role: "player", riotAccount: { gameName: "Señor Café", tagLine: "LAS" } })).toEqual({
    labelKey: "cup.cta.ready",
    href: "/jugador/Se%C3%B1or%20Caf%C3%A9-LAS",
  });
});
