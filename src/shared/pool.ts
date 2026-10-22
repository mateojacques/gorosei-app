import { z } from "zod";

export const ROLES = ["top", "jungle", "mid", "bot", "support"] as const;
export type Role = (typeof ROLES)[number];

export const poolEntryInputSchema = z.object({
  // Listed in preference order.
  roles: z
    .array(z.enum(ROLES))
    .min(1)
    .max(ROLES.length)
    .refine((roles) => new Set(roles).size === roles.length, { message: "duplicate role" }),
  autoPlace: z.boolean().default(true),
});
