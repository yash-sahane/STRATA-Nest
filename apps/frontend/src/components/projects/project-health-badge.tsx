'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProjectHealthBadgeProps {
  score: number;
  /** Also name the band ("Warning") beside the score. */
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** What the figure measures — lib/project-health.ts — said where it is shown. */
const HEALTH_EXPLAINED =
  'Health starts at 100 and loses points for overdue tasks, overdue critical tasks, blocked tasks, and work falling behind the project’s schedule. It is not how much of the work is done.';

export function ProjectHealthBadge({
  score,
  showLabel = true,
  size = 'md',
  className,
}: ProjectHealthBadgeProps) {
  const getHealthConfig = () => {
    if (score < 40) {
      return {
        label: 'Critical',
        icon: TrendingDown,
        className:
          'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800',
      };
    }
    if (score < 70) {
      return {
        label: 'Warning',
        icon: Minus,
        className:
          'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800',
      };
    }
    if (score < 90) {
      return {
        label: 'Good',
        icon: Activity,
        className:
          'bg-green-100 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800',
      };
    }
    return {
      label: 'Excellent',
      icon: TrendingUp,
      className:
        'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800',
    };
  };

  const config = getHealthConfig();
  const Icon = config.icon;

  const iconSize = size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm';

  // "Health" is part of the visible text, not left to the colour: a bare "60%"
  // on a project card read as how far along the project was. Focusable so the
  // explanation can be reached from the keyboard as well as by pointer; `img`
  // so it is announced as one labelled figure, band included, rather than as
  // loose text whose meaning was only the colour.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          role="img"
          tabIndex={0}
          aria-label={`Project health ${score}%: ${config.label}`}
          className={cn(config.className, textSize, 'font-medium', className)}
        >
          <Icon className={cn(iconSize, 'mr-1')} aria-hidden="true" />
          Health {score}%{showLabel && ` · ${config.label}`}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">
          Health {score}% — {config.label}
        </p>
        <p className="text-xs text-muted-foreground">{HEALTH_EXPLAINED}</p>
      </TooltipContent>
    </Tooltip>
  );
}
