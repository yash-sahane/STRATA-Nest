import type { ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';

/**
 * Toast compatibility shim (fixes TOAST-01).
 *
 * The app historically used a Radix-based `useToast()` store whose `<Toaster>`
 * was never mounted in the tree, so every toast pushed through this module was
 * silently dropped. The only mounted toaster is sonner's (`app/layout.tsx`).
 *
 * This module now maps the legacy `toast({ title, description, variant })`
 * signature onto sonner, so all existing call sites (9 data hooks + several
 * components) surface feedback again with no per-call changes required.
 *
 * The historical variant set was only `'default' | 'destructive'`.
 * `'destructive'` maps to an error toast. `'warning'`/`'info'`/`'success'` are
 * accepted for code migrated to be explicit about intent.
 *
 * `'default'` (i.e. no variant) maps to a SUCCESS toast, which is a legacy
 * compatibility mapping, not the intent of the name: ~35 call sites across the
 * data hooks (`title: 'Success'`, `'Sprint created'`, `'Checked In'`, …) are
 * confirmations of a user-initiated mutation and omit the variant, so a neutral
 * default would silently strip the green confirmation off all of them.
 *
 * It is only WRONG at the informational sites, which must therefore pass a
 * variant explicitly — currently `components/notifications/notification-center.tsx`
 * ('New Notification', whose description is an inbound payload title that can
 * read 'Leave Request Rejected' on a green card) needs `variant: 'info'`. Once
 * every informational site is explicit AND the confirmation sites pass
 * `variant: 'success'`, flip the `'default'` arm below to `sonnerToast.message`.
 * Both halves have to land together — this file cannot do it alone.
 *
 * New code should import `toast` from `'sonner'` directly, or pass an explicit
 * variant here.
 */

type ToastVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

export interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastReturn {
  id: string | number;
  dismiss: () => void;
  update: (options: ToastOptions) => void;
}

/**
 * Route one toast to the sonner function that matches its variant. Passing an
 * existing `id` makes sonner replace that toast in place instead of stacking a
 * new one.
 */
function emit(options: ToastOptions, id?: string | number): string | number {
  const { title, description, variant = 'default', duration } = options;

  // If a title is present it becomes the toast's main line and the description
  // its sub-line; otherwise the description is promoted to the main line so we
  // never render an empty title above a lone description.
  const hasTitle = title !== undefined && title !== null && title !== '';
  const message: ReactNode = hasTitle ? title : (description ?? '');
  const sonnerOptions = {
    description: hasTitle ? description : undefined,
    duration,
    id,
  };

  switch (variant) {
    case 'destructive':
      return sonnerToast.error(message, sonnerOptions);
    case 'warning':
      return sonnerToast.warning(message, sonnerOptions);
    case 'info':
      return sonnerToast.info(message, sonnerOptions);
    case 'success':
    case 'default':
    default:
      return sonnerToast.success(message, sonnerOptions);
  }
}

function toast(options: ToastOptions = {}): ToastReturn {
  const id = emit(options);

  return {
    id,
    dismiss: () => sonnerToast.dismiss(id),
    // Re-emit under the same id so the update keeps the variant. The previous
    // implementation always called sonnerToast.message, which silently
    // downgraded an error toast to a neutral card on update.
    update: (next: ToastOptions) => {
      emit(next, id);
    },
  };
}

function useToast() {
  return {
    toast,
    dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId),
    // Legacy shape — nothing renders this anymore (sonner owns rendering).
    toasts: [] as ToastReturn[],
  };
}

export { useToast, toast };
