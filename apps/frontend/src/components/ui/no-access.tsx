'use client';

import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The one way this app says "that is not yours to do here".
 *
 * It was said four ways. A red-bordered card with a shield; a plain card with
 * an alert inside it; a centred warning triangle with a button; and each with
 * its own explanation of who could — "workspace managers", "managers and
 * administrators", "administrators" — none of which is true of a workspace that
 * defines its own roles. Somebody refused on one screen could not recognise the
 * same refusal on the next, and was sent to look for a person the wording had
 * invented.
 *
 * This says what cannot be done, in the reader's own terms, and who can change
 * that: whoever manages the workspace. Not an error — nothing went wrong — so
 * it is not styled as one.
 */
export function NoAccess({
  what,
  explanation,
  children,
  className,
}: {
  /** What the reader cannot do, as the rest of a sentence: "add people to this workspace". */
  what: string;
  /** Replaces the default "your role in this workspace" sentence, for refusals that are not about a role. */
  explanation?: string;
  /** Anything to offer instead — a way back, usually. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('mx-auto w-full max-w-xl', className)} role="status">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">You don&apos;t have access to this</CardTitle>
        </div>
        <CardDescription>
          {explanation ?? (
            <>
              Your role in this workspace doesn&apos;t let you {what}. Somebody who manages the
              workspace can change your role, or do it for you.
            </>
          )}
        </CardDescription>
      </CardHeader>
      {children ? <CardContent className="flex flex-wrap gap-2">{children}</CardContent> : null}
    </Card>
  );
}
