import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { InputManager } from '../core/InputManager';
import { txt, fmtTime } from '../ui/text';
import { panel, panelTexture, hintRow, gradientTexture, starfield } from '../ui/Panel';
import { transitionTo, transitioning } from '../ui/transition';
import { WORLD, C } from '../art/palette';
import { LEVELS, isUnlocked } from '../levels';
import { save } from '../systems/SaveSystem';
import { sfx } from '../systems/sfx';
import { playMusic } from '../systems/music';
import { STAGE, SHRINE_ID, SHRINE_Y, layoutMap, pageX, type MapNode, type MapPage } from './worldMap/layout';
import { neighbor, pageFocus, type Dir } from './worldMap/nav';
import { paintWorldStage, paintMarginStage, paintShrineStage, hex } from './worldMap/bands';

/** A laid-out node plus its click zone. */
interface Node extends MapNode {
  hit: Phaser.GameObjects.Zone;
}

/** Path segments already shown this session (-1: not yet visited); newer ones animate in. */
let revealedSeen = -1;

const MARGIN_INK = '#b48ae0';
/** y of the fixed preview panel's centre */
const PREVIEW_Y = 238;

export class WorldMapScene extends Phaser.Scene {
  private pages: MapPage[] = [];
  private nodes: Node[] = [];
  private idx = 0;
  private page = 0;
  private inp!: InputManager;
  private hero!: Phaser.GameObjects.Sprite;
  private heroWalk?: Phaser.Tweens.Tween;
  private camSlide?: Phaser.Tweens.Tween;
  private sel!: Phaser.GameObjects.Image;
  private preview?: Phaser.GameObjects.Container;
  private tabs: { bg: Phaser.GameObjects.Image; open: boolean; w: number }[] = [];
  private shardText!: ReturnType<typeof txt>;
  private leaving = false;

  constructor() {
    super('WorldMap');
  }

  create(d: { focus?: string }): void {
    this.nodes = [];
    this.tabs = [];
    this.leaving = false;
    this.preview = undefined;
    this.camSlide = undefined;
    playMusic('menu');
    this.cameras.main.setBackgroundColor(0x0b0b14);
    this.inp = new InputManager(this, save.data.settings.keys);
    const open = (id: string) => isUnlocked(id, save);

    const map = layoutMap(LEVELS, open);
    this.pages = map.pages;

    // --- fixed backdrop
    const top = Math.max(1, ...LEVELS.filter((l) => open(l.id)).map((l) => l.world)) as 1 | 2 | 3 | 4;
    const P = WORLD[top];
    this.add.image(0, 0, gradientTexture(this, `ui-bg-map-${top}`, GAME_W, GAME_H, [0x0b0b14, P.sky[0], P.sky[1]], 10)).setOrigin(0, 0).setDepth(-200).setScrollFactor(0);
    starfield(this, GAME_W, GAME_H, 60, -190).forEach((s) => s.setScrollFactor(0));

    // --- pages (side by side in world space)
    this.pages.forEach((pg, p) => this.drawPage(pg, p));

    // --- nodes in play order
    for (const n of map.nodes) this.addNode(n);
    this.nodes.forEach((n) => this.drawDeco(n));
    this.drawPath();
    this.nodes.forEach((n) => this.drawNode(n));

    // --- selection + hero
    this.sel = this.add.image(0, 0, 'ui-sel', 0).setDepth(8);
    this.time.addEvent({ delay: 280, loop: true, callback: () => this.sel.setFrame(this.sel.frame.name === '0' ? 1 : 0) });
    this.hero = this.add.sprite(0, 0, 'ui-hero', 0).setDepth(9);

    // --- fixed header + preview panel
    this.drawHeader();
    panel(this, GAME_W / 2, PREVIEW_Y, 464, 50, 'dark').setScrollFactor(0).setDepth(20);

    // pick focus: given, else first unlocked uncompleted level, else the last unlocked one
    let focus = this.nodes.findIndex((n) => n.id === d?.focus);
    if (focus < 0) focus = this.nodes.findIndex((n) => n.id !== SHRINE_ID && open(n.id) && !save.isCompleted(n.id));
    if (focus < 0) focus = this.nodes.map((_, i) => (this.unlocked(i) ? i : 0)).reduce((a, b) => Math.max(a, b), 0);
    this.select(focus, true);
    this.inp.update(this.time.now);
  }

  // ---------------------------------------------------------------- pages

  private drawPage(pg: MapPage, p: number): void {
    const x0 = pageX(p) + STAGE.x;
    const y0 = STAGE.y;
    const key = pg.kind === 'shrine' ? paintShrineStage(this) : pg.kind === 'margin' ? paintMarginStage(this) : paintWorldStage(this, pg.world!);
    this.add.image(x0, y0, key).setOrigin(0, 0).setDepth(-10);

    // title strip
    const levels = pg.levels;
    const cleared = levels.filter((l) => save.isCompleted(l.id)).length;
    let title: string;
    let color: string;
    if (pg.kind === 'shrine') {
      title = 'SANCTUARY';
      color = '#ffd96a';
    } else if (pg.kind === 'margin') {
      title = 'THE MARGIN  ·  POST-GAME';
      color = MARGIN_INK;
    } else {
      title = `WORLD ${pg.world}  ·  ${WORLD[pg.world!].name.toUpperCase()}`;
      color = hex(WORLD[pg.world!].accent);
    }
    this.add.rectangle(x0 + 3, y0 + 3, STAGE.w - 6, 17, C.ink, 0.55).setOrigin(0, 0).setDepth(-9);
    txt(this, x0 + 10, y0 + 12, title, 8, color, 0).setDepth(-8);
    const total = LEVELS.length;
    const right =
      pg.kind === 'shrine'
        ? `${LEVELS.filter((l) => save.isCompleted(l.id)).length} / ${total} levels cleared`
        : pg.kind === 'margin'
          ? `${cleared} cleared`
          : `${cleared} / ${levels.length} cleared`;
    txt(this, x0 + STAGE.w - 10, y0 + 12, right, 8, cleared === levels.length && levels.length ? '#ffd96a' : '#8b8ba8', 1).setDepth(-8);

    if (pg.kind === 'shrine') this.drawShrine(pageX(p) + GAME_W / 2);

    // a world nobody has reached yet: veil it
    if (pg.kind === 'world' && !levels.some((l) => isUnlocked(l.id, save))) {
      this.add.rectangle(x0 + 3, y0 + 20, STAGE.w - 6, STAGE.h - 23, C.ink, 0.6).setOrigin(0, 0).setDepth(5);
      this.add.image(x0 + STAGE.w / 2, y0 + STAGE.h / 2 - 6, 'ui-lock').setScale(2).setDepth(6);
      txt(this, x0 + STAGE.w / 2, y0 + STAGE.h / 2 + 14, `Clear World ${pg.world! - 1} to enter`, 8, '#8b8ba8').setDepth(6);
    }
  }

  private drawShrine(cx: number): void {
    const n = { x: cx, y: this.shrineY() };
    const glow = this.add.image(n.x, n.y - 6, 'light').setTint(C.gold).setAlpha(0.45).setScale(1.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(1);
    this.tweens.add({ targets: glow, alpha: 0.2, yoyo: true, repeat: -1, duration: 900 });
    const crystal = this.add.image(n.x, n.y - 6, 'ui-crystal').setScale(2).setDepth(2);
    this.tweens.add({ targets: crystal, y: n.y - 11, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut', onUpdate: () => (crystal.y = Math.round(crystal.y)) });
  }

  private shrineY(): number {
    return SHRINE_Y;
  }

  // ---------------------------------------------------------------- header

  private drawHeader(): void {
    const fix = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T) => (o.setScrollFactor(0), o.setDepth(20), o);
    fix(this.add.image(0, 0, panelTexture(this, GAME_W, 24, 'glass')).setOrigin(0, 0));
    fix(txt(this, 10, 12, 'WORLD MAP', 14, '#7fdbff', 0));

    // page tabs
    const TW = 26;
    const GAP = 4;
    const x0 = Math.round(GAME_W / 2 - (this.pages.length * TW + (this.pages.length - 1) * GAP) / 2) + 20;
    this.pages.forEach((pg, p) => {
      const cx = x0 + p * (TW + GAP) + TW / 2;
      const isOpen = this.pageFocusOf(p) >= 0;
      const bg = fix(this.add.image(cx, 12, panelTexture(this, TW, 17, 'dark')));
      if (!isOpen) fix(this.add.image(cx, 12, 'ui-lock')).setAlpha(0.7);
      else if (pg.kind === 'shrine') fix(this.add.image(cx, 12, 'ui-crystal'));
      else if (pg.kind === 'margin') fix(txt(this, cx, 11, '&', 8, MARGIN_INK));
      else fix(txt(this, cx, 11, `W${pg.world}`, 8, hex(WORLD[pg.world!].accent)));
      if (isOpen) {
        bg.setInteractive({ useHandCursor: true }).on('pointerdown', (ptr: Phaser.Input.Pointer) => {
          if (ptr.button !== 0 || this.leaving || p === this.page) return;
          this.select(this.pageFocusOf(p));
        });
      } else bg.setAlpha(0.5);
      this.tabs.push({ bg, open: isOpen, w: TW });
    });

    const shardPanel = fix(panel(this, GAME_W - 40, 12, 64, 17, 'dark'));
    fix(this.add.image(shardPanel.x - 20, 12, 'ui-shard'));
    this.shardText = fix(txt(this, shardPanel.x - 10, 11, String(save.data.shards), 10, '#ffd96a', 0));
  }

  private refreshTabs(): void {
    this.tabs.forEach((t, p) => {
      if (!t.open) return;
      t.bg.setTexture(panelTexture(this, t.w, 17, p === this.page ? 'gold' : 'dark'));
    });
  }

  // ---------------------------------------------------------------- nodes + path

  private addNode(n: MapNode): void {
    const big = !!n.level?.boss || n.id === SHRINE_ID;
    const sz = n.id === SHRINE_ID ? 36 : big ? 22 : 18;
    const hit = this.add.zone(n.x, n.y - (n.id === SHRINE_ID ? 6 : 0), sz, sz).setInteractive({ useHandCursor: true });
    const i = this.nodes.length;
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0 || this.leaving) return;
      if (this.idx === i) this.enter();
      else if (this.unlocked(i)) this.select(i);
    });
    this.nodes.push({ ...n, hit });
  }

  /** Doodles beside a node (see `LevelDef.mapDeco`). */
  private drawDeco(n: MapNode): void {
    switch (n.level?.mapDeco) {
      case 'ampersand': {
        // ERRATUM: a typo nobody planned for, wobbling in the margin
        const amp = txt(this, n.x - 20, n.y - 16, '&', 16, '#8a4fc7').setDepth(3).setAngle(-12);
        this.tweens.add({ targets: amp, angle: 12, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
        break;
      }
      case 'mountain': {
        // ORRATH: a little range doodled behind the node, one eye half-open at the peak
        const g = this.add.graphics().setDepth(3);
        g.lineStyle(1, 0x2f7a8a, 0.9);
        const ridge: [number, number][] = [[-40, 2], [-32, -10], [-26, -6], [-16, -22], [-6, -8], [0, -12], [8, -2]];
        g.strokePoints(ridge.map(([x, y]) => ({ x: n.x + x, y: n.y + y })));
        const eye = this.add.image(n.x - 16, n.y - 15, 'light').setTint(0xffd96a).setAlpha(0.5).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
        this.tweens.add({ targets: eye, alpha: 0.1, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.inOut' });
        break;
      }
      case 'bell': {
        // CANTOR: a little bell rocking beside the node
        const g = this.add.graphics().setDepth(3).setPosition(n.x + 20, n.y - 4);
        g.fillStyle(C.gold, 1).fillTriangle(-4, 4, 4, 4, 0, -4).fillRect(-5, 4, 10, 2);
        g.fillStyle(C.ink, 1).fillRect(-1, 6, 2, 2);
        this.tweens.add({ targets: g, angle: { from: -14, to: 14 }, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.inOut' });
        break;
      }
      case 'keyhole': {
        // TUMBLAR: a brass keyhole glinting beside the node
        const g = this.add.graphics().setDepth(3).setPosition(n.x + 20, n.y - 4);
        g.fillStyle(C.gold, 1).fillCircle(0, -2, 3).fillTriangle(-3, 5, 3, 5, 0, -1);
        g.fillStyle(C.ink, 1).fillCircle(0, -2, 1).fillRect(-1, -1, 2, 4);
        this.tweens.add({ targets: g, alpha: 0.4, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
        break;
      }
      case 'lantern': {
        // UMBRA: a lantern swinging on its chain, casting a long ink shadow beside the node
        // right of the node: the path comes in from the left
        const ink = this.add.graphics().setDepth(3).setPosition(n.x + 22, n.y + 8);
        ink.fillStyle(0x1c1430, 0.9).fillTriangle(-2, 0, 2, 0, 12, -16).fillCircle(12, -17, 2);
        const g = this.add.graphics().setDepth(3).setPosition(n.x + 22, n.y - 24);
        g.lineStyle(1, 0x6a5c94, 1).lineBetween(0, 0, 0, 8);
        g.fillStyle(C.night, 1).fillRect(-3, 8, 6, 2).fillRect(-3, 16, 6, 1);
        g.fillStyle(C.gold, 1).fillRect(-2, 10, 4, 6);
        const glow = this.add.image(n.x + 22, n.y - 11, 'light').setTint(C.gold).setAlpha(0.35).setScale(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
        this.tweens.add({ targets: g, angle: { from: -10, to: 10 }, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
        this.tweens.add({ targets: glow, alpha: 0.15, yoyo: true, repeat: -1, duration: 450, ease: 'Sine.inOut' });
        break;
      }
    }
  }

  /** Clearance the path leaves around a node's art. */
  private nodeRadius(n: MapNode): number {
    return n.id === SHRINE_ID ? 22 : n.level?.boss ? 13 : 10;
  }

  /** Polylines the dotted path takes from node a to the next node b (two pieces when it crosses a page edge). */
  private segments(a: MapNode, b: MapNode): { x: number; y: number }[][] {
    if (a.page === b.page) return [[a, b]];
    const exit = pageX(a.page) + STAGE.x + STAGE.w - 4;
    const entry = pageX(b.page) + STAGE.x + 4;
    return [
      [a, { x: exit, y: a.y }],
      [{ x: entry, y: b.y }, b],
    ];
  }

  private drawPath(): void {
    const revealed: { x: number; y: number; seg: number }[] = [];
    let revealedCount = 0;
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const open = this.unlocked(i + 1);
      if (open) revealedCount = i + 1;
      for (const [p, q] of this.segments(a, b)) {
        const len = Phaser.Math.Distance.Between(p.x, p.y, q.x, q.y);
        for (let t = 0; t <= len; t += 6) {
          const x = Math.round(p.x + ((q.x - p.x) * t) / len);
          const y = Math.round(p.y + ((q.y - p.y) * t) / len);
          if (Phaser.Math.Distance.Between(x, y, a.x, a.y) < this.nodeRadius(a) || Phaser.Math.Distance.Between(x, y, b.x, b.y) < this.nodeRadius(b)) continue;
          if (open) revealed.push({ x, y, seg: i });
          else this.add.image(x - 1, y - 1, 'ui-dot').setOrigin(0, 0).setTint(C.slate).setAlpha(0.8).setDepth(4);
        }
      }
    }
    // revealed dots: old ones instantly, new ones trace in (first visit this session: just the newest segment)
    if (revealedSeen < 0) revealedSeen = Math.max(1, revealedCount - 1);
    let delay = 0;
    for (const dpt of revealed) {
      const shadow = this.add.image(dpt.x - 1, dpt.y, 'ui-dot').setOrigin(0, 0).setTint(C.ink).setDepth(4);
      const dot = this.add.image(dpt.x - 1, dpt.y - 1, 'ui-dot').setOrigin(0, 0).setTint(C.cream).setDepth(5);
      if (dpt.seg >= revealedSeen) {
        dot.setAlpha(0);
        shadow.setAlpha(0);
        delay += 22;
        this.tweens.add({ targets: [dot, shadow], alpha: 1, delay: 250 + delay, duration: 60 });
        this.tweens.add({ targets: dot, y: dot.y - 2, delay: 250 + delay, duration: 80, yoyo: true });
      }
    }
    revealedSeen = Math.max(revealedSeen, revealedCount);
  }

  private drawNode(n: Node): void {
    if (n.id === SHRINE_ID) return; // the shrine crystal is the node
    const l = n.level!;
    const i = this.nodes.indexOf(n);
    const unlocked = this.unlocked(i);
    const done = save.isCompleted(n.id);
    const frame = !unlocked ? 0 : done ? 2 : 1;
    // soft ground shadow so nodes sit on the diorama rather than float over it
    this.add.ellipse(n.x, n.y + (l.boss ? 10 : 8), l.boss ? 26 : 20, 6, C.ink, 0.5).setDepth(5);
    if (l.boss) {
      this.add.image(n.x, n.y, 'ui-bossnode', frame).setDepth(6);
      if (done) this.add.image(n.x, n.y, 'ui-crown').setDepth(7);
      else this.add.image(n.x, n.y - (unlocked ? 0 : 3), 'ui-skull').setDepth(7).setTint(unlocked ? 0xffffff : C.stone);
    } else {
      this.add.image(n.x, n.y, 'ui-node', frame).setDepth(6);
    }
    if (!unlocked) this.add.image(n.x, n.y + (l.boss ? 3 : 0), 'ui-lock').setDepth(7);
    else if (!done) {
      const g = this.add.image(n.x, n.y, 'light').setTint(C.gold).setAlpha(0.4).setScale(0.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      this.tweens.add({ targets: g, alpha: 0.1, yoyo: true, repeat: -1, duration: 700 });
    }
    const rec = save.data.records[n.id];
    if (rec && this.textures.exists(`ui-rank-${rec.rank}`)) this.add.image(n.x + (l.boss ? 15 : 12), n.y - (l.boss ? 11 : 9), `ui-rank-${rec.rank}`).setDepth(8);
    const label = txt(this, n.x, n.y + (l.boss ? 19 : 16), l.id.toUpperCase(), 8, unlocked ? '#e6e4f0' : '#6d6a8a').setDepth(7);
    this.add.rectangle(n.x, label.y, Math.round(label.width) + 6, 11, C.ink, 0.6).setDepth(6);
  }

  private unlocked(i: number): boolean {
    const n = this.nodes[i];
    if (!n) return false;
    return n.id === SHRINE_ID || isUnlocked(n.id, save);
  }

  private done = (i: number): boolean => save.isCompleted(this.nodes[i]?.id ?? '');

  private pageFocusOf(p: number): number {
    return pageFocus(this.nodes, p, (i) => this.unlocked(i), this.done);
  }

  // ---------------------------------------------------------------- selection

  private heroPos(n: MapNode): { x: number; y: number } {
    if (n.id === SHRINE_ID) return { x: n.x + 26, y: n.y + 14 };
    return { x: n.x, y: n.y - (n.level?.boss ? 18 : 14) };
  }

  private select(i: number, silent = false): void {
    if (i < 0 || !this.unlocked(i)) return;
    const prev = this.idx;
    this.idx = i;
    const n = this.nodes[i];
    this.sel.setTexture(n.level?.boss ? 'ui-sel-big' : 'ui-sel', 0).setPosition(n.x, n.y).setVisible(n.id !== SHRINE_ID);
    this.showPage(n.page, silent);
    if (silent) {
      const p = this.heroPos(n);
      this.hero.setPosition(p.x, p.y);
    } else {
      sfx.select();
      this.walk(prev, i);
    }
    this.showPreview(n);
  }

  private showPage(p: number, instant: boolean): void {
    const cam = this.cameras.main;
    const changed = p !== this.page;
    this.page = p;
    this.refreshTabs();
    this.camSlide?.stop();
    if (instant) {
      cam.setScroll(pageX(p), 0);
      return;
    }
    if (!changed && cam.scrollX === pageX(p)) return;
    this.camSlide = this.tweens.add({ targets: cam, scrollX: pageX(p), duration: 380, ease: 'Cubic.inOut' });
  }

  /** Walk the hero from node `from` to node `to`: through the nodes in between on one page, straight across a page edge, or a cut for longer jumps. */
  private walk(from: number, to: number): void {
    this.heroWalk?.stop();
    const a = this.nodes[from];
    const b = this.nodes[to];
    const pts: { x: number; y: number }[] = [{ x: this.hero.x, y: this.hero.y }];
    const dir = Math.sign(to - from) || 1;
    if (a.page === b.page) {
      for (let j = from + dir; dir > 0 ? j <= to : j >= to; j += dir) pts.push(this.heroPos(this.nodes[j]));
    } else if (Math.abs(to - from) === 1) {
      pts.push(this.heroPos(b));
    } else {
      // jumping worlds: the camera slide carries the eye, the hero just appears there
      this.hero.stop().setFrame(0);
      const p = this.heroPos(b);
      this.hero.setPosition(p.x, p.y);
      return;
    }
    const lens = pts.slice(1).map((p, k) => Phaser.Math.Distance.Between(pts[k].x, pts[k].y, p.x, p.y));
    const total = lens.reduce((x, y) => x + y, 0);
    if (total < 1) return;
    const prog = { t: 0 };
    this.hero.play('ui-hero-walk');
    this.heroWalk = this.tweens.add({
      targets: prog,
      t: total,
      duration: Math.min(480, Math.max(160, total * 2)),
      ease: 'Sine.inOut',
      onUpdate: () => {
        let dd = prog.t;
        let k = 0;
        while (k < lens.length - 1 && dd > lens[k]) dd -= lens[k++];
        const p = pts[k];
        const q = pts[k + 1];
        const f = lens[k] ? Math.min(1, dd / lens[k]) : 1;
        if (q.x !== p.x) this.hero.setFlipX(q.x < p.x);
        this.hero.setPosition(Math.round(p.x + (q.x - p.x) * f), Math.round(p.y + (q.y - p.y) * f));
      },
      onComplete: () => {
        this.hero.stop().setFrame(0);
      },
    });
  }

  private showPreview(n: MapNode): void {
    this.preview?.destroy();
    const parts: Phaser.GameObjects.GameObject[] = [];
    const left = 20;
    const cy = PREVIEW_Y;
    if (n.id === SHRINE_ID) {
      parts.push(this.add.image(left + 8, cy, 'ui-crystal'));
      parts.push(txt(this, left + 22, cy - 13, 'SANCTUARY', 8, '#ffd96a', 0));
      parts.push(txt(this, left + 22, cy + 1, 'Shard Shrine', 14, '#ffeec2', 0));
      parts.push(txt(this, left + 22, cy + 15, 'Spend shards on upgrades', 8, '#8b8ba8', 0));
    } else {
      const l = n.level!;
      const pg = this.pages[n.page];
      const where = pg.kind === 'margin' ? 'THE MARGIN' : WORLD[l.world].name.toUpperCase();
      parts.push(txt(this, left, cy - 13, `${l.id.toUpperCase()}  ·  ${where}`, 8, pg.kind === 'margin' ? MARGIN_INK : hex(WORLD[l.world].accent), 0));
      const name = txt(this, left, cy + 1, l.name, 14, '#ffeec2', 0);
      parts.push(name);
      let nameEnd = left + Math.round(name.width);
      if (l.boss) {
        const bx = nameEnd + 28;
        parts.push(panel(this, bx, cy + 1, 42, 15, 'red'));
        parts.push(this.add.image(bx - 11, cy + 1, 'ui-skull'));
        parts.push(txt(this, bx + 5, cy, 'BOSS', 8, '#ffeec2'));
        nameEnd = bx + 21;
      }
      const rec = save.data.records[l.id];
      if (rec) {
        const line = txt(this, left, cy + 15, `Best time ${fmtTime(rec.timeMs)}  ·  Par ${fmtTime(l.parMs)}`, 8, '#8b8ba8', 0);
        parts.push(line);
        const rx = GAME_W - 168;
        if (nameEnd + 8 < rx - 34) {
          parts.push(txt(this, rx - 14, cy - 1, 'BEST', 8, '#8b8ba8', 1));
          parts.push(this.add.image(rx, cy - 1, `ui-rank-${rec.rank}`).setScale(2));
        } else {
          // long name: the rank rides on the time line instead
          parts.push(this.add.image(left + Math.round(line.width) + 10, cy + 15, `ui-rank-${rec.rank}`));
        }
      } else {
        parts.push(txt(this, left, cy + 15, `Par ${fmtTime(l.parMs)}  ·  not cleared`, 8, '#8b8ba8', 0));
      }
    }
    parts.push(hintRow(this, GAME_W - 20, cy - 8, ['[ENTER]', n.id === SHRINE_ID ? 'Visit' : 'Play', '|', '[ESC]', 'Title'], { align: 1 }));
    parts.push(hintRow(this, GAME_W - 20, cy + 9, ['[LEFT]', '[RIGHT]', 'Level', '|', '[UP]', '[DOWN]', 'World'], { align: 1 }));
    this.preview = this.add.container(0, 0, parts).setDepth(21).setScrollFactor(0);
    this.preview.setAlpha(0);
    this.tweens.add({ targets: this.preview, alpha: 1, duration: 120 });
  }

  private enter(): void {
    if (this.leaving || transitioning()) return;
    this.leaving = true;
    sfx.confirm();
    const n = this.nodes[this.idx];
    this.heroWalk?.complete();
    this.camSlide?.complete();
    // iris targets are screen-space
    const sx = n.x - this.cameras.main.scrollX;
    this.tweens.add({ targets: this.hero, y: this.hero.y - 5, duration: 90, yoyo: true });
    const ok =
      n.id === SHRINE_ID
        ? transitionTo(this, 'Shrine', undefined, { style: 'iris', x: sx, y: n.y - 8 })
        : transitionTo(this, 'Game', { levelId: n.id }, { style: 'iris', x: sx, y: n.y });
    if (!ok) this.leaving = false;
  }

  update(time: number): void {
    if (this.leaving) return;
    this.inp.update(time);
    const move = (dir: Dir) => {
      const j = neighbor(this.nodes, this.idx, dir, (k) => this.unlocked(k), this.done);
      if (j >= 0) this.select(j);
    };
    if (this.inp.justPressed('right')) move('right');
    else if (this.inp.justPressed('left')) move('left');
    else if (this.inp.justPressed('down')) move('down');
    else if (this.inp.justPressed('up')) move('up');
    else if (this.inp.justPressed('confirm') || this.inp.justPressed('attack')) this.enter();
    else if (this.inp.justPressed('pause')) {
      this.leaving = true;
      if (!transitionTo(this, 'Menu')) this.leaving = false;
    }
    this.shardText.setText(String(save.data.shards));
  }
}
