import type { TournamentStatus } from "./tournament";

export type PlacementLabel = {
  key: "placement.champion" | "placement.second" | "placement.third" | "placement.nth" | "placement.inProgress" | "placement.none";
  n?: number;
};

export function placementLabel(rank: number | null, status: TournamentStatus): PlacementLabel {
  if (status !== "finished" && status !== "cancelled") return { key: "placement.inProgress" };
  if (rank === null || status === "cancelled") return { key: "placement.none" };
  if (rank === 1) return { key: "placement.champion" };
  if (rank === 2) return { key: "placement.second" };
  if (rank === 3) return { key: "placement.third" };
  return { key: "placement.nth", n: rank };
}
