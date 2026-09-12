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
             * network blips and 5xx get one more attempt.
             *
             * `code` is ApiError's status field (lib/api/rest-client.ts); a
             * genuine network failure is a plain Error with no code, and falls
             * through to the retry.
             */
            retry: (failureCount, error) => {
              const code = (error as { code?: number })?.code;
              if (typeof code === 'number' && code >= 400 && code < 500) return false;
              return failureCount < 1;
            },
            retryDelay: 750,
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
