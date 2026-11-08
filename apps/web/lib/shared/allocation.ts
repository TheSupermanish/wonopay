/**
 * Checkout share allocation. Shares are USDC cents per source token (display-level choice;
 * the server converts to base units and checks the exact sum).
 */

export type Selection = Readonly<Record<string, number>>;

/**
 * Add a token worth up to `want` cents. If part of the amount is still uncovered, the new token
 * fills only that gap and existing shares stay. If it is fully covered, room is made by shrinking
 * the smallest routed shares first (fewer routes, lower fees), and direct shares (`isDirect`) only
 * as a last resort.
 */
export function addShare(selection: Selection, remainingCents: number, assetId: string, want: number, isDirect: (assetId: string) => boolean): Record<string, number> {
  const next: Record<string, number> = { ...selection };
  delete next[assetId];
  let free = remainingCents - Object.values(next).reduce((sum, value) => sum + value, 0);
  let need = free > 0 ? 0 : want;
  const displaceable = Object.keys(next).sort((a, b) => Number(isDirect(a)) - Number(isDirect(b)) || next[a]! - next[b]!);
  for (const id of displaceable) {
    if (need <= 0) break;
    const take = Math.min(next[id]!, need);
    next[id] = next[id]! - take;
    if (next[id] === 0) delete next[id];
    need -= take;
    free += take;
  }
  const share = Math.min(want, free);
  if (share > 0) next[assetId] = share;
  return next;
}
