"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { restoreFocusTo } from "@/lib/restore-focus"
import { buttonVariants } from "@/components/ui/button"
import { dialogContentSizes } from "@/components/ui/dialog"

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-60 bg-black/50 duration-(--duration-overlay) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

/**
 * Shares DialogContent's size scale (SIZE-02) and its centre-anchored entrance —
 * see the note on DialogContent for why no `slide-*` utilities belong here.
 *
 * Stacking bands, all in the root stacking context (everything here portals to
 * document.body, so z-order decides, not DOM order):
 *   z-50  surfaces — Dialog, Sheet and their overlays
 *   z-60  the alert layer — confirms are routinely opened from INSIDE an open
 *         Dialog and must paint over it rather than rely on portal order
 *   z-70  portaled poppers — Select / Popover / DropdownMenu / Tooltip content
 *
 * The popper band exists because raising only this layer buried them: the
 * opaque panel below covered the `<SelectContent>` of the Clone-FR flow's
 * project picker, whose trigger lives inside this very panel. A popper must
 * always sit above the surface hosting its trigger, so any future bump here
 * must move the popper band with it.
 */
const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    size?: keyof typeof dialogContentSizes
  }
>(({ className, children, size = "md", onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  /**
   * Return focus to whatever opened the alert, exactly as DialogContent does.
   *
   * Without it every confirm in the app — Delete sprint, Delete task, Delete
   * project, Delete workspace — dropped focus on <body> when it closed, so a
   * keyboard user lost their place and had to tab from the top of the page
   * again (WCAG 2.4.3). A plain Dialog on the same page did not, which made the
   * inconsistency itself confusing.
   */
  const openerRef = React.useRef<HTMLElement | null>(null);

  return (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      onOpenAutoFocus={(event) => {
        openerRef.current = (document.activeElement as HTMLElement | null) ?? null
        onOpenAutoFocus?.(event)
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)
        if (event.defaultPrevented) return
        // Most confirms in this app are opened from a row's ⋮ menu, and that
        // menu is unmounted by the time the confirm closes — so the captured
        // opener is gone and Radix falls back to <body>. restoreFocusTo parks
        // focus on the main region instead.
        if (restoreFocusTo(openerRef.current)) event.preventDefault()
      }}
      className={cn(
        "fixed left-[50%] top-[50%] z-60 grid max-h-[calc(100dvh-2rem)] w-full grid-rows-[minmax(0,1fr)] translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg duration-(--duration-overlay) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
        dialogContentSizes[size],
        className
      )}
      {...props}
    >
      <div className="grid gap-4 overflow-y-auto p-6">{children}</div>
    </AlertDialogPrimitive.Content>
  </AlertDialogPortal>
  )
})
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> &
    VariantProps<typeof buttonVariants>
>(({ className, variant, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants({ variant }), className)}
    {...props}
  />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: "outline" }),
      "mt-2 sm:mt-0",
      className
    )}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
