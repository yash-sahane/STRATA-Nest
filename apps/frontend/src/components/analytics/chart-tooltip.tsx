'use client';

import * as React from 'react';

/** One series datum as recharts hands it to a custom tooltip. */
interface ChartTooltipEntry {
  name?: React.ReactNode;
  value?: number | string;
  color?: string;
  payload?: { color?: string; fill?: string };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipEntry[];
  label?: React.ReactNode;
  labelFormatter?: (
    label: React.ReactNode,
    payload: ChartTooltipEntry[]
  ) => React.ReactNode;
  formatter?: (
    value: ChartTooltipEntry['value'],
    name: ChartTooltipEntry['name'],
    entry: ChartTooltipEntry,
    index: number
  ) => React.ReactNode | [React.ReactNode, React.ReactNode];
}

/**
 * Theme-aware tooltip content for recharts.
 *
 * Replaces the recharts default tooltip (hardcoded white background) with the
 * app background/border tokens so tooltips render correctly in dark mode.
 * Usage: <Tooltip content={<ChartTooltip />} /> — any formatter/labelFormatter
 * props on <Tooltip> are forwarded by recharts and honored here.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      {label !== undefined && label !== null && label !== '' && (
        <p className="mb-1 text-sm font-medium">
          {labelFormatter ? labelFormatter(label, payload) : label}
        </p>
      )}
      {payload.map((entry, index) => {
        let name = entry.name;
        let value: React.ReactNode = entry.value;
        if (formatter) {
          const formatted = formatter(entry.value, entry.name, entry, index);
          if (Array.isArray(formatted)) {
            value = formatted[0];
            name = formatted[1] ?? name;
          } else if (formatted !== undefined) {
            value = formatted;
          }
        }
        return (
          <p
            key={index}
            className="text-sm"
            style={{ color: entry.color || entry.payload?.color || entry.payload?.fill }}
          >
            {name}: {value}
          </p>
        );
      })}
    </div>
  );
}
