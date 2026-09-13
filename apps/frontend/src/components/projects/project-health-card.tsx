'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Link2,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectHealthMetrics } from '@/lib/project-health';
import { getHealthColor, getHealthBgColor, getHealthBorderColor } from '@/lib/project-health';
import { cn } from '@/lib/utils';

/**
 * A FIXED viewport for the recommendation list, tall enough for two one-line
 * rows (38px each plus the 8px `space-y-2` between them, measured).
 *
 * This card summarises the project's TASKS, which are a second request, so it
 * fills in after the page has already painted. Anything about it whose height
 * depends on the data therefore shoves everything below it down (or yanks it
 * up) a frame later — this route's 0.16 layout-shift score, the worst in the
 * app. `calculateProjectHealth` emits between ZERO and FIVE recommendations
 * (measured live: a 4-task project with nothing done, nothing overdue and
 * nothing blocked scores 60/"warning" and emits none, because that function's
 * own fallback only fires at score >= 70), and each row is 38px at full width
 * but 56px once the text wraps. That is a 0..250px swing in a slot no
 * placeholder can predict.
 *
 * Capping the slot and scrolling past it makes the card's height a constant, so
 * the loading state and the finished state agree to the pixel whatever the data
 * says. Nothing is hidden: the header counts the overflow and the list scrolls.
 */
const RECOMMENDATION_SLOT = 'h-[84px]';
const RECOMMENDATION_ROWS = 2;

interface ProjectHealthCardProps {
  health: ProjectHealthMetrics | null;
  projectName?: string;
  /**
   * The project's task list is still in flight. The card renders its real
   * frame — the same header, the same four tiles, the same recommendation slot
   * — with the NUMBERS replaced by skeletons of the exact line-height they
   * stand in. A separate placeholder component drifts from the card it stands
   * in for (the previous one was 84px too tall, measured); this one cannot,
   * because it is the same DOM.
   */
  loading?: boolean;
}

/** One of the four metric tiles. Extracted so the loading and loaded states
 *  cannot disagree about the box model. */
function MetricTile({
  icon: Icon,
  label,
  caption,
  tone,
  valueClassName,
  children,
}: {
  icon: LucideIcon;
  label: string;
  caption: React.ReactNode;
  /** Border/background for the alerting state. Empty means the house default:
   *  a bare `border`, i.e. `--border`, the same boundary every other bordered
   *  box in the app uses. It replaced `border-gray-200 dark:border-gray-900`,
   *  whose dark half sat at 1.09:1 against the card (#111827 L=0.00777 vs
   *  --card #0a0a0a L=0.00302) and so had no visible edge at all; `--border`
   *  is 1.31:1 in dark (#262626 L=0.01942) and 1.26:1 in light (#e5e5e5
   *  L=0.78345 vs #ffffff), identical to the Card's own outline. */
  tone?: string;
  valueClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-lg p-3 border', tone)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className={cn('text-2xl font-bold', valueClassName)}>{children}</div>
      <div className="text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}

export function ProjectHealthCard({ health, projectName, loading }: ProjectHealthCardProps) {
  // One nullable value drives every branch, so TypeScript narrows the loading
  // state for us and no arm can read a metric that is not there yet.
  const metrics = loading ? null : health;

  // calculateProjectHealth partitions the project's tasks into exactly these
  // three buckets (`activeTasksCount` is "not done and not blocked"), so they
  // sum to the real total. `overdueTasksCount` is a CROSS-CUT of active+blocked,
  // and adding it here inflated the denominator — a 10-task project with 3
  // overdue read "5 of 13 tasks" directly under a 50% completion figure.
  const totalTasks = metrics
    ? metrics.completedTasksCount + metrics.activeTasksCount + metrics.blockedTasksCount
    : 0;

  // A project with no tasks scores 100/"excellent" by construction, which is a
  // verdict the data cannot support. The card still renders — it holds the
  // layout, and its recommendation explains the emptiness — but the score, the
  // grade and the meter read as "no data" rather than as a perfect result.
  const scored = metrics !== null && totalTasks > 0;
  const recommendations = metrics?.recommendations ?? [];
  const hiddenRecommendations = Math.max(0, recommendations.length - RECOMMENDATION_ROWS);

  return (
    <Card
      className={cn(
        'border-2',
        scored && metrics ? getHealthBorderColor(metrics.score) : 'border-border'
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Project Health
              {projectName && (
                <span className="text-muted-foreground text-base">• {projectName}</span>
              )}
            </CardTitle>
            <CardDescription>Overall project performance metrics</CardDescription>
          </div>
          {/* text-4xl is a 40px line box, so the h-10 skeleton is the same
              height as the figure it stands in. */}
          <div
            className={cn(
              'text-4xl font-bold',
              scored && metrics ? getHealthColor(metrics.score) : 'text-muted-foreground'
            )}
          >
            {metrics ? (scored ? `${metrics.score}%` : '—') : <Skeleton className="h-10 w-20" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Health Score Meter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Health Score</span>
            {metrics ? (
              scored ? (
                <Badge
                  variant={
                    metrics.status === 'critical'
                      ? 'destructive'
                      : metrics.status === 'warning'
                        ? 'outline'
                        : 'default'
                  }
                  className={cn(
                    metrics.status === 'warning' && 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950 dark:text-yellow-200',
                    metrics.status === 'good' && 'bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-200',
                    metrics.status === 'excellent' &&
                      'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200'
                  )}
                >
                  {metrics.status.charAt(0).toUpperCase() + metrics.status.slice(1)}
                </Badge>
              ) : (
                <Badge variant="secondary">Not scored</Badge>
              )
            ) : (
              // A real Badge, so the row keeps its 22px height (text-xs 16px +
              // py-0.5 + border); an h-4 skeleton stands in for the label.
              <Badge variant="outline">
                <Skeleton className="h-4 w-16" />
              </Badge>
            )}
          </div>
          <Progress
            value={scored && metrics ? metrics.score : 0}
            className={cn('h-3', scored && metrics && getHealthBgColor(metrics.score))}
          />
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <MetricTile
            icon={CheckCircle2}
            label="Completion"
            tone={scored && metrics ? getHealthBorderColor(metrics.completionRate) : undefined}
            caption={
              metrics ? (
                `${metrics.completedTasksCount} of ${totalTasks} tasks`
              ) : (
                <Skeleton className="h-4 w-28" />
              )
            }
          >
            {metrics ? `${metrics.completionRate}%` : <Skeleton className="h-8 w-16" />}
          </MetricTile>

          <MetricTile
            icon={AlertTriangle}
            label="Overdue"
            tone={
              metrics && metrics.overdueTasksCount > 0
                ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
                : undefined
            }
            valueClassName={
              metrics
                ? metrics.overdueTasksCount > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-green-700 dark:text-green-400'
                : undefined
            }
            caption={
              metrics ? `${metrics.overdueRate}% of total tasks` : <Skeleton className="h-4 w-28" />
            }
          >
            {metrics ? metrics.overdueTasksCount : <Skeleton className="h-8 w-16" />}
          </MetricTile>

          <MetricTile
            icon={Clock}
            label="Active"
            tone={
              metrics && metrics.activeTasksCount > 20
                ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30'
                : undefined
            }
            caption={metrics ? 'In progress or pending' : <Skeleton className="h-4 w-28" />}
          >
            {metrics ? metrics.activeTasksCount : <Skeleton className="h-8 w-16" />}
          </MetricTile>

          <MetricTile
            icon={Link2}
            label="Blocked"
            tone={
              metrics && metrics.blockedTasksCount > 0
                ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/30'
                : undefined
            }
            valueClassName={
              metrics
                ? metrics.blockedTasksCount > 0
                  ? 'text-orange-700 dark:text-orange-400'
                  : 'text-gray-600 dark:text-gray-400'
                : undefined
            }
            caption={metrics ? 'Waiting on dependencies' : <Skeleton className="h-4 w-28" />}
          >
            {metrics ? metrics.blockedTasksCount : <Skeleton className="h-8 w-16" />}
          </MetricTile>
        </div>

        {/* Recommendations — always rendered, always the same height. See
            RECOMMENDATION_SLOT. */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="h-4 w-4 text-yellow-700 dark:text-yellow-400" />
            <span>Recommendations</span>
            {hiddenRecommendations > 0 && (
              // whitespace-nowrap: this sits in a non-wrapping flex row whose
              // 20px height the slot arithmetic depends on.
              <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">
                +{hiddenRecommendations} more, scroll to read
              </span>
            )}
          </div>
          <ul
            // Focusable because it scrolls: without this a keyboard-only user
            // cannot reach recommendations three and beyond.
            tabIndex={0}
            aria-label="Project health recommendations"
            className={cn(
              'space-y-2 overflow-y-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              RECOMMENDATION_SLOT
            )}
          >
            {!metrics ? (
              <li>
                <Skeleton className="h-9 w-full" />
              </li>
            ) : recommendations.length > 0 ? (
              recommendations.map((recommendation, index) => (
                <li
                  key={index}
                  className="text-sm text-muted-foreground flex items-start gap-2 p-2 rounded-md bg-muted/50"
                >
                  <span className="text-primary mt-0.5">•</span>
                  <span>{recommendation}</span>
                </li>
              ))
            ) : (
              // Reachable, and not the same thing as "healthy":
              // `calculateProjectHealth`'s catch-all only fires at score >= 70,
              // so a warning-grade project can produce an empty list. Say what
              // the list means rather than pass a verdict the data has not
              // earned. (The real gap is in lib/project-health.ts.)
              <li className="text-sm text-muted-foreground flex items-start gap-2 p-2 rounded-md bg-muted/50">
                <span className="text-primary mt-0.5">•</span>
                <span>
                  No recommendations yet — they appear when tasks fall overdue, get blocked, or
                  pile up.
                </span>
              </li>
            )}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
