'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * One client per browser, created lazily.
 *
 * This used to be `useState(() => new QueryClient())`. That initialiser runs on
 * every render ATTEMPT, so a render React discards still built a client — and
 * any query that started fetching during that pass ran against it. The result
 * was every header query firing twice on a full page load (measured: two
 * identical unread-notification requests 11ms apart, both before the header had
 * even committed), because the two observers lived on two different clients and
 * so could never dedupe. A module-scope singleton cannot be duplicated that way.
 *
 * On the server a fresh client is returned each time, so requests never share
 * cache between users.
 */
let browserQueryClient: QueryClient | undefined;

function makeQueryClient(): QueryClient {
  return new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            /**
             * React Query's default is three retries with exponential backoff,
             * applied to every failure. That meant a 403 or a 404 was retried
             * three times before the UI could react, and any error state took
             * roughly eight seconds to appear — long enough to read as a hang.
             *
             * A 4xx will not change on a retry, so those surface immediately;
             * network blips and 5xx get one more attempt. The two exceptions are
             * spelled out below.
             *
             * `code` is ApiError's status field (lib/api/rest-client.ts); a
             * genuine network failure is a plain Error with no code, and falls
             * through to the retry.
             */
            retry: (failureCount, error) => {
              const code = (error as { code?: number })?.code;
              // 429 and 408 are the two 4xx that say "not now" rather than "no". A 429 is
              // the only status whose whole meaning is that the same request will succeed
              // later, and it ships a Retry-After saying when — so the blanket 4xx rule
              // was exactly wrong for it.
              //
              // The cost of getting this wrong is silent, which is why it survived:
              // a rate-limited BACKGROUND refetch — the kind a realtime event triggers —
              // failed permanently, and because the previous data is still cached the list
              // simply stayed stale with nothing shown. Measured on /team, where a member
              // added by somebody else never appeared although the websocket frame had
              // arrived and the page was otherwise healthy.
              if (code === 429 || code === 408) return failureCount < 3;
              if (typeof code === 'number' && code >= 400 && code < 500) return false;
              return failureCount < 1;
            },
            /**
             * Honour Retry-After when the server sent one; otherwise back off, because
             * retrying a rate limit on a fixed short delay is how a busy moment becomes a
             * stampede. Capped so nothing waits longer than somebody would.
             */
            retryDelay: (failureCount, error) => {
              const after = (error as { retryAfterMs?: number })?.retryAfterMs;
              if (typeof after === 'number') return Math.min(after, 30_000);
              const code = (error as { code?: number })?.code;
              if (code === 429 || code === 408) {
                return Math.min(1000 * 2 ** failureCount, 30_000);
              }
              return 750;
            },
          },
    },
  });
}

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
