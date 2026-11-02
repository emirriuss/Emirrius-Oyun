import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { InputManager } from '../core/InputManager';
import { txt, type PxText } from '../ui/text';
import { panel, panelTexture, hintRow, gradientTexture, starfield, sparkBurst } from '../ui/Panel';
import { transitionTo } from '../ui/transition';
import { UPGRADE_ICON } from '../art/ui';
import { C } from '../art/palette';
import { save } from '../systems/SaveSystem';
import { UPGRADES, nextCost, buyUpgrade, type UpgradeDef } from '../systems/Progression';
import { sfx } from '../systems/sfx';

const CARD_W = 84;
const CARD_H = 92;
const CARD_Y = 136;
const CARD_GAP = 6;
/** cards shown at once; the rest scroll in from the sides */
const VISIBLE = 5;

interface Card {
  def: UpgradeDef;
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Image[];
  cost: PxText;
  costIcon: Phaser.GameObjects.Image;
  zone: Phaser.GameObjects.Zone;
  /** current resting x (moves as the row scrolls) */
  x: number;
}

export class ShrineScene extends Phaser.Scene {
  private inp!: InputManager;
  private cards: Card[] = [];
  private sel = 0; // 0..n-1 cards, n = Leave
  private scroll = 0; // index of the leftmost visible card
  private arrowL!: Phaser.GameObjects.Image;
  private arrowR!: Phaser.GameObjects.Image;
  private desc!: PxText;
  private descTitle!: PxText;
  private shards!: PxText;
  private leaveBg!: Phaser.GameObjects.Image;
  private leaveText!: PxText;
  private leaving = false;
  constructor() {
    super('Shrine');
  }

  create(): void {
    this.cards = [];
    this.sel = 0;
    this.scroll = 0;
    this.leaving = false;
    this.cameras.main.setBackgroundColor(0x12101f);
    this.inp = new InputManager(this, save.data.settings.keys);

    // backdrop
    this.add.image(0, 0, gradientTexture(this, 'ui-bg-shrine', GAME_W, GAME_H, [0x0b0814, 0x1a1330, 0x34264f, 0x1a1330], 12)).setOrigin(0, 0).setDepth(-100);
    starfield(this, GAME_W, GAME_H, 50, -90, C.pink);
    this.add.particles(0, 0, 'ui-dot', {
      x: { min: 0, max: GAME_W },
      y: GAME_H + 4,
      speedY: { min: -16, max: -6 },
      lifespan: 14000,
      alpha: { start: 0.6, end: 0 },
      tint: [C.gold, C.amber, C.purple],
      frequency: 300,
    }).setDepth(-80);

    // header
    txt(this, 12, 14, 'SHARD SHRINE', 14, '#ffd96a', 0);
    txt(this, 12, 30, 'Offer shards to grow stronger', 8, '#8b8ba8', 0);
    const sp = panel(this, GAME_W - 44, 16, 72, 19, 'gold');
    this.add.image(sp.x - 24, 16, 'ui-shard');
    this.shards = txt(this, sp.x - 14, 15, '', 10, '#ffd96a', 0);

    // altar
    const ax = GAME_W / 2;
    const glow = this.add.image(ax, 38, 'light').setTint(C.gold).setAlpha(0.45).setScale(1.6).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: glow, alpha: 0.25, scale: 1.3, yoyo: true, repeat: -1, duration: 1300, ease: 'Sine.inOut' });
    this.add.image(ax, 70, 'ui-pedestal').setScale(2);
    const crystal = this.add.image(ax, 36, 'ui-crystal').setScale(2);
    this.tweens.add({ targets: crystal, y: 31, yoyo: true, repeat: -1, duration: 1300, ease: 'Sine.inOut', onUpdate: () => (crystal.y = Math.round(crystal.y)) });

    // cards
    const shop = UPGRADES.filter((u) => !u.bossReward);
    shop.forEach((u, i) => this.cards.push(this.makeCard(u, i)));
    this.arrowL = this.makeArrow(7, 1, -1);
    this.arrowR = this.makeArrow(GAME_W - 7, 0, 1);

    // description strip
    panel(this, GAME_W / 2, 200, CARD_W * 5 + 24 + 10, 26, 'dark');
    this.descTitle = txt(this, 24, 200, '', 9, '#ffd96a', 0);
    this.desc = txt(this, 0, 200, '', 9, '#c2c3d6', 0);

    // abilities (boss rewards)
    txt(this, 14, 228, 'ABILITIES', 8, '#8b8ba8', 0);
    let ax2 = 14;
    UPGRADES.filter((u) => u.bossReward).forEach((u) => {
      const owned = (save.data.upgrades[u.id] ?? 0) > 0;
      const box = this.add.image(ax2, 246, panelTexture(this, 20, 20, owned ? 'card' : 'cardOff')).setOrigin(0, 0.5);
      void box;
      if (owned) this.add.image(ax2 + 10, 246, 'ui-upg', UPGRADE_ICON[u.id]);
      else this.add.image(ax2 + 10, 246, 'ui-lock').setAlpha(0.6);
      const t = txt(this, ax2 + 24, 246, owned ? u.name : '???', 8, owned ? '#7fdbff' : '#5d5b7a', 0);
      ax2 += 24 + Math.round(t.width) + 12;
    });

    // leave button
    this.leaveBg = this.add.image(GAME_W - 58, 246, panelTexture(this, 92, 20, 'dark'));
    this.leaveText = txt(this, GAME_W - 66, 245, 'Leave', 9, '#c2c3d6');
    hintRow(this, GAME_W - 30, 246, ['[ESC]'], { align: 0.5 });
    const lz = this.add.zone(this.leaveBg.x, this.leaveBg.y, 92, 20).setInteractive({ useHandCursor: true });
    lz.on('pointerover', () => this.setSel(this.cards.length));
    lz.on('pointerdown', (p: Phaser.Input.Pointer) => p.button === 0 && this.leave());

    this.refresh(true);
    this.inp.update(this.time.now);
  }

  /** x of the card in visible slot k (0..VISIBLE-1); slots outside the window land off-screen */
  private slotX(k: number): number {
    const shown = Math.min(VISIBLE, this.cards.length);
    return Math.round(GAME_W / 2 + (k - (shown - 1) / 2) * (CARD_W + CARD_GAP));
  }

  /** edge arrow hinting at (and scrolling to) cards off-screen */
  private makeArrow(x: number, frame: number, dir: 1 | -1): Phaser.GameObjects.Image {
    const a = this.add.image(x, CARD_Y, 'ui-arrow', frame).setTint(C.gold).setVisible(false).setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: a, x: x + dir * 2, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.inOut', onUpdate: () => (a.x = Math.round(a.x)) });
    a.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0 || this.leaving) return;
      const n = this.cards.length;
      const target = dir > 0 ? Math.min(n - 1, this.scroll + VISIBLE) : Math.max(0, this.scroll - 1);
      this.setSel(target);
    });
    return a;
  }

  private makeCard(def: UpgradeDef, i: number): Card {
    const x = this.slotX(i);
    const bg = this.add.image(0, 0, panelTexture(this, CARD_W, CARD_H, 'card'));
    const well = this.add.image(0, -24, panelTexture(this, 34, 34, 'slot'));
    const icon = this.add.image(0, -24, 'ui-upg', UPGRADE_ICON[def.id]).setScale(2);
    const name = txt(this, 0, 6, def.name, 9, '#ffeec2');
    const pips = def.costs.map((_c, k) => this.add.image(Math.round((k - (def.costs.length - 1) / 2) * 8), 19, 'ui-pip', 0));
    const costIcon = this.add.image(-12, 34, 'ui-shard');
    const cost = txt(this, -4, 33, '', 9, '#ffd96a', 0);
    const root = this.add.container(x, CARD_Y, [bg, well, icon, name, ...pips, costIcon, cost]);
    const z = this.add.zone(x, CARD_Y, CARD_W, CARD_H).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => this.setSel(i));
    z.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return;
      this.setSel(i);
      this.buy(i);
    });
    return { def, root, bg, icon, pips, cost, costIcon, zone: z, x };
  }

  private setSel(i: number): void {
    if (this.sel === i || this.leaving) return;
    this.sel = i;
    sfx.select();
    this.refresh();
  }

  /** scrolls the window just enough to keep card `i` in view */
  private ensureVisible(i: number): void {
    if (i < this.scroll) this.scroll = i;
    else if (i >= this.scroll + VISIBLE) this.scroll = i - VISIBLE + 1;
  }

  private refresh(instant = false): void {
    const n = this.cards.length;
    if (this.sel < n) this.ensureVisible(this.sel);
    this.arrowL.setVisible(this.scroll > 0);
    this.arrowR.setVisible(this.scroll + VISIBLE < n);
    this.cards.forEach((c, i) => {
      const lvl = save.data.upgrades[c.def.id] ?? 0;
      const cost = nextCost(save.data, c.def.id);
      const maxed = cost === null;
      const afford = !maxed && cost <= save.data.shards;
      const sel = i === this.sel;
      c.bg.setTexture(panelTexture(this, CARD_W, CARD_H, sel ? 'cardSel' : maxed ? 'cardOff' : 'card'));
      c.pips.forEach((p, k) => p.setFrame(k < lvl ? 1 : 0));
      c.icon.setAlpha(maxed || afford ? 1 : 0.45);
      if (maxed) {
        c.cost.setText('MAX').setColor('#ffd96a').setX(0).setOrigin(0.5, 0.5);
        c.costIcon.setVisible(false);
      } else {
        c.cost.setText(String(cost)).setColor(afford ? '#ffd96a' : '#e0443e').setOrigin(0, 0.5);
        const w = 10 + Math.round(c.cost.width);
        c.costIcon.setVisible(true).setX(Math.round(-w / 2) + 3);
        c.cost.setX(Math.round(-w / 2) + 10);
      }
      const ty = CARD_Y - (sel ? 3 : 0);
      const k = i - this.scroll;
      const shown = k >= 0 && k < VISIBLE;
      c.x = this.slotX(k);
      c.zone.setX(c.x);
      if (c.zone.input) c.zone.input.enabled = shown;
      this.tweens.killTweensOf(c.root);
      if (instant) c.root.setPosition(c.x, ty).setAlpha(shown ? 1 : 0);
      else
        this.tweens.add({
          targets: c.root,
          x: c.x,
          y: ty,
          alpha: shown ? 1 : 0,
          duration: c.root.x === c.x ? 80 : 140,
          ease: 'Quad.out',
          onUpdate: () => c.root.setPosition(Math.round(c.root.x), Math.round(c.root.y)),
        });
    });
    const onLeave = this.sel >= this.cards.length;
    this.leaveBg.setTexture(panelTexture(this, 92, 20, onLeave ? 'gold' : 'dark'));
    this.leaveText.setColor(onLeave ? '#ffd96a' : '#c2c3d6');
    if (onLeave) {
      this.descTitle.setText('Leave');
      this.desc.setText('Return to the world map');
    } else {
      const c = this.cards[this.sel];
      const cost = nextCost(save.data, c.def.id);
      this.descTitle.setText(c.def.name);
      const extra = cost === null ? '  (mastered)' : cost > save.data.shards ? `  (need ${cost - save.data.shards} more)` : '';
      const lvl = save.data.upgrades[c.def.id] ?? 0;
      this.desc.setText((c.def.levelDescs?.[lvl] ?? c.def.desc) + extra);
    }
    this.desc.setX(24 + Math.round(this.descTitle.width) + 10);
    this.shards.setText(String(save.data.shards));
  }

  private buy(i: number): void {
    // a card click during the leave transition must not spend shards
    if (this.leaving) return;
    const c = this.cards[i];
    const cost = nextCost(save.data, c.def.id);
    if (cost !== null && buyUpgrade(save.data, c.def.id)) {
      save.save();
      sfx.heal();
      const lvl = save.data.upgrades[c.def.id] ?? 0;
      this.refresh();
      // flash + burst + pip pop + floating cost
      c.bg.setTintFill(0xffffff);
      this.time.delayedCall(70, () => c.bg.clearTint());
      sparkBurst(this, c.x, c.root.y - 24, C.gold, 16, 30);
      const pip = c.pips[lvl - 1];
      if (pip) this.tweens.add({ targets: pip, scale: 2, yoyo: true, duration: 120 });
      this.tweens.add({ targets: c.icon, scale: 3, yoyo: true, duration: 100 });
      const f = txt(this, c.x, c.root.y - 40, `-${cost}`, 10, '#ffd96a').setDepth(30);
      this.tweens.add({ targets: f, y: f.y - 18, alpha: 0, duration: 700, onComplete: () => f.destroy() });
      this.tweens.add({ targets: this.shards, scale: 1.4, yoyo: true, duration: 80 });
      this.cameras.main.flash(120, 255, 217, 106);
    } else {
      sfx.select();
      this.tweens.add({ targets: c.root, x: c.x + 3, yoyo: true, repeat: 2, duration: 35, onComplete: () => c.root.setX(c.x) });
    }
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    sfx.confirm();
    if (!transitionTo(this, 'WorldMap', { focus: 'shrine' })) this.leaving = false;
  }

  update(time: number): void {
    if (this.leaving) return;
    this.inp.update(time);
    const n = this.cards.length;
    if (this.inp.justPressed('pause')) return this.leave();
    if (this.inp.justPressed('right')) this.setSel(this.sel >= n ? 0 : (this.sel + 1) % n);
    else if (this.inp.justPressed('left')) this.setSel(this.sel >= n ? n - 1 : (this.sel - 1 + n) % n);
    else if (this.inp.justPressed('down')) this.setSel(n);
    else if (this.inp.justPressed('up')) this.setSel(this.sel >= n ? Math.min(n - 1, this.scroll + Math.floor(VISIBLE / 2)) : this.sel);
    else if (this.inp.justPressed('confirm') || this.inp.justPressed('attack')) {
      if (this.sel >= n) this.leave();
      else this.buy(this.sel);
    }
  }
}
