'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The keyboard-reachable action of a clickable row.
 *
 * Rows that open something are usually built as `<div onClick>` with
 * `cursor-pointer`: fine with a mouse, invisible to a keyboard, since a div is
 * neither focusable nor activated by Enter or Space. Measured across this app,
 * four such rows had no keyboard path to their own action at all — a task row on
 * the dashboard, the requirement and functional-requirement table rows, and the
 * sprint cards.
 *
 * The obvious repair — `role="button"` + `tabIndex={0}` on the row — is wrong
 * whenever the row also holds its own controls, and these rows nearly all hold a
 * delete or actions button. axe reports that shape as `nested-interactive`, and
 * it really did: the notification panel used it and produced 28 violations in one
 * popover.
 *
 * So the row's primary label becomes a real `<button>`, a SIBLING of whatever
 * other controls the row has rather than their ancestor. Screen readers get one
 * named action per row, Enter and Space work natively, and the row keeps its
 * `onClick` as a mouse convenience.
 *
 * `stopPropagation` matters: without it a click on the label fires both this
 * button and the row's own handler, which for a row that navigates means doing it
 * twice.
 */
export interface RowActivatorProps extends React.ComponentPropsWithoutRef<'button'> {
  /**
   * What activating the row does, for a screen reader — "Open task: Fix login",
   * "Select requirement: Payments". The visible children are usually a styled
   * fragment of text, which on its own rarely reads as an action.
   */
  label: string;
  onActivate: () => void;
}

export const RowActivator = React.forwardRef<HTMLButtonElement, RowActivatorProps>(
  function RowActivator({ label, onActivate, className, children, onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          // Inherit the row's typography: this is a label that happens to be
          // activatable, not a button that happens to contain text.
          'text-left rounded-sm outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className,
        )}
        onClick={(event) => {
          // The row around this usually carries the same handler for mouse users.
          event.stopPropagation();
          onClick?.(event);
          onActivate();
        }}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
