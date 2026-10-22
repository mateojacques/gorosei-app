import type { Db } from "../db/client";
import { publish } from "../realtime/hub";
import { NOTIFICATION_CHANNEL } from "./notify";

/**
 * Turns committed notifications into `user:<id>` realtime events. The event carries nothing private:
 * it only says something changed, and the client refetches. Returns a function that stops listening.
 */
export async function listenForNotifications(
  client: Db["$client"],
  push: typeof publish = publish,
): Promise<() => Promise<void>> {
  const subscription = await client.listen(NOTIFICATION_CHANNEL, (userId) => {
    if (userId) push({ channel: `user:${userId}`, type: "notification" });
  });
  return () => subscription.unlisten();
}
