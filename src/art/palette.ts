/**
 * Master palette shared by all art modules (32 colours, original curation).
 * Use these names instead of raw hex so the game reads as one coherent style.
 */
export const C = {
  // neutrals
  ink: 0x140c1c, // outline / darkest
  night: 0x241a33,
  slate: 0x3b3554,
  stone: 0x5d5b7a,
  ash: 0x8b8ba8,
  mist: 0xc2c3d6,
  white: 0xf4f1ea,
  // warm
  wine: 0x5a1a34,
  crimson: 0xa8253d,
  red: 0xe0443e,
  orange: 0xf27d2b,
  amber: 0xf7b23b,
  gold: 0xffd96a,
  cream: 0xffeec2,
  // earth
  umber: 0x3e2731,
  bark: 0x6b4433,
  clay: 0x9a6648,
  sand: 0xd2a878,
  // greens
  pine: 0x1d4033,
  moss: 0x2f6b3c,
  leaf: 0x4e9a45,
  lime: 0x9ad152,
  // blues
  navy: 0x1a2550,
  blue: 0x2d5fa8,
  sky: 0x4ea0e0,
  cyan: 0x7fdbff,
  ice: 0xc9f2ff,
  teal: 0x1f8a8a,
  // purples / pinks
  violet: 0x5b2a86,
  purple: 0x8a4fc7,
  magenta: 0xd1478f,
  pink: 0xff8fb8,
} as const;

export type ColorName = keyof typeof C;

/** Per-world environment ramps (dark -> light) + accents. */
export const WORLD = {
  1: { name: 'Verdant Hollow', sky: [0x10223a, 0x1d3a5a, 0x3a6b8a], ground: [C.umber, C.bark, C.clay], top: [C.moss, C.leaf, C.lime], accent: C.gold, fog: 0x9fd6c8 },
  2: { name: 'Iron Spire', sky: [0x1a1330, 0x34264f, 0x6a4a7a], ground: [C.night, C.slate, C.stone], top: [C.stone, C.ash, C.mist], accent: C.amber, fog: 0xb7a6d6 },
  3: { name: 'Crimson Throne', sky: [0x1a0610, 0x3d0d1c, 0x7a1e26], ground: [0x1c0e14, 0x2e141e, 0x4a1e28], top: [C.wine, C.crimson, C.orange], accent: C.orange, fog: 0xff7a4a },
  4: { name: 'The Hollow Deep', sky: [0x070a1c, 0x141a3e, 0x1f4a5e], ground: [0x0c0e1e, 0x161a32, 0x24284a], top: [0x2a3266, 0x2f7a8a, 0xe8d9a0], accent: 0xf0dc96, fog: 0x7fc8d6 },
} as const;
