'use client';

import * as React from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Say so when the browser has no connection.
 *
 * Measured before this: with the connection pulled mid-save, the Save button read
 * "Saving..." and stayed that way, and nothing anywhere said why. The data was safe —
 * the request stays pending and completes when the connection returns, and nothing is
 * lost or falsely claimed — but a spinner that never explains itself is indistinguishable
 * from a hang, and if the connection does not come back it never resolves. The person is
 * left deciding whether to wait, press it again, or start over.
 *
 * FIXED, not sticky or inline, and deliberately so. This appears on a state change rather
 * than in response to anything the person did, so a banner that pushed the page down
 * would count in full against CLS — the exact fault just fixed on /team. Nothing moves.
 *
 * `navigator.onLine` reports whether the machine has a network interface, not whether the
 * internet is reachable, so it can be true on a connection that goes nowhere. That makes
 * it a decent NEGATIVE signal and a poor positive one: false means offline for certain,
 * which is the only claim made here. A captive-portal case still shows nothing, and still
 * behaves as it did before.
 */
export function OfflineNotice() {
  // `true` until proven otherwise: the first client render must match the server's HTML,
  // and reading `navigator` during render would differ between them.
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    /* Rendered always, hidden when online, so a screen reader's live region is already
       in the accessibility tree when the state changes — a region that appears at the
       same moment as its content is routinely not announced at all. */
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {!online && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-warning/40 bg-card px-4 py-2 text-sm shadow-lg">
          <WifiOff aria-hidden="true" className="h-4 w-4 text-warning-text" />
          <span>
            You&rsquo;re offline. Anything you save will go through once you&rsquo;re back.
          </span>
        </div>
      )}
    </div>
  );
}
