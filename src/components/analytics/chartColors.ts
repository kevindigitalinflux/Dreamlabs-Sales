import type { Theme } from '../../hooks/useTheme';

export interface ChartNeutrals {
  grid: string;
  tick: string;
  cursor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

const DARK: ChartNeutrals = {
  grid: 'rgba(255,255,255,0.08)',
  tick: 'rgba(244,244,248,0.55)',
  cursor: 'rgba(255,255,255,0.04)',
  tooltipBg: '#111C6A',
  tooltipBorder: 'rgba(255,255,255,0.08)',
  tooltipText: '#F4F4F8',
};

const LIGHT: ChartNeutrals = {
  grid: 'rgba(4,15,73,0.10)',
  tick: 'rgba(4,15,73,0.55)',
  cursor: 'rgba(4,15,73,0.04)',
  tooltipBg: '#FFFFFF',
  tooltipBorder: 'rgba(4,15,73,0.10)',
  tooltipText: '#040F49',
};

/** The recharts-specific neutral colors (gridlines, tooltips, axis ticks) for the given theme — matches index.css's light/dark neutral values exactly, since recharts can't read CSS custom properties. */
export function chartNeutralsFor(theme: Theme): ChartNeutrals {
  return theme === 'dark' ? DARK : LIGHT;
}
