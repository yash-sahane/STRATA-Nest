'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  className?: string;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
}: MetricCardProps) {
  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.value > 0) return <TrendingUp className="h-4 w-4 text-green-700 dark:text-green-500" />;
    if (trend.value < 0) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-500" />;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    if (trend.value > 0) return 'text-green-700 dark:text-green-500';
    if (trend.value < 0) return 'text-red-500';
    return 'text-gray-500';
  };

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            {getTrendIcon()}
            <span className={cn('text-xs font-medium', getTrendColor())}>
              {Math.abs(trend.value)}% {trend.label}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface HealthBadgeProps {
  value: number;
  thresholds?: {
    excellent: number;
    good: number;
    warning: number;
  };
  className?: string;
}

export function HealthBadge({
  value,
  thresholds = { excellent: 90, good: 70, warning: 40 },
  className,
}: HealthBadgeProps) {
  const getStatus = () => {
    if (value >= thresholds.excellent)
      return { label: 'Excellent', variant: 'default' as const, color: 'bg-green-500' };
    if (value >= thresholds.good)
      return { label: 'Good', variant: 'default' as const, color: 'bg-blue-500' };
    if (value >= thresholds.warning)
      return { label: 'Fair', variant: 'default' as const, color: 'bg-yellow-500' };
    return { label: 'At Risk', variant: 'destructive' as const, color: 'bg-red-500' };
  };

  const status = getStatus();

  return (
    <Badge variant={status.variant} className={cn('gap-1', className)}>
      <div className={cn('h-2 w-2 rounded-full', status.color)} />
      {status.label}
    </Badge>
  );
}
