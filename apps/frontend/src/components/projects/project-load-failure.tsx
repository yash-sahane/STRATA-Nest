'use client';

import Link from 'next/link';
import { ArrowLeft, FolderSearch } from 'lucide-react';
import { ApiError } from '@/lib/api/rest-client';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { NoAccess } from '@/components/ui/no-access';

/** A project that is not there — deleted, a wrong link, or in a workspace the reader is not in. */
export function ProjectNotFound() {
  return (
    <EmptyState
      icon={FolderSearch}
      title="Project not found"
      description="It may have been deleted, or the link is wrong — or it belongs to a workspace you are not a member of."
      action={{ label: 'Back to Projects', href: '/projects' }}
    />
  );
}

/**
 * Why a project could not be shown, said so that it can be acted on.
 *
 * Every failure used to read as a connection problem with a "Try again" button,
 * a 404 included: the project had been deleted or the link was wrong, the
 * button asked for it again, it failed again, and so on for as long as anybody
 * kept pressing. A 404 or a 403 will not change on a retry (the query client
 * does not retry them either), so they say what happened and offer the way
 * back. Only a failure a retry can fix — the network, the server — offers one.
 */
export function ProjectLoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // `code` is the HTTP status (lib/api/rest-client.ts); a network failure is a
  // plain Error with none, and falls through to the retry.
  const code = error instanceof ApiError ? error.code : undefined;
  const back = (
    <Button variant="ghost" asChild>
      <Link href="/projects">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Projects
      </Link>
    </Button>
  );

  if (code === 404) return <ProjectNotFound />;

  if (code === 403) return <NoAccess what="open this project">{back}</NoAccess>;

  return (
    <div className="space-y-6">
      <div>{back}</div>
      <ErrorState
        title="Couldn't load this project"
        description="This is a connection or server problem, not a change to the project or to your access. Try again in a moment."
        onRetry={onRetry}
      />
    </div>
  );
}
