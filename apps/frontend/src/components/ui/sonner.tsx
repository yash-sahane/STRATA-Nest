'use client';

import { useTheme } from 'next-themes';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

/**
 * sonner's `Toaster` defaults to `theme: 'light'`, and its only dark detection is
 * `prefers-color-scheme` — it never reads the `dark` class next-themes puts on
 * <html>. The app defaults to the dark theme, so without this wrapper every toast
 * renders as a white card over a dark UI.
 */
export function Toaster(props: ToasterProps) {
  // `resolvedTheme` rather than `theme`, which is the literal 'system' in system
  // mode. It is undefined until mount; fall back to 'system' so the first paint
  // follows the OS instead of flashing light.
  const { resolvedTheme } = useTheme();
  const theme: ToasterProps['theme'] =
    resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : 'system';

  return <SonnerToaster theme={theme} {...props} />;
}
