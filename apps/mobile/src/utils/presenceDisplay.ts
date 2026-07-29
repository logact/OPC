/**
 * Agent presence display derivation (issue #83): agents publish a busy/idle
 * `status` alongside the `online` flag on their presence topic; the display
 * layer folds both into 5 states: `!online → 'offline'`, otherwise
 * `status ?? 'idle'`. Human participants never carry `status` and keep the
 * plain online/offline rendering (their callers don't use this helper).
 */
import type { AgentPresenceStatus } from '@logact-pub/opc-protocol';
import { theme } from '../theme';

export type PresenceDisplayState = 'idle' | 'working' | 'blocking' | 'error' | 'offline';

export interface PresenceDisplay {
  state: PresenceDisplayState;
  color: string;
  label: string;
}

const STATE_COLORS: Record<PresenceDisplayState, string> = {
  idle: theme.colors.accent,
  working: theme.colors.accent2,
  blocking: theme.colors.warning,
  error: theme.colors.danger,
  offline: theme.colors.muted,
};

export function presenceDisplay(
  presence: { online: boolean; status?: AgentPresenceStatus } | undefined,
): PresenceDisplay {
  // `status` is only meaningful while online; offline comes from `online: false`
  // (or no presence at all — participant never came online).
  const state: PresenceDisplayState = presence?.online ? (presence.status ?? 'idle') : 'offline';
  return { state, color: STATE_COLORS[state], label: state };
}
