import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import type { LayerDisplay } from '../layers/layerDisplay'
import { nbt } from '../../domain/nbt'
import { appearanceAlias, withAliases } from '../../io/assets/blockEntityAppearance'
import { collectBlockInstances } from './blockInstances'
import { layerCells } from './layerGrid2D'
import { BlueprintScene } from './blueprintScene'
import { cullBit } from './modelGeometry'

/** 赤の立方体を東西に3つ、その北にシャフト、離れた所に見た目の分からないブロックと石 */
function sample() {
  return blueprintFixture({ size: [5, 2, 2] })
    .fill([0, 0, 1], [2, 0, 1], 'test:red_block')
    .place([1, 0, 0], 'test:shaft[axis=y]')
    .place([4, 0, 0], 'test:unknown')
    .place([4, 0, 1], 'minecraft:stone')
    .place([0, 1, 1], 'test:red_block')
    .toBlueprint()
}

function meshes(scene: BlueprintScene): THREE.InstancedMesh[] {
  return scene.blockGroup!.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)
}

describe('collectBlockInstances と見た目', () => {
  it('見た目が分かるブロックは見た目と隠す面ごと、分からないブロックは今までどおり ID ごとにまとめる', () => {
    const set = fakeAppearanceSet()
    const groups = collectBlockInstances(sample(), null, set)
    const summary = groups.map((g) => [g.id, g.appearance !== null, g.cullMask, g.positions])
    expect(summary).toEqual([
      ['minecraft:stone', false, 0, [4, 0, 1]],
      // 西の端は東が隠れ、真ん中は東西が隠れ、東の端は西が隠れる。上の段は隣がないので隠さない（上下は隠さない）
      ['test:red_block', true, 0, [0, 1, 1]],
      ['test:red_block', true, cullBit('west'), [2, 0, 1]],
      ['test:red_block', true, cullBit('east'), [0, 0, 1]],
      ['test:red_block', true, cullBit('west') | cullBit('east'), [1, 0, 1]],
      ['test:shaft', true, 0, [1, 0, 0]],
      ['test:unknown', false, 0, [4, 0, 0]],
    ])
    expect(groups.find((g) => g.id === 'test:shaft')!.appearance).toBe(set.appearances['test:shaft[axis=y]'])
  })

  it('見た目を渡さなければ、今までどおり ID ごとの色付きの箱', () => {
    const groups = collectBlockInstances(sample())
    expect(groups.map((g) => [g.id, g.appearance, g.cullMask])).toEqual([
      ['minecraft:stone', null, 0],
      ['test:red_block', null, 0],
      ['test:shaft', null, 0],
      ['test:unknown', null, 0],
    ])
  })

  it('薄くするブロックは、普通のブロックの面を隠さない', () => {
    const groups = collectBlockInstances(sample(), (x, y) => x === 1 && y === 0, fakeAppearanceSet())
    const groupAt = (x: number, y: number, z: number) =>
      groups.find((g) => g.positions.some((_, i) => i % 3 === 0 && g.positions[i] === x && g.positions[i + 1] === y && g.positions[i + 2] === z))!
    const middle = groupAt(1, 0, 1)
    expect(groupAt(0, 0, 1).cullMask).toBe(0)
    // 薄いブロック自身は、隣の普通のブロックで隠れる面を省く
    expect(middle).toMatchObject({ dimmed: true, cullMask: cullBit('west') | cullBit('east') })
  })

  it('中身のない見た目のブロックは描かない', () => {
    const set = fakeAppearanceSet()
    const empty = { ...set, appearances: { ...set.appearances, 'test:red_block': { parts: [] } } }
    const groups = collectBlockInstances(sample(), null, empty)
    expect(groups.some((g) => g.id === 'test:red_block')).toBe(false)
  })
})

describe('BlueprintScene.setAppearances', () => {
  it('見た目のあるブロックはテクスチャの材質とモデルの形で、ないブロックは色付きの箱で描く', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    const boxGeometry = meshes(scene)[0]!.geometry
    scene.setAppearances(fakeAppearanceSet())
    const solid = meshes(scene).filter((m) => !m.name.endsWith('(半透明)'))
    const textured = solid.filter((m) => (m.material as THREE.MeshLambertMaterial).map !== null)
    expect(textured.map((m) => m.name).sort()).toEqual([
      'test:red_block',
      'test:red_block (隠す面 16)',
      'test:red_block (隠す面 32)',
      'test:red_block (隠す面 48)',
      'test:shaft[axis=y]',
    ])
    const material = textured[0]!.material as THREE.MeshLambertMaterial
    expect(material.map!.magFilter).toBe(THREE.NearestFilter)
    expect(material.alphaTest).toBeGreaterThan(0)
    expect(material.vertexColors).toBe(true)
    // 赤の立方体の東西を隠したものは4面だけ
    const both = textured.find((m) => m.name === 'test:red_block (隠す面 48)')!
    expect(both.geometry.getIndex()!.count).toBe(4 * 6)
    // 見た目の分からないブロックと石は、今までどおりの立方体
    const boxes = solid.filter((m) => (m.material as THREE.MeshLambertMaterial).map === null)
    expect(boxes.map((m) => m.name)).toEqual(['minecraft:stone', 'test:unknown'])
    expect(boxes.every((m) => m.geometry.type === boxGeometry.type)).toBe(true)
    expect(scene.renderStats.solid).toBe(7)
  })

  it('段の表示方法と段ごとの非表示は、見た目があっても今までどおり効く', () => {
    const scene = new BlueprintScene()
    scene.setAppearances(fakeAppearanceSet())
    scene.setBlueprint(sample())
    const d = (layer: number, mode: LayerDisplay['mode'], hidden: number[] = []): LayerDisplay => ({ layer, mode, hidden: new Set(hidden) })
    scene.setLayerDisplay(d(0, 'ghostAbove'))
    expect(scene.renderStats).toMatchObject({ solid: 6, ghost: 1 })
    scene.setLayerDisplay(d(0, 'all', [0]))
    expect(scene.renderStats).toMatchObject({ solid: 1, ghost: 0 })
    // 選択とマウスの下はマスで決まる（シャフトのマスでも当たる）
    const target = scene.pick({ origin: [1.5, 5, 0.5], direction: [0, -1, 0] })
    expect(target?.pos).toEqual([1, 0, 0])
  })

  it('null に戻すと、すべて色付きの箱で描き直す', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    scene.setAppearances(fakeAppearanceSet())
    scene.setAppearances(null)
    expect(meshes(scene).every((m) => (m.material as THREE.MeshLambertMaterial).map === null)).toBe(true)
    expect(meshes(scene).filter((m) => !m.name.endsWith('(半透明)')).map((m) => m.name)).toEqual([
      'minecraft:stone',
      'test:red_block',
      'test:shaft',
      'test:unknown',
    ])
    scene.dispose()
  })
})

describe('生データで見た目が変わるブロック', () => {
  const machineNbt = nbt.compound({ machineID: nbt.string('createastral:distillery') })
  const bp = () =>
    blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'custommachinery:custom_machine_block[facing=east]', machineNbt)
      .place([1, 0, 0], 'custommachinery:custom_machine_block[facing=east]')
      .toBlueprint()
  const lookup = { machineAppearance: (id: string) => (id === 'createastral:distillery' ? 'test:red_block' : null) }

  it('3D は、マスの生データから決めた鍵で見た目を引く。生データのない機械は箱', () => {
    const blueprint = bp()
    const alias = appearanceAlias(blueprint.get([0, 0, 0])!, blueprint.blockEntityAt([0, 0, 0]), lookup)!
    const set = withAliases(fakeAppearanceSet(), [alias])
    const groups = collectBlockInstances(blueprint, null, set)
    const withLook = groups.filter((g) => g.appearance !== null)
    expect(withLook.map((g) => g.positions)).toEqual([[0, 0, 0]])
    expect(withLook[0]!.appearance).toBe(set.appearances[alias.key])
    expect(groups.find((g) => g.appearance === null)!.positions).toEqual([1, 0, 0])
  })

  it('2D のマスにも見た目の鍵を持たせる', () => {
    const cells = layerCells(bp(), 0)
    expect(cells.map((c) => c.appearanceKey)).toEqual([
      'custommachinery:custom_machine_block[facing=east]|machine=createastral:distillery',
      'custommachinery:custom_machine_block[facing=east]',
    ])
  })
})
