export type RealtimeEvent = { channel: string; type: string; data?: unknown };
type Listener = (event: RealtimeEvent) => void;

/*
 * Channels:
 *   tournament:<id>  public: bracket and status changes
 *   match:<id>       public state of one match, never lobby or report details
 *   chat:<matchId>   the two teams and moderators
 *   console          moderators
 */
const state = globalThis as typeof globalThis & { __gorosei_hub?: Map<string, Set<Listener>> };
// One instance on globalThis so dev reloads share it.
const channels = (state.__gorosei_hub ??= new Map());

export function publish(event: RealtimeEvent): void {
  for (const listener of [...(channels.get(event.channel) ?? [])]) {
    try {
      listener(event);
    } catch (error) {
      console.error("[realtime] listener failed", error);
    }
  }
}

export function subscribe(channel: string, listener: Listener): () => void {
  let set = channels.get(channel);
  if (!set) channels.set(channel, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && channels.get(channel) === set) channels.delete(channel);
  };
}

/** Publishes after the surrounding transaction has committed; failures never reach the caller. */
export function publishAll(events: RealtimeEvent[]): void {
  for (const event of events) publish(event);
}
