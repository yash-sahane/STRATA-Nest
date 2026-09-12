import * as React from 'react';

/**
 * Legend label renderer for every Recharts `<Legend />` in the app.
 *
 * Recharts paints each legend LABEL in its own series colour. A saturated
 * colour that reads perfectly well as a 2px line is not necessarily readable as
 * 12px text: the burndown chart's `--info` label measured 4.05:1 against the
 * dark background, under the 4.5:1 floor, and every other chart carries the
 * same exposure the moment a series is given a strong colour.
 *
 * The coloured icon beside the label already identifies the series, so the
 * words do not also have to carry the colour — they are better as ordinary
 * foreground text, which is legible in both themes by construction.
 *
 * Use on every legend:  <Legend formatter={legendLabel} />
 */
export const legendLabel = (value: React.ReactNode) => (
  <span className="text-foreground">{value}</span>
);
