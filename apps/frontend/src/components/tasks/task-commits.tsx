'use client';

import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, GitCommit as GitCommitIcon } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useTaskCommits } from '@/hooks/use-integrations';

/** Only ever link out over http(s): the URL comes from a webhook payload. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The commits that mention this task.
 *
 * Renders nothing — not even a heading — when there are none: most projects
 * have no repository connected, and an empty "Commits" block on every task
 * would be noise about a feature they are not using.
 */
export function TaskCommits({ taskId, projectId }: { taskId: string; projectId?: string }) {
  const { data: commits = [] } = useTaskCommits(taskId, projectId);
  if (commits.length === 0) return null;

  return (
    <>
      {/* Its own rule, since the block only exists when there is something in it. */}
      <Separator />
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <GitCommitIcon className="h-4 w-4" />
          Commits ({commits.length})
        </h3>
        <ul className="space-y-2">
          {commits.map((commit) => {
            const href = safeHref(commit.url);
            // The subject line; the body of a long message belongs on the provider.
            const subject = commit.message.split('\n')[0];
            const sha = commit.commitSha.slice(0, 7);
            return (
              <li key={commit.id} className="rounded-md border p-3">
                <p className="break-words text-sm">{subject}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono underline-offset-2 hover:underline"
                    >
                      {sha}
                      <ExternalLink className="h-3 w-3" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="font-mono">{sha}</span>
                  )}
                  <span>{commit.author || commit.authorEmail}</span>
                  <span>
                    {formatDistanceToNow(new Date(commit.timestamp), { addSuffix: true })}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
