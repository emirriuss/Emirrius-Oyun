/** World map cursor movement (pure, unit-tested). */

export type Dir = 'up' | 'down' | 'left' | 'right';

type Node = { page: number };

/**
 * The node to move to when `dir` is pressed on node `from`, or -1 to stay put.
 *  - left/right: previous/next node in play order (crossing page edges), if unlocked.
 *  - up/down: the previous/next page that has anything unlocked, landing on its "current"
 *    node (see `pageFocus`).
 */
export function neighbor(nodes: readonly Node[], from: number, dir: Dir, unlocked: (i: number) => boolean, done: (i: number) => boolean = () => false): number {
  if (dir === 'left' || dir === 'right') {
    const j = from + (dir === 'right' ? 1 : -1);
    return j >= 0 && j < nodes.length && unlocked(j) ? j : -1;
  }
  const step = dir === 'down' ? 1 : -1;
  const last = Math.max(...nodes.map((n) => n.page));
  for (let p = nodes[from].page + step; p >= 0 && p <= last; p += step) {
    const j = pageFocus(nodes, p, unlocked, done);
    if (j >= 0) return j;
  }
  return -1;
}

/**
 * The node to land on when page `p` is opened: its first unlocked, uncleared node, else its
 * last unlocked one; -1 if nothing on it is unlocked.
 */
export function pageFocus(nodes: readonly Node[], p: number, unlocked: (i: number) => boolean, done: (i: number) => boolean = () => false): number {
  let lastOpen = -1;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].page !== p || !unlocked(i)) continue;
    if (!done(i)) return i;
    lastOpen = i;
  }
  return lastOpen;
}
