import type { Tier } from "./rank";

export type FeaturedCup = {
  edition: number;
  startsAt: Date;
  prizeArs: number;
  entryFeeArs: number;
  rankCap: Tier;
  teamCap: number;
  bracket: "double_elimination" | "single_elimination";
  streamUrl: string;
  status: "upcoming" | "registration_open";
};

// PLACEHOLDERS: edit every value below before launch. Plan 3 replaces this file with real tournament data.
export const featuredCup: FeaturedCup = {
  edition: 1,
  startsAt: new Date("2026-11-07T21:00:00Z"), // Saturday 7/11, 18:00 ART
  prizeArs: 300000,
  entryFeeArs: 5000,
  rankCap: "DIAMOND",
  teamCap: 16,
  bracket: "double_elimination",
  streamUrl: "https://www.twitch.tv/",
  status: "upcoming", // only "registration_open" once registration really opens in-platform
};
