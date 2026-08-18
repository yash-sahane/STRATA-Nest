'use client';

import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProjectHealthBadgeProps {
  score: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

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

  return (
    <Badge variant="outline" className={cn(config.className, textSize, 'font-medium', className)}>
      <Icon className={cn(iconSize, showLabel && 'mr-1.5')} />
      {showLabel && (
        <>
          {config.label} {score}%
        </>
      )}
      {!showLabel && <span className="ml-1">{score}%</span>}
    </Badge>
  );
}
