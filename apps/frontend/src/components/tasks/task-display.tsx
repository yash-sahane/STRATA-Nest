'use client';

import { Calendar } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn, getInitials } from '@/lib/utils';
import { dueDateLabel } from '@/lib/task-dates';
import { getTaskStatusConfig } from '@/lib/semantic/status';
import type { Task, TaskStatus } from '@/types';

/**
 * How a task is drawn: the pieces the tasks board, the sprint board and the task
 * dialog share, so the same task looks the same wherever it is. The two boards
 * had drifted — different column colours (In Progress yellow on one, blue on the
 * other), the due date as a date on one and "Due 28 days ago" in plain grey on
 * the other, assignees as initials on one and names on the other.
 */

/**
 * A stored label that is not a string, as text. Labels are strings, but the
 * column is JSON and nothing used to check them, so a `42` or an object could be
 * stored — and every board called `.split` on it and crashed for everybody who
 * opened the project. Such a value is shown as what it is instead.
 */
function notALabel(label: unknown): string {
  if (typeof label === 'number' || typeof label === 'boolean') return String(label);
  try {
    return JSON.stringify(label) ?? '';
  } catch {
    return '';
  }
}

/** A label is "colour:text"; without a colour (or text) it is grey and all text. */
export function parseLabel(label: unknown): { color: string; text: string } {
  if (typeof label !== 'string') return { color: 'gray', text: notALabel(label) };
  const colon = label.indexOf(':');
  const text = colon >= 0 ? label.slice(colon + 1) : '';
  return text ? { color: label.slice(0, colon), text } : { color: 'gray', text: label };
}

/** What a label says, without its colour. */
export const labelText = (label: unknown): string => parseLabel(label).text;

/** Whether a stored label is one this app writes, i.e. a string. */
export const isLabel = (label: unknown): label is string => typeof label === 'string';

/** Badge colours by label colour; anything unknown is grey. */
export const labelColorMap: Record<string, string> = {
  red: 'bg-red-500/10 text-destructive-text border-red-500/20',
  orange: 'bg-orange-500/10 text-warning-text border-orange-500/20',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  green: 'bg-green-500/10 text-success-text border-green-500/20',
  blue: 'bg-blue-500/10 text-info-text border-blue-500/20',
  purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  pink: 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20',
  gray: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
};

/** The badge classes for a label's colour. */
export const labelColorClass = (label: unknown): string =>
  labelColorMap[parseLabel(label).color] ?? labelColorMap.gray;

/**
 * A card's due date, by the DAY (lib/task-dates.ts): "Due today", "Overdue by
 * 3 days" in the destructive colour, the date itself once the task is done.
 */
export function TaskDueDate({
  task,
  className,
}: {
  task: Pick<Task, 'dueDate' | 'status'>;
  className?: string;
}) {
  const due = dueDateLabel(task);
  if (!due) return null;
  return (
    <span
      className={cn(
        'flex items-center gap-1',
        due.overdue && 'font-medium text-destructive-text',
        className
      )}
      title={due.title}
    >
      <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
      {/* Whole, never folded: a card is ~165px wide, and with the body's
          `overflow-wrap: anywhere` a squeezed "Overdue by 31 days" broke across
          lines and pushed the estimate beside it into "4 / h". The footer wraps
          whole items instead. */}
      <span className="whitespace-nowrap">{due.text}</span>
    </span>
  );
}

/**
 * Everybody on the card, not only the first: up to two initials and "+N", with
 * the names in the title and the accessible name. It showed one person's
 * initials whoever else was assigned, and a bare "U" when the names were not
 * stored.
 */
export function CardAssignees({ task }: { task: Pick<Task, 'assigneeIds' | 'assigneeNames'> }) {
  const ids = task.assigneeIds ?? [];
  if (ids.length === 0) return null;
  const names = (task.assigneeNames ?? []).length === ids.length ? task.assigneeNames : [];
  const who = names.length
    ? names.join(', ')
    : `${ids.length} ${ids.length === 1 ? 'person' : 'people'}`;
  return (
    <div
      className="flex items-center -space-x-1.5"
      title={`Assigned to ${who}`}
      aria-label={`Assigned to ${who}`}
    >
      {ids.slice(0, 2).map((id, i) => (
        <Avatar key={id} className="h-5 w-5 border border-background">
          <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
            {names[i] ? getInitials(names[i]) : '?'}
          </AvatarFallback>
        </Avatar>
      ))}
      {ids.length > 2 && <span className="pl-2.5 text-[11px]">+{ids.length - 2}</span>}
    </div>
  );
}

/**
 * A board column's header, coloured from the status it holds — the same tone the
 * status badge has everywhere else (lib/semantic/status.ts). The boards each kept
 * their own palette, and they disagreed: To Do blue on one and grey on the other.
 * `hint` is a line under the title, e.g. who signs work off into Done.
 */
export function BoardColumnHeader({
  status,
  count,
  hint,
}: {
  status: TaskStatus;
  count: number;
  hint?: string;
}) {
  const config = getTaskStatusConfig(status);
  return (
    <div className={cn('rounded-t-lg border-t-4 bg-muted/50 p-3', config.border)}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', config.dot)} />
        {config.label}
        <span className="text-xs font-normal text-muted-foreground">({count})</span>
      </h3>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
