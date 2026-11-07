/**
 * Signing out, told to every other tab of this browser.
 *
 * The session lives in cookies every tab shares, so "Log out" in one tab ended it
 * in all of them — but only that tab knew. The rest went on showing the last
 * user's data from their query caches, and their realtime sockets went on
 * streaming until the access token ran out. Whoever sat down at the machine next
 * had all of it a click away.
 *
 * BroadcastChannel reaches every same-origin tab and never the one that posted.
 * Where it does not exist, tabs find out the old way: at their next request.
 */
const CHANNEL_NAME = 'strata-session';

interface SessionMessage {
  type: 'signed-out';
}

let channel: BroadcastChannel | null | undefined;

function sessionChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

/** Tell the other tabs this browser has signed out. */
export function announceSignedOut(): void {
  try {
    sessionChannel()?.postMessage({ type: 'signed-out' } satisfies SessionMessage);
  } catch {
    /* A channel that cannot post has nobody to tell. */
  }
}

/** Run `handler` when another tab signs out. Returns the unsubscribe. */
export function onSignedOutElsewhere(handler: () => void): () => void {
  const target = sessionChannel();
  if (!target) return () => undefined;
  const listener = (event: MessageEvent<SessionMessage>) => {
    if (event.data?.type === 'signed-out') handler();
  };
  target.addEventListener('message', listener);
  return () => target.removeEventListener('message', listener);
}
