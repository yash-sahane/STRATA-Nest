'use client';

import * as React from 'react';
import { useModKey } from '@/hooks/use-mod-key';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/providers/auth-provider';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useWorkspaceMembers } from '@/hooks/use-workspace';
import { useTaskCommentsRealtime } from '@/hooks/use-realtime';
import { useHasPermissionIn } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import {
  useTaskComments,
  useCreateTaskComment,
  useUpdateTaskComment,
  useDeleteTaskComment,
} from '@/hooks/use-task-comment';
import { getInitials } from '@/lib/utils';
import type { TaskComment } from '@/types';

interface TaskCommentsProps {
  taskId: string;
  workspaceId?: string;
  /**
   * The thread can be read but not added to, edited or taken down: the task's
   * project is archived, and the server refuses all three.
   */
  readOnly?: boolean;
}

/**
 * The discussion thread on a task.
 *
 * Posting is deliberately NOT gated on `task:write`: the API allows any member
 * of the workspace to comment (it is the one write the read-only roles have),
 * and a project tool where the delivery team cannot reply on their own tasks
 * would be the same gap this component exists to close. Editing is the
 * author's alone; deleting is the author's, or whoever may delete tasks.
 */
export function TaskComments({ taskId, workspaceId, readOnly = false }: TaskCommentsProps) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { data: comments, isLoading } = useTaskComments(taskId);
  // A reply posted by someone else lands in an open task without a refresh.
  useTaskCommentsRealtime(taskId);
  const { data: members } = useWorkspaceMembers(workspaceId);
  // Whoever may delete tasks may take down somebody else's comment (not edit it).
  const canModerate = useHasPermissionIn(workspaceId, Permission.DELETE_TASK).allowed;

  const createComment = useCreateTaskComment();
  const modKey = useModKey();
  const updateComment = useUpdateTaskComment();
  const deleteComment = useDeleteTaskComment();

  const [draft, setDraft] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editDraft, setEditDraft] = React.useState('');
  // Focus anchors: the thread as a whole, and the one control in it that never
  // unmounts — see restoreThreadFocus below.
  const threadRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  /**
   * The edit box, so opening it actually puts the cursor in it.
   *
   * Pressing Edit unmounts the button that was focused and mounts this field, which
   * left focus on nothing at all — a keyboard user was dropped back to the top of the
   * document and had to hunt for the editor they had just opened. The caret goes to
   * the END of the existing text, since the box is pre-filled and typing at the start
   * would prepend.
   */
  const editRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (!editingId) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingId]);

  // userId -> display name/avatar. The comment record carries only the id.
  const authorOf = React.useCallback(
    (userId: string) => {
      const member = (members ?? []).find((m) => m.userId === userId);
      if (member) return { name: member.name, avatar: member.avatar };
      if (user?.id === userId) return { name: user.name || 'You', avatar: '' };
      return { name: 'Unknown member', avatar: '' };
    },
    [members, user]
  );

  const post = async () => {
    const content = draft.trim();
    if (!content) return;
    try {
      await createComment.mutateAsync({ taskId, content });
    } catch {
      // Only clear on success — a rejected post must not silently eat the text.
      // Reading `createComment.isError` here could never do that: it is the
      // render-time snapshot, still false at the moment the rejection lands, so
      // every failed post cleared the box anyway. The hook has already toasted.
      return;
    }
    setDraft('');
  };

  const saveEdit = async (comment: TaskComment) => {
    const content = editDraft.trim();
    if (!content || content === comment.content) {
      setEditingId(null);
      return;
    }
    try {
      await updateComment.mutateAsync({ commentId: comment.id, taskId, content });
    } catch {
      // Same reason as post(): closing the editor on a rejected save would throw
      // away the rewrite the user just made.
      return;
    }
    setEditingId(null);
  };

  /**
   * Put focus back in the thread after a delete.
   *
   * The confirm returns focus to whatever opened it, but on a fast delete this
   * comment's own Delete button is unmounted before the confirm finishes its
   * exit animation — so the confirm's fallback parks focus on <main>, which is
   * outside the still-open (and `aria-hidden`-ing) task dialog. Wait for the
   * confirm to leave the DOM before deciding, or its late restore wins.
   */
  const restoreThreadFocus = (doomedRow?: HTMLElement | null) => {
    let frames = 0;
    const settle = () => {
      if (document.querySelector('[role="alertdialog"]') && frames++ < 30) {
        requestAnimationFrame(settle);
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      // "Focus is inside the thread" was the wrong test. On the normal path —
      // and always under prefers-reduced-motion, where the confirm unmounts at
      // click time — the confirm restores focus to the Delete button of the very
      // comment being removed, which IS inside the thread, so this bailed out.
      // The invalidation refetch then unmounted that row and focus fell to
      // <body>. Treat focus that is on the doomed row, detached, or on <body> as
      // focus lost.
      const lost =
        !active ||
        active === document.body ||
        !active.isConnected ||
        (doomedRow ? doomedRow.contains(active) : false) ||
        !threadRef.current?.contains(active);
      if (lost) composerRef.current?.focus();
    };
    requestAnimationFrame(settle);
  };

  const remove = async (comment: TaskComment) => {
    const theirs = comment.userId !== user?.id;
    const ok = await confirm({
      title: theirs ? `Remove ${authorOf(comment.userId).name}'s comment?` : 'Delete this comment?',
      description: theirs
        ? 'This removes it for everyone and cannot be undone. They are told you removed it.'
        : 'This removes it for everyone and cannot be undone.',
      confirmText: theirs ? 'Remove' : 'Delete',
      destructive: true,
    });
    // Captured BEFORE the await: once the refetch lands this element is gone,
    // and it is the one place focus must not be left sitting.
    const doomedRow = threadRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${comment.id}"]`,
    );
    if (!ok) {
      // A cancelled delete still needs somewhere to land: the confirm hands
      // focus back to a Delete button that is about to stay put, but if the
      // list re-rendered underneath it there is nothing there.
      restoreThreadFocus(doomedRow);
      return;
    }
    try {
      await deleteComment.mutateAsync({ commentId: comment.id, taskId });
    } catch {
      // The hook toasts; the comment is still on screen to try again on.
      restoreThreadFocus(doomedRow);
      return;
    }
    restoreThreadFocus(doomedRow);
  };

  const list = comments ?? [];

  return (
    <div ref={threadRef} className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <MessageSquare className="h-4 w-4" />
        Comments
        {list.length > 0 && <span className="text-muted-foreground">({list.length})</span>}
      </h3>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {readOnly ? 'No comments.' : 'No comments yet. Start the discussion below.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((comment) => {
            const author = authorOf(comment.userId);
            const mine = comment.userId === user?.id;
            const edited = comment.updatedAt !== comment.createdAt;
            return (
              <li key={comment.id} data-comment-id={comment.id} className="flex gap-2">
                <Avatar className="mt-0.5 h-7 w-7 shrink-0">
                  <AvatarImage src={author.avatar} alt="" />
                  <AvatarFallback className="text-xs">{getInitials(author.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">{author.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                      {edited && ' · edited'}
                    </span>
                  </div>

                  {editingId === comment.id ? (
                    <div className="mt-1 space-y-2">
                      <Textarea
                        ref={editRef}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={3}
                        aria-label="Edit comment"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => saveEdit(comment)}
                          disabled={updateComment.isPending}
                        >
                          {updateComment.isPending ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm">{comment.content}</p>
                  )}

                  {(mine || canModerate) && editingId !== comment.id && !readOnly && (
                    <div className="mt-1 flex gap-1">
                      {mine && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setEditingId(comment.id);
                            setEditDraft(comment.content);
                          }}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive-text"
                        onClick={() => remove(comment)}
                        disabled={deleteComment.isPending}
                        aria-label={mine ? 'Delete your comment' : `Remove ${author.name}'s comment`}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        {mine ? 'Delete' : 'Remove'}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          Comments are closed: this task&apos;s project is archived.
        </p>
      ) : (
      <div className="space-y-2">
        <Textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a comment…"
          rows={3}
          aria-label="Write a comment"
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter submits, matching the rest of the app's forms.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void post();
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{modKey} + Enter to post</span>
          <Button size="sm" onClick={post} disabled={!draft.trim() || createComment.isPending}>
            {createComment.isPending ? 'Posting…' : 'Comment'}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}
