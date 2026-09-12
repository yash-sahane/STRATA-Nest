import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ConfirmProvider } from '@/components/providers/confirm-provider';
import { Toaster } from '@/components/ui/sonner';
import '../styles/globals.css';

const inter = Inter({ subsets: ['latin'] });

/**
 * Applies the persisted display preferences (compact mode, no animations)
 * before hydration so they take effect on every page load app-wide — not only
 * after visiting the Settings page, which owns the toggles. Same inline-script
 * technique next-themes uses for the theme class, so there is no flash of the
 * un-preferred state.
 */
const displayPreferencesScript = `try{var d=document.documentElement;if(localStorage.getItem('compact-mode')==='true')d.classList.add('compact-mode');if(localStorage.getItem('no-animations')==='true')d.classList.add('no-animations');}catch(e){}`;

export const metadata: Metadata = {
  title: 'STRATA — Enterprise Project Management',
  description: 'Role-based project management and attendance platform',
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/logo.svg',
    apple: '/logo.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <script dangerouslySetInnerHTML={{ __html: displayPreferencesScript }} />
        <ThemeProvider
          attribute="class"
          defaultTheme={process.env.NEXT_PUBLIC_DEFAULT_THEME || 'dark'}
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
              <Toaster position="top-right" richColors />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
