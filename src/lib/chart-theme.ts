/**
 * Nordic Pro — Unified Chart & Visualization Color Theme
 *
 * All diagram, KPI, and map colors flow from CSS custom properties
 * defined in index.css (--chart-1 … --chart-8) so they automatically
 * adapt to light / dark / SWG themes.
 */

// ── Semantic chart colors ──────────────────────────────────────────
export const CHART_COLORS = {
  /** Primary data series (purple — app primary) */
  primary: 'hsl(var(--chart-1))',
  /** Secondary data series (cool blue) */
  secondary: 'hsl(var(--chart-2))',
  /** Positive / growth (muted teal) */
  positive: 'hsl(var(--chart-3))',
  /** Warning / medium (warm amber) */
  warning: 'hsl(var(--chart-4))',
  /** Negative / risk (muted rose) */
  negative: 'hsl(var(--chart-5))',
  /** Support color 1 (blue-grey) */
  support1: 'hsl(var(--chart-6))',
  /** Support color 2 (lavender) */
  support2: 'hsl(var(--chart-7))',
  /** Strong positive / success (dark green) */
  success: 'hsl(var(--chart-8))',
} as const;

// ── Sequential palette for multi-series charts ─────────────────────
export const SEQUENTIAL_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.positive,
  CHART_COLORS.warning,
  CHART_COLORS.negative,
  CHART_COLORS.support1,
  CHART_COLORS.support2,
  CHART_COLORS.success,
] as const;

// ── Energy-rating colors ───────────────────────────────────────────
export const ENERGY_RATING_COLORS: Record<string, string> = {
  A: CHART_COLORS.success,   // dark green
  B: CHART_COLORS.positive,  // teal
  C: CHART_COLORS.warning,   // amber
  D: CHART_COLORS.negative,  // rose
  E: 'hsl(var(--destructive))',
};

// ── Risk-level colors ──────────────────────────────────────────────
export const RISK_COLORS: Record<string, string> = {
  Low: CHART_COLORS.positive,
  Medium: CHART_COLORS.warning,
  High: CHART_COLORS.negative,
};

// ── Status colors ──────────────────────────────────────────────────
export const STATUS_COLORS: Record<string, string> = {
  OK: CHART_COLORS.positive,
  Planned: CHART_COLORS.warning,
  Critical: 'hsl(var(--destructive))',
};

// ── Sensor line colors (for sparkline charts) ──────────────────────
export const SENSOR_LINE_COLORS = {
  temperature: CHART_COLORS.positive,
  co2: CHART_COLORS.secondary,
  humidity: CHART_COLORS.support2,
  light: CHART_COLORS.warning,
  occupancy: CHART_COLORS.negative,
} as const;

// ── Icon color classes (for KPI icons etc.) ────────────────────────
export const ICON_COLOR_CLASSES = {
  primary: 'text-primary',
  blue: 'text-[hsl(var(--chart-2))]',
  green: 'text-[hsl(var(--chart-3))]',
  amber: 'text-[hsl(var(--chart-4))]',
  rose: 'text-[hsl(var(--chart-5))]',
  lavender: 'text-[hsl(var(--chart-7))]',
} as const;
