import type { RiotResult } from "./types";

const BASE_BACKOFF_MS = 250;

export type RiotHttpOptions = {
  fetch?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * One Riot API call with retries: 429 honors Retry-After, 5xx and network errors back off exponentially,
 * 404 is not_found, other 4xx are not retried.
 */
export async function riotRequest<T>(
  opts: RiotHttpOptions,
  method: "GET" | "POST",
  url: string,
  init: { headers: Record<string, string>; body?: unknown },
): Promise<RiotResult<T>> {
  const doFetch = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const headers = init.body === undefined ? init.headers : { ...init.headers, "Content-Type": "application/json" };
  let failure: "rate_limited" | "unavailable" = "unavailable";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    } catch {
      failure = "unavailable";
      if (attempt < maxRetries) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      continue;
    }
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    if (res.status === 404) return { ok: false, error: "not_found" };
    if (res.status === 429) {
      failure = "rate_limited";
      const retryAfterSeconds = Number(res.headers.get("Retry-After") ?? 1);
      if (attempt < maxRetries) await sleep(retryAfterSeconds * 1000);
      continue;
    }
    if (res.status >= 500) {
      failure = "unavailable";
      if (attempt < maxRetries) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      continue;
    }
    // Other 4xx (bad key, forbidden) are not retryable.
    return { ok: false, error: "unavailable" };
  }
  return { ok: false, error: failure };
}
