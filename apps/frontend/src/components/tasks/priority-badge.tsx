'use client';

import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, Info, Minus } from 'lucide-react';
import type { TaskPriority } from '@/types';

interface PriorityBadgeProps {
  priority: TaskPriority;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function PriorityBadge({ priority, showLabel = true, size = 'md' }: PriorityBadgeProps) {
  const config = getPriorityConfig(priority);
  
  const iconSize = size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm';

  return (
    <Badge
      variant="outline"
      className={`${config.className} ${textSize} font-medium`}
    >
      <config.icon className={`${iconSize} ${showLabel ? 'mr-1.5' : ''}`} />
      {showLabel && config.label}
    </Badge>
  );
}

export function getPriorityConfig(priority: TaskPriority) {
  switch (priority) {
    case 'CRITICAL':
      return {
        label: 'P1 - Critical',
        shortLabel: 'P1',
        icon: AlertCircle,
        className: 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100',
        color: 'red',
        score: 4,
      };
    case 'HIGH':
      return {
        label: 'P2 - High',
        shortLabel: 'P2',
        icon: AlertTriangle,
        className: 'bg-orange-50 text-orange-700 border-orange-300 hover:bg-orange-100',
        color: 'orange',
        score: 3,
      };
    case 'MEDIUM':
      return {
        label: 'P3 - Medium',
        shortLabel: 'P3',
        icon: Info,
        className: 'bg-yellow-50 text-yellow-700 border-yellow-300 hover:bg-yellow-100',
        color: 'yellow',
        score: 2,
      };
    case 'LOW':
      return {
        label: 'P4 - Low',
        shortLabel: 'P4',
        icon: Minus,
        className: 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100',
        color: 'green',
        score: 1,
      };
    default:
      return {
        label: 'No Priority',
        shortLabel: '--',
        icon: Minus,
        className: 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100',
        color: 'gray',
        score: 0,
      };
  }
}
