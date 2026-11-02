import type { LevelDef } from '../../levels/types';

/**
 * World map geometry (pure: no Phaser, so it's unit-tested).
 *
 * The map is a strip of full-screen pages laid side by side in world space (page p spans
 * x = p*PAGE_W .. (p+1)*PAGE_W); the camera slides between them while the header and
 * preview panel stay fixed:
 *
 *   [ SHRINE ][ W1 ][ W2 ][ W3 ][ W4 ][ THE MARGIN ]
 *
 * Every page is one diorama with its levels on a winding path, left to right in play order,
 * so left/right always means "previous/next level". The margin page holds the post-game
 * levels (`region: 'margin'`) and only exists once its first level unlocks.
 */

export type World = 1 | 2 | 3 | 4;
export type PageKind = 'shrine' | 'world' | 'margin';

export const PAGE_W = 480;
/** the diorama each page draws its nodes on */
export const STAGE = { x: 10, y: 28, w: 460, h: 182 } as const;
/** top edge of the preview panel; node labels must stay above it */
export const PANEL_TOP = 213;
/** vertical centre line of a page's path, and how far nodes swing above/below it */
export const PATH_Y = 128;
export const PATH_SWING = 16;
/** room left of the first / right of the last node, so the path visibly runs on from the page edge */
export const PAGE_PAD = 58;
/** the margin page packs more slots, so it gives up some of that edge room (nodes stay >= 60px apart) */
export const MARGIN_PAD = 36;
/** slots on the margin page (fixed, so nodes don't shift as later post-game levels unlock) */
export const MARGIN_SLOTS = 7;

export const SHRINE_ID = 'shrine';
/** the shrine crystal floats over the dais painted on the shrine page */
export const SHRINE_Y = STAGE.y + STAGE.h - 54;

export interface MapPage {
  kind: PageKind;
  /** world number for 'world' pages */
  world?: World;
  /** levels drawn on this page, in play order (margin: unlocked ones only) */
  levels: LevelDef[];
}

export interface MapNode {
  /** level id, or 'shrine' */
  id: string;
  /** index into the page list */
  page: number;
  /** world-space position (page p's local x plus p * PAGE_W) */
  x: number;
  y: number;
  level?: LevelDef;
}

/** Levels drawn on world `w`'s page (play order). */
export function worldLevels(levels: readonly LevelDef[], w: World): LevelDef[] {
  return levels.filter((l) => l.world === w && !l.region);
}

/** Pages left to right: shrine, the four worlds, then the margin once any of it is unlocked. */
export function mapPages(levels: readonly LevelDef[], unlocked: (id: string) => boolean): MapPage[] {
  const pages: MapPage[] = [{ kind: 'shrine', levels: [] }];
  for (const w of [1, 2, 3, 4] as const) pages.push({ kind: 'world', world: w, levels: worldLevels(levels, w) });
  const margin = levels.filter((l) => l.region === 'margin');
  if (margin.length > MARGIN_SLOTS) throw new Error(`world map: ${margin.length} margin levels, only ${MARGIN_SLOTS} slots`);
  const shown = margin.filter((l) => unlocked(l.id));
  if (shown.length) pages.push({ kind: 'margin', levels: shown });
  return pages;
}

/** Local (on-page) position of slot `i` of `n` on page `page`: evenly spread, swinging up and down. */
export function slotPos(i: number, n: number, page: number, pad: number = PAGE_PAD): { x: number; y: number } {
  const span = STAGE.w - pad * 2;
  const x = n <= 1 ? STAGE.x + STAGE.w / 2 : STAGE.x + pad + (span * i) / (n - 1);
  // alternate pages start on opposite swings, so the path reads as one long winding trail
  const swing = (i + page) % 2 === 0 ? 1 : -1;
  return { x: Math.round(x), y: PATH_Y + (n <= 1 ? 0 : swing * PATH_SWING) };
}

/** Pages plus every node in play order (shrine first). */
export function layoutMap(levels: readonly LevelDef[], unlocked: (id: string) => boolean): { pages: MapPage[]; nodes: MapNode[] } {
  const pages = mapPages(levels, unlocked);
  const nodes: MapNode[] = [{ id: SHRINE_ID, page: 0, x: PAGE_W / 2, y: SHRINE_Y }];
  pages.forEach((pg, p) => {
    const n = pg.kind === 'margin' ? MARGIN_SLOTS : pg.levels.length;
    pg.levels.forEach((l, i) => {
      const s = slotPos(i, n, p, pg.kind === 'margin' ? MARGIN_PAD : PAGE_PAD);
      nodes.push({ id: l.id, page: p, x: p * PAGE_W + s.x, y: s.y, level: l });
    });
  });
  return { pages, nodes };
}

/** Left edge of page `p` in world space (the camera's scrollX when it's shown). */
export const pageX = (p: number) => p * PAGE_W;
