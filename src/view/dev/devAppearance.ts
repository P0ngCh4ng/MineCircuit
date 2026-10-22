// 開発中だけ使う：偽の見た目（tests/fixtures/fakeAppearance.ts）をブラウザで確かめる手段（#84）。
// main.ts から import.meta.env.DEV のときだけ読み込むので、本番のビルドには入らない。
// ブラウザの開発者ツールで次のように呼ぶ。
//   __mineCircuitDev.showFakeAppearances()      偽の見た目と、それを並べた設計図を開く
//   __mineCircuitDev.showFakeAppearances(22)    約 1 万ブロックの設計図で重さを確かめる（22×20×22）
//   __mineCircuitDev.setAppearanceMode('color') 色付きの箱に戻す

import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import type { Blueprint } from '../../domain/blueprint'
import { useDocumentSession } from '../document/documentSession'
import { useAppearanceStore, type AppearanceMode } from '../stores/appearanceStore'

/** 偽の見た目にあるブロックを並べる順 */
const SAMPLES = [
  'test:red_block',
  'test:log[axis=y]',
  'test:log[axis=x]',
  'test:shaft[axis=y]',
  'test:shaft[axis=z]',
  'test:plate',
  'test:grass',
  'test:fence',
  'test:unknown',
]

/** 見本の設計図。1列目に各ブロックを1つずつ、奥に隠す面を確かめる赤の壁と、草の床 */
function sampleBlueprint(): Blueprint {
  const f = blueprintFixture({ name: 'fake-appearance.nbt', size: [SAMPLES.length * 2, 3, 6] })
  SAMPLES.forEach((s, i) => f.place([i * 2, 0, 0], s))
  f.fill([0, 0, 3], [SAMPLES.length * 2 - 1, 0, 5], 'test:grass')
  f.fill([0, 1, 4], [5, 2, 4], 'test:red_block')
  f.fill([7, 1, 4], [11, 1, 4], 'test:log[axis=x]')
  return f.toBlueprint()
}

/** 重さを確かめる設計図。n×20×n に見本のブロックを順に敷き詰める */
function largeBlueprint(n: number): Blueprint {
  const f = blueprintFixture({ name: `fake-appearance-${n}.nbt`, size: [n, 20, n] })
  let i = 0
  for (let y = 0; y < 20; y++) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) f.place([x, y, z], SAMPLES[i++ % SAMPLES.length]!)
  return f.toBlueprint()
}

export function installDevAppearance(): void {
  const api = {
    showFakeAppearances(size?: number): void {
      useAppearanceStore().setAppearanceSet(fakeAppearanceSet())
      useAppearanceStore().setMode('texture')
      const bp = size ? largeBlueprint(size) : sampleBlueprint()
      useDocumentSession().setBlueprint(bp, bp.name)
    },
    setAppearanceMode(mode: AppearanceMode): void {
      useAppearanceStore().setMode(mode)
    },
  }
  Object.assign(window, { __mineCircuitDev: api })
}
