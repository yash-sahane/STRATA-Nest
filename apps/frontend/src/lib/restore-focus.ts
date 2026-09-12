/**
 * Give focus back to whatever opened an overlay, and never to <body>.
 *
 * Capturing the opener covers the common case. It does NOT cover the two that
 * kept dropping keyboard users at the top of the document: a confirm opened
 * from a dropdown menu (the menu item is unmounted by the time the confirm
 * closes) and a confirm that deleted the very row its trigger lived in. Radix
 * falls back to <body> for both, so the next Tab restarted from the skip link.
 *
 * The order below matters, and the middle step is the subtle one. A confirm
 * opened from INSIDE a dialog (delete a comment from the task details dialog)
 * leaves that dialog open when it closes — and Radix's modal Content calls
 * `hideOthers()`, so `#main-content` is `aria-hidden` for as long as it is
 * open. Falling straight through to main would therefore park focus in a
 * subtree screen readers cannot see, which is worse than <body>. So: hand back
 * to the still-open overlay instead, and only reach for main when nothing is
 * open.
 *
 * Returns whether focus was placed, so the caller can preventDefault only when
 * it actually took over.
 */

/** Is this node inside something currently hidden from the accessibility tree? */
function isHidden(node: HTMLElement): boolean {
  return node.closest('[aria-hidden="true"]') !== null;
}

/** The overlay still on screen after this one closed, if any. */
function topmostOpenOverlay(): HTMLElement | null {
  const open = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );
  // Last in the DOM is the most recently portalled, i.e. the topmost layer.
  return open.length ? open[open.length - 1] : null;
}

export function restoreFocusTo(opener: HTMLElement | null): boolean {
  if (
    opener &&
    opener.isConnected &&
    typeof opener.focus === 'function' &&
    !isHidden(opener)
  ) {
    opener.focus();
    return true;
  }

  const overlay = topmostOpenOverlay();
  if (overlay) {
    // Prefer a real control inside it, so the next Tab continues from something
    // the user can act on rather than from the container.
    const target =
      overlay.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([aria-hidden="true"]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? overlay;
    if (!target.hasAttribute('tabindex') && target === overlay) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus();
    return true;
  }

  const main = document.getElementById('main-content') ?? document.querySelector('main');
  if (main instanceof HTMLElement && !isHidden(main)) {
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
    return true;
  }
  return false;
}
