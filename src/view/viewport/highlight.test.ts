import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { SHOW_ALL_LAYERS, layerVisibility } from '../layers/layerDisplay'
import { collectBlockInstances } from './blockInstances'
import { BlueprintScene } from './blueprintScene'

/** 下の段に石 2 つと軸 1 つ、上の段に軸 1 つ */
function sample() {
  return blueprintFixture({ size: [3, 2, 1] })
    .fill([0, 0, 0], [1, 0, 0], 'minecraft:stone')
    .place([2, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 1, 0], 'create:shaft', { axis: 'y' })
    .toBlueprint()
}

describe('collectBlockInstances の薄くするブロック', () => {
  it('dimmed が true のブロックを半透明にする', () => {
    const groups = collectBlockInstances(sample(), (y) => layerVisibility(SHOW_ALL_LAYERS, y), (x) => x < 2)
    const byId = new Map(groups.map((g) => [g.id, g]))
    expect(byId.get('minecraft:stone')).toMatchObject({ solid: [], ghost: [0, 0, 0, 1, 0, 0] })
    expect(byId.get('create:shaft')).toMatchObject({ solid: [2, 0, 0, 2, 1, 0], ghost: [] })
  })
})

describe('BlueprintScene.setHighlight', () => {
  it('強調する位置のほかを半透明にし、null で元に戻す', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    scene.setHighlight([
      [2, 0, 0],
      [2, 1, 0],
    ])
    expect(scene.renderStats).toMatchObject({ solid: 2, ghost: 2 })
    expect(scene.highlighted).toHaveLength(2)
    scene.setHighlight(null)
    expect(scene.renderStats).toMatchObject({ solid: 4, ghost: 0 })
    expect(scene.highlighted).toBeNull()
  })

  it('空の配列ならすべて半透明。範囲外の位置は無視する', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    scene.setHighlight([[9, 9, 9]])
    expect(scene.renderStats).toMatchObject({ solid: 0, ghost: 4 })
  })

  it('隠した段のブロックは強調しても描かない', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    scene.setLayerDisplay({ layer: 0, mode: 'hideAbove', hidden: new Set() })
    scene.setHighlight([
      [2, 0, 0],
      [2, 1, 0],
    ])
    expect(scene.renderStats).toMatchObject({ solid: 1, ghost: 2 })
  })

  it('設計図を入れ替えても強調は残り、新しい大きさで位置を合わせ直す', () => {
    const scene = new BlueprintScene()
    scene.setHighlight([[0, 0, 0]])
    scene.setBlueprint(sample())
    expect(scene.renderStats).toMatchObject({ solid: 1, ghost: 3 })
  })
})
