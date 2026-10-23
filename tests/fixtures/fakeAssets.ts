// テスト用の見た目の資産（blockstates・モデル・PNG）をコードで作る。本物の Mod の資産はリポジトリに入れない。
// MemoryAssetReader に渡す形（パス → 中身）と、それを入れた偽の jar の両方を作れる。

import { fakeJar } from './fakeJar'
import { rgbaPng, solidPng } from './pngFixture'

export const GEAR_COLOR = [40, 160, 220, 255] as const
export const CASING_SIDE_COLOR = [200, 120, 40, 255] as const
export const CASING_END_COLOR = [90, 60, 30, 255] as const

/**
 * 偽の Mod「test」の資産。
 * - test:gear：立方体（親は block/cube_all）。青の単色
 * - test:casing[axis=x|y|z]：柱（親は block/cube_column）。横はしま模様のオレンジ、端は茶色
 * - test:broken：モデルが見つからない（problems に出る）
 * - test:nopng：テクスチャが見つからない（紫と黒で描く）
 */
export function fakeAssetFiles(): Record<string, string | Uint8Array> {
  return {
    'assets/test/blockstates/gear.json': JSON.stringify({ variants: { '': { model: 'test:block/gear' } } }),
    'assets/test/models/block/gear.json': JSON.stringify({ parent: 'block/cube_all', textures: { all: 'test:block/gear' } }),
    'assets/test/textures/block/gear.png': solidPng(16, 16, GEAR_COLOR),

    'assets/test/blockstates/casing.json': JSON.stringify({
      variants: {
        'axis=y': { model: 'test:block/casing' },
        'axis=x': { model: 'test:block/casing', x: 90, y: 90 },
        'axis=z': { model: 'test:block/casing', x: 90 },
      },
    }),
    'assets/test/models/block/casing.json': JSON.stringify({
      parent: 'minecraft:block/cube_column',
      textures: { side: 'test:block/casing_side', end: 'test:block/casing_end' },
    }),
    'assets/test/textures/block/casing_side.png': rgbaPng(16, 16, (_x, y) => (y % 4 === 0 ? [255, 255, 255, 255] : CASING_SIDE_COLOR)),
    'assets/test/textures/block/casing_end.png': solidPng(16, 16, CASING_END_COLOR),

    'assets/test/blockstates/broken.json': JSON.stringify({ variants: { '': { model: 'test:block/nothing_here' } } }),

    'assets/test/blockstates/nopng.json': JSON.stringify({ variants: { '': { model: 'test:block/nopng' } } }),
    'assets/test/models/block/nopng.json': JSON.stringify({ parent: 'block/cube_all', textures: { all: 'test:block/nopng' } }),
  }
}

/** fakeAssetFiles を入れた偽の Mod の jar */
export function fakeAssetJar(): Uint8Array {
  return fakeJar({
    forgeMods: [{ modId: 'test', displayName: 'Test Assets' }],
    lang: { test: { en_us: { 'block.test.gear': 'Gear', 'block.test.casing': 'Casing' } } },
    files: fakeAssetFiles(),
  })
}
