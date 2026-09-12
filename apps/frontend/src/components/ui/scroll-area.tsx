"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    {/* `max-h-[inherit]` picks up a caller's `max-h-*` on the Root. Without it the
        viewport (height: 100% of an auto-height Root) grows past the cap, never
        overflows — so no scrollbar appears — and the Root's `overflow-hidden`
        silently clips the rest. */}
    {/* tabIndex 0: a region that scrolls must be reachable by keyboard, or its
        overflowing content is unreachable without a mouse (WCAG 2.1.1). */}
    {/* `[&>div]:!block`: Radix puts a `display:table; min-width:100%` wrapper in
        here. `display:table` shrink-wraps to content and `min-width` is only a
        floor, so the wrapper grows to the content's max-content width while the
        Root's `overflow-hidden` clips it — on /activity that left 174px of every
        entry, the timestamp and the type badge, outside the clip with nothing to
        scroll. No ScrollArea in this app renders a horizontal scrollbar, so that
        overflow was never reachable: as a block the wrapper fills the viewport
        instead, and the `truncate`/`min-w-0` inside these lists take effect.
        A caller that genuinely wants horizontal scrolling needs a horizontal
        <ScrollBar /> and should override this. */}
    <ScrollAreaPrimitive.Viewport
      tabIndex={0}
      className="h-full max-h-[inherit] w-full rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&>div]:!block"
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
