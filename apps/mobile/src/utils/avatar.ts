/**
 * Deterministic avatar colors, hashed from an id so each room/participant
 * keeps a stable color across renders (mirrors the prototype's per-contact
 * avatar colors).
 */
export const AVATAR_PALETTE = [
  '#4f7cff',
  '#a78bfa',
  '#f59e0b',
  '#22c55e',
  '#38bdf8',
  '#f472b6',
  '#fb7185',
  '#34d399',
] as const;

export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
