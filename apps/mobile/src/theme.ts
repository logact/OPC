/**
 * Shared dark theme tokens, mirroring the UI prototype (:root block in
 * UI/prototype.html). Baseline for all screens.
 */

export const theme = {
  colors: {
    bg: '#0b0e14',
    panel: '#12161f',
    panel2: '#181e2a',
    line: '#232b3a',
    text: '#e8ecf4',
    muted: '#8a94a8',
    accent: '#4f7cff',
    accent2: '#22c55e',
    agent: '#a78bfa',
    bubbleMe: '#2b5cff',
    bubbleOther: '#1c2331',
    danger: '#ef4444',
  },
} as const;

export type Theme = typeof theme;
