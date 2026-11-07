import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources, query } from '@/lib/api/client';
import type { TaskComment } from '@/types';
import { toast } from 'sonner';

/**
 * Task comments.
 *
 * The `/task_comments` resource has existed and worked since the API was built
 * — create, list, patch and delete — but nothing on the client ever called it,
 * so a task had no discussion at all. These hooks are that missing half.
 *
 * Comments are keyed by task rather than by workspace: the API scopes them
 * through the task's project, and every screen that shows them is already
 * looking at one task.
 */

export const taskCommentKey = (taskId?: string) => ['task-comments', taskId] as const;

export function useTaskComments(taskId?: string) {
  return useQuery({
    queryKey: taskCommentKey(taskId),
    queryFn: async () => {
      if (!taskId) return [];
      const response = await resources.listAll('task_comments', [
        query.equal('taskId', taskId),
        query.orderAsc('createdAt'),
      ]);
      return response.items as unknown as TaskComment[];
    },
    enabled: !!taskId,
  });
}

export function useCreateTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, content }: { taskId: string; content: string }) => {
      const response = await resources.create('task_comments', {
        taskId,
        content,
        mentions: [],
      });
      return response as unknown as TaskComment;
    },
    onSuccess: (comment) => {
      queryClient.invalidateQueries({ queryKey: taskCommentKey(comment.taskId) });
    },
    onError: (error: unknown) => {
      toast.error('Comment not posted', { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}

export function useUpdateTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      commentId,
      content,
    }: {
      commentId: string;
      taskId: string;
      content: string;
    }) => {
      const response = await resources.update('task_comments', commentId, { content });
      return response as unknown as TaskComment;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: taskCommentKey(variables.taskId) });
    },
    onError: (error: unknown) => {
      toast.error('Comment not updated', { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}

export function useDeleteTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ commentId }: { commentId: string; taskId: string }) => {
      await resources.remove('task_comments', commentId);
      return { commentId };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: taskCommentKey(variables.taskId) });
    },
    onError: (error: unknown) => {
      toast.error('Comment not deleted', { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}
