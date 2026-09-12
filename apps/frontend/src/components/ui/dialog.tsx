'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { restoreFocusTo } from '@/lib/restore-focus';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 duration-(--duration-overlay) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Standard dialog widths (SIZE-02), named after the underlying Tailwind
 * max-w-* step so the mapping is self-evident. Base classes only — a caller's
 * own `className="max-w-*"` still wins via tailwind-merge.
 */
const dialogContentSizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-6xl',
} as const

/**
 * Do NOT re-add the upstream `slide-in-from-left-1/2` / `slide-in-from-top-[48%]`
 * utilities here (ANIM-02). Under Tailwind v4 `translate-x-[-50%]` compiles to the
 * standalone `translate` property while tw-animate-css's `enter`/`exit` keyframes
 * drive `transform`, and the two compose instead of overriding — so those slide
 * utilities stacked a second -50%/-48% on top of the centering one and the panel
 * started a full box-width left and a box-height above centre, i.e. it flew in
 * from the top-left corner. Fade + `zoom-*` alone scale about the panel's centre.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    size?: keyof typeof dialogContentSizes
    /**
     * Classes for the scrolling body wrapper, which owns the padding and gap.
     * Pass layout overrides such as `p-0` here rather than in `className`.
     */
    bodyClassName?: string
  }
>(({ className, children, size = 'md', bodyClassName, onOpenAutoFocus, onCloseAutoFocus, onInteractOutside, ...props }, ref) => {
  /**
   * Return focus to whatever opened the dialog.
   *
   * Radix restores focus itself, but in this app it was landing on <body> for
   * every dialog — so a keyboard user who opened and dismissed one lost their
   * place and had to tab from the top of the page again (WCAG 2.4.3). Capturing
   * the opener in onOpenAutoFocus (which fires before focus moves inside) and
   * restoring it explicitly is reliable regardless of why the built-in restore
   * did not fire. Caller-supplied handlers still run, and still win if they
   * preventDefault.
   */
  const openerRef = React.useRef<HTMLElement | null>(null);

  /**
   * A press inside an overlay stacked ON TOP of this one is not a press outside
   * this one.
   *
   * Radix renders every confirm at the ConfirmProvider, outside the React tree
   * of whichever dialog opened it, so the press on that confirm's Cancel or
   * Delete button counts as "outside" for the dialog underneath. Radix defers
   * that verdict to the click (`deferPointerDownOutside`), and by the time the
   * click runs the confirm has closed and handed this layer its pointer events
   * back — so the guard that should have ignored the press no longer applies,
   * and the very click that dismissed the confirm dismissed the dialog behind
   * it too. Cancelling a delete closed the whole task, epic or requirement
   * dialog and dropped the reader's place.
   *
   * Escape never showed the bug because Radix routes it to the topmost layer
   * only. Clicking this dialog's own overlay still closes it: the overlay is a
   * plain div and matches neither role.
   */
  const guardNestedOverlays = (
    event: Parameters<
      NonNullable<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>['onInteractOutside']>
    >[0]
  ) => {
    onInteractOutside?.(event);
    if (event.defaultPrevented) return;
    const target = event.detail.originalEvent.target;
    if (target instanceof Element && target.closest('[role="dialog"],[role="alertdialog"]')) {
      event.preventDefault();
    }
  };

  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onOpenAutoFocus={(event) => {
        openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
        onOpenAutoFocus?.(event);
      }}
      onInteractOutside={guardNestedOverlays}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (event.defaultPrevented) return;
        // restoreFocusTo also covers the case the opener is gone — a dialog
        // that deleted the row its trigger lived in — where Radix would
        // otherwise leave focus on <body>.
        if (restoreFocusTo(openerRef.current)) event.preventDefault();
      }}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full grid-rows-[minmax(0,1fr)] translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg duration-(--duration-overlay) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg',
        dialogContentSizes[size],
        className
      )}
      {...props}
    >
      {/* The body scrolls, not the panel — the close button is positioned
          against the panel, so it stays put however far the body scrolls. */}
      <div className={cn('grid gap-4 overflow-y-auto p-6', bodyClassName)}>{children}</div>
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  dialogContentSizes,
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
