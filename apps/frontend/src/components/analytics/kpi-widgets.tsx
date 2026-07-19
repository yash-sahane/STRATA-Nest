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
    if (trend.value > 0) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trend.value < 0) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-500" />;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    if (trend.value > 0) return 'text-green-500';
    if (trend.value < 0) return 'text-red-500';
    return 'text-gray-500';
  };

  return (
    <Card className={cn('transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md', className)}>
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

interface ProgressCircleProps {
  value: number;
  max: number;
  label: string;
  size?: number;
  strokeWidth?: number;
  showPercentage?: boolean;
  className?: string;
}

export function ProgressCircle({
  value,
  max,
  label,
  size = 120,
  strokeWidth = 8,
  showPercentage = true,
  className,
}: ProgressCircleProps) {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const getColor = () => {
    if (percentage >= 90) return 'text-green-500';
    if (percentage >= 70) return 'text-blue-500';
    if (percentage >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-gray-200 dark:text-gray-700"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn('transition-all duration-500', getColor())}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold">
            {showPercentage ? `${Math.round(percentage)}%` : value}
          </div>
          {!showPercentage && <div className="text-xs text-muted-foreground">of {max}</div>}
        </div>
      </div>
      <div className="text-sm font-medium text-center">{label}</div>
    </div>
  );
}

interface StatComparisonProps {
  label: string;
  current: number;
  previous: number;
  format?: 'number' | 'percentage' | 'currency' | 'hours';
  className?: string;
}

export function StatComparison({
  label,
  current,
  previous,
  format = 'number',
  className,
}: StatComparisonProps) {
  const diff = current - previous;
  const percentChange = previous > 0 ? (diff / previous) * 100 : 0;

  const formatValue = (value: number) => {
    switch (format) {
      case 'percentage':
        return `${value.toFixed(1)}%`;
      case 'currency':
        return `$${value.toLocaleString()}`;
      case 'hours':
        return `${value}h`;
      default:
        return value.toLocaleString();
    }
  };

  return (
    <div className={cn('space-y-1', className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-bold">{formatValue(current)}</div>
        <div className="flex items-center gap-1">
          {diff > 0 && (
            <>
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-green-500">
                +{formatValue(diff)} ({percentChange.toFixed(1)}%)
              </span>
            </>
          )}
          {diff < 0 && (
            <>
              <TrendingDown className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium text-red-500">
                {formatValue(diff)} ({percentChange.toFixed(1)}%)
              </span>
            </>
          )}
          {diff === 0 && (
            <>
              <Minus className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-500">No change</span>
            </>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        vs previous period: {formatValue(previous)}
      </div>
    </div>
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

interface MiniChartProps {
  data: number[];
  height?: number;
  className?: string;
}

export function MiniChart({ data, height = 40, className }: MiniChartProps) {
  if (data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      className={cn('w-full', className)}
      style={{ height: `${height}px` }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
      />
    </svg>
  );
}
