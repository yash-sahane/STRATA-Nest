'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

/**
 * Root-level error boundary. It replaces the entire document when the root
 * layout itself throws, so it must render its own <html>/<body> and cannot
 * rely on app providers or global CSS being present — hence inline styles with
 * a light/dark-aware media query.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('Root layout error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: '#ffffff',
          color: '#0b0b12',
        }}
      >
        <style>{`@media (prefers-color-scheme: dark){body{background:#0b0b12 !important;color:#eaeaf5 !important;}}`}</style>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: '28rem', opacity: 0.7, margin: 0 }}>
          The application ran into an unexpected error. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            height: '2.25rem',
            padding: '0 1rem',
            borderRadius: '0.375rem',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            // White on #5a6fe0 measured 4.39:1, just under the 4.5:1 floor this
            // 14px/500 label earns. #5468de is the same hue and saturation two
            // points darker (hsl 231 68% 60%) and measures 4.76:1, so the button
            // looks as designed and the label is legible. The colour is written
            // out rather than taken from a token on purpose: this boundary
            // replaces the whole document when the root layout throws, so global
            // CSS and its custom properties may not be present at all.
            background: '#5468de',
            color: '#ffffff',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
