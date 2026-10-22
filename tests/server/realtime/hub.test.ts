import { expect, test } from "bun:test";
import { publish, subscribe } from "../../../src/server/realtime/hub";

test("a subscriber receives only its channel and stops after unsubscribing", () => {
  const seen: string[] = [];
  const off = subscribe("match:1", (e) => seen.push(`${e.channel}/${e.type}`));
  publish({ channel: "match:1", type: "a" });
  publish({ channel: "match:2", type: "b" });
  off();
  publish({ channel: "match:1", type: "c" });
  expect(seen).toEqual(["match:1/a"]);
});

test("a throwing listener does not stop the others", () => {
  const seen: string[] = [];
  const offs = [
    subscribe("t:1", () => {
      throw new Error("boom");
    }),
    subscribe("t:1", (e) => seen.push(e.type)),
  ];
  const original = console.error;
  console.error = () => {};
  try {
    publish({ channel: "t:1", type: "ping" });
  } finally {
    console.error = original;
    for (const off of offs) off();
  }
  expect(seen).toEqual(["ping"]);
});
