import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;

/**
 * The trigger, made to take focus when it is pressed.
 *
 * Safari does not focus a button pressed with the mouse: its mousedown moves
 * focus to the nearest focusable ancestor — inside a dialog, the dialog itself.
 * A popover opened from a dialog then had focus outside it, the dialog's focus
 * trap pulled focus back, and the popover closed as it appeared: every date
 * picker and the assignee picker in a dialog did nothing when clicked, on
 * Safari and on an iPhone. Chrome and Firefox focus the button themselves; this
 * does the same, and stops Safari moving focus elsewhere. The click still fires.
 */
const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ onMouseDown, ...props }, ref) => (
  <PopoverPrimitive.Trigger
    ref={ref}
    onMouseDown={(event) => {
      onMouseDown?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.currentTarget.focus();
    }}
    {...props}
  />
));
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-70 w-72 max-h-(--radix-popover-content-available-height) overflow-y-auto origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none duration-(--duration-standard) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
