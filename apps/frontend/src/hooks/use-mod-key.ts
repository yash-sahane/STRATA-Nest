'use client';

import * as React from 'react';

/**
 * The modifier this keyboard's shortcuts use, as it is printed on the key: "⌘"
 * on Apple devices, "Ctrl" everywhere else. "Ctrl" until mounted, so the server
 * render and the first client render agree.
 */
export function useModKey(): '⌘' | 'Ctrl' {
  const [key, setKey] = React.useState<'⌘' | 'Ctrl'>('Ctrl');
  React.useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)) setKey('⌘');
  }, []);
  return key;
}

/** The event that opens the command palette from anywhere on the page. */
export const OPEN_COMMAND_PALETTE = 'strata:open-command-palette';
