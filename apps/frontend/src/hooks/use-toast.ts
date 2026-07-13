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
 * The historical variant set was only `'default' | 'destructive'`. In this
 * codebase the `'default'` variant is used exclusively for positive
 * confirmations (`title: 'Success'`, `'Sprint created'`, …), so it maps to a
 * success toast. `'destructive'` maps to an error toast. `'warning'`/`'info'`
 * are also accepted for code migrated to be explicit about intent.
 *
 * New code should import `toast` from `'sonner'` directly.
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

function toast(options: ToastOptions = {}): ToastReturn {
  const { title, description, variant = 'default', duration } = options;

  // If a title is present it becomes the toast's main line and the description
  // its sub-line; otherwise the description is promoted to the main line so we
  // never render an empty title above a lone description.
  const hasTitle = title !== undefined && title !== null && title !== '';
  const message: ReactNode = hasTitle ? title : (description ?? '');
  const sonnerOptions = {
    description: hasTitle ? description : undefined,
    duration,
  };

  let id: string | number;
  switch (variant) {
    case 'destructive':
      id = sonnerToast.error(message, sonnerOptions);
      break;
    case 'warning':
      id = sonnerToast.warning(message, sonnerOptions);
      break;
    case 'info':
      id = sonnerToast.info(message, sonnerOptions);
      break;
    case 'success':
    case 'default':
    default:
      id = sonnerToast.success(message, sonnerOptions);
      break;
  }

  return {
    id,
    dismiss: () => sonnerToast.dismiss(id),
    update: (next: ToastOptions) => {
      const nextHasTitle =
        next.title !== undefined && next.title !== null && next.title !== '';
      sonnerToast.message(nextHasTitle ? next.title : (next.description ?? ''), {
        id,
        description: nextHasTitle ? next.description : undefined,
      });
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
