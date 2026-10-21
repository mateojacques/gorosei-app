import { env } from "../env";
import { createRiotClient } from "./client";

export const riot = createRiotClient({ apiKey: env.RIOT_API_KEY });
