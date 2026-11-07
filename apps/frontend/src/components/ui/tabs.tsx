import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // max-w-full + overflow-x-auto: a strip with more tabs than fit (Settings
      // has six) otherwise overflowed its container with overflow-x visible,
      // so the trailing tabs were painted outside the viewport with nothing
      // able to scroll to them — unreachable on a narrow phone.
      //
      // `justify-center-safe`, not `justify-center`. Centring content that overflows
      // splits the overflow across BOTH ends, and `scrollLeft` cannot go below zero — so
      // whatever hangs off the left is unreachable no matter how you scroll. That is the
      // same defect the line above fixed, reintroduced at the other end: measured on
      // /settings at 768px, the first tab was cut by 51px with scrollLeft already 0 and
      // 55px of scroll available in the wrong direction. Safe alignment centres while
      // there is room and falls back to flex-start the moment there is not.
      // overflow-y-hidden: `overflow-x: auto` turns overflow-y to auto as well, so a
      // trigger 2px taller than the strip's 32px inner height — "Approvals" with its
      // count badge on /time-tracking is 34px — grew a vertical scrollbar with ▲▼
      // arrows beside the tabs. The strip only ever scrolls sideways.
      'inline-flex h-10 max-w-full items-center justify-center-safe overflow-x-auto overflow-y-hidden rounded-md bg-muted p-1 text-muted-foreground',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
