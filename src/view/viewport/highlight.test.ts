import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { SHOW_ALL_LAYERS, layerVisibility } from '../layers/layerDisplay'
import type { Vec3 } from '../../domain/vec3'
import { blockColorCss } from './blockColor'
import { collectBlockInstances, countInstances } from './blockInstances'
import { BlueprintScene } from './blueprintScene'
import { layoutGrid2D } from './layerGrid2D'
import { drawLayer2D, HIGHLIGHT_DIM_ALPHA, LIGHT_THEME_2D, type Canvas2DLike } from './layerRenderer2D'

/** 下の段に石 2 つと軸 1 つ、上の段に軸 1 つ */
function sample() {
  return blueprintFixture({ size: [3, 2, 1] })
    .fill([0, 0, 0], [1, 0, 0], 'minecraft:stone')
    .place([2, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 1, 0], 'create:shaft', { axis: 'y' })
    .toBlueprint()
}

describe('collectBlockInstances の薄くするブロック', () => {
  it('dimmed が true のブロックを別のまとまりに分け、半透明として数える', () => {
    const groups = collectBlockInstances(sample(), (x) => x < 2)
    expect(groups.map((g) => [g.id, g.dimmed, g.positions])).toEqual([
      ['create:shaft', false, [2, 0, 0, 2, 1, 0]],
      ['minecraft:stone', true, [0, 0, 0, 1, 0, 0]],
    ])
    expect(countInstances(groups, (y) => layerVisibility(SHOW_ALL_LAYERS, y))).toEqual({ solid: 2, ghost: 2 })
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

  it('強調したまま段を動かしても、メッシュを作り直さない', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    scene.setHighlight([[2, 0, 0]])
    const group = scene.blockGroup!
    const dim = group.children.find((o) => o.name === 'minecraft:stone (薄く)')!
    expect((dim as THREE.InstancedMesh).material).toMatchObject({ transparent: true })
    scene.setLayerDisplay({ layer: 0, mode: 'only', hidden: new Set() })
    expect(scene.blockGroup).toBe(group)
    expect(scene.renderStats).toMatchObject({ solid: 1, ghost: 2 })
    scene.setLayerDisplay({ layer: 0, mode: 'ghostAbove', hidden: new Set() })
    expect(scene.renderStats).toMatchObject({ solid: 1, ghost: 3 })
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

/** 塗った四角の色と濃さ、書いた文字を記録する偽の canvas */
function draw2D(layer: number, highlighted: readonly Vec3[] | null) {
  const fills: { style: string; alpha: number }[] = []
  const texts: string[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect() {},
    fillRect() {
      fills.push({ style: String(ctx.fillStyle), alpha: ctx.globalAlpha })
    },
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText(text: string) {
      texts.push(text)
    },
    save() {},
    restore() {
      ctx.globalAlpha = 1
    },
  }
  const bp = sample()
  drawLayer2D(ctx as unknown as Canvas2DLike, 400, 400, {
    blueprint: bp,
    layer,
    layout: layoutGrid2D(400, 400, bp.size),
    theme: LIGHT_THEME_2D,
    showGrid: true,
    showLabels: true,
    hovered: null,
    selected: null,
    fontFamily: 'sans-serif',
    highlighted,
  })
  return { fills, texts }
}

describe('drawLayer2D の強調', () => {
  it('今の段の強調しないブロックを薄く塗り、略称を出さない', () => {
    const { fills, texts } = draw2D(0, [[2, 0, 0]])
    const stone = blockColorCss('minecraft:stone')
    const shaft = blockColorCss('create:shaft')
    expect(fills.filter((f) => f.style === stone).map((f) => f.alpha)).toEqual([HIGHLIGHT_DIM_ALPHA, HIGHLIGHT_DIM_ALPHA])
    expect(fills.filter((f) => f.style === shaft).map((f) => f.alpha)).toEqual([1])
    expect(texts).toContain('SH')
    expect(texts).not.toContain('ST')
  })

  it('強調しないときは、すべて普通に塗る', () => {
    const { fills, texts } = draw2D(0, null)
    expect(fills.every((f) => f.alpha === 1)).toBe(true)
    expect(texts).toEqual(expect.arrayContaining(['SH', 'ST']))
  })
})
