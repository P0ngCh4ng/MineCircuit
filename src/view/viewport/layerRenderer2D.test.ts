import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { Vec3 } from '../../domain/vec3'
import { blockColorCss } from './blockColor'
import { layoutGrid2D } from './layerGrid2D'
import { drawLayer2D, ISSUE_MARK_CSS, LIGHT_THEME_2D, NETWORK_MARK_CSS, type Canvas2DLike } from './layerRenderer2D'

interface FillCall {
  readonly x: number
  readonly y: number
  readonly style: string
  readonly alpha: number
}

/** 塗った四角と書いた文字を記録する偽の canvas */
function fakeContext() {
  const fills: FillCall[] = []
  const texts: string[] = []
  const strokes: { x: number; y: number; style: string }[] = []
  const stack: number[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect() {},
    fillRect(x: number, y: number) {
      fills.push({ x, y, style: String(ctx.fillStyle), alpha: ctx.globalAlpha })
    },
    strokeRect(x: number, y: number) {
      strokes.push({ x, y, style: String(ctx.strokeStyle) })
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText(text: string) {
      texts.push(text)
    },
    save() {
      stack.push(ctx.globalAlpha)
    },
    restore() {
      ctx.globalAlpha = stack.pop() ?? 1
    },
  }
  return { ctx: ctx as unknown as Canvas2DLike, fills, texts, strokes }
}

function sample() {
  return blueprintFixture({ size: [3, 2, 2] })
    .place([0, 0, 0], 'minecraft:stone')
    .place([1, 0, 1], 'create:shaft', { axis: 'x' })
    .place([1, 1, 1], 'create:mechanical_press')
    .toBlueprint()
}

function draw(layer: number, size: number, opts: { hovered?: Vec3 | null; selected?: Vec3 | null; showLabels?: boolean } = {}) {
  const bp = sample()
  const fake = fakeContext()
  const layout = layoutGrid2D(size, size, bp.size)
  drawLayer2D(fake.ctx, size, size, {
    blueprint: bp,
    layer,
    layout,
    theme: LIGHT_THEME_2D,
    showGrid: true,
    showLabels: opts.showLabels ?? true,
    hovered: opts.hovered ?? null,
    selected: opts.selected ?? null,
    fontFamily: 'sans-serif',
  })
  return { ...fake, layout }
}

describe('drawLayer2D', () => {
  it('今の段のブロックをブロックの色で塗り、1つ下の段を薄く塗る', () => {
    const { fills } = draw(1, 400)
    const solid = fills.filter((f) => f.alpha === 1)
    const ghost = fills.filter((f) => f.alpha < 1)
    expect(solid.map((f) => f.style)).toEqual([blockColorCss('create:mechanical_press')])
    expect(ghost.map((f) => f.style).sort()).toEqual([blockColorCss('minecraft:stone'), blockColorCss('create:shaft')].sort())
    expect(ghost.every((f) => f.alpha === LIGHT_THEME_2D.ghostAlpha)).toBe(true)
  })

  it('一番下の段では下の段を描かない', () => {
    const { fills } = draw(0, 400)
    expect(fills.every((f) => f.alpha === 1)).toBe(true)
    expect(fills).toHaveLength(2)
  })

  it('マスが大きいときだけ略称を出す', () => {
    expect(draw(1, 400).texts).toContain('MP')
    expect(draw(1, 400, { showLabels: false }).texts).not.toContain('MP')
    // 小さいマス（3 × 2 を 90px）では出さない
    expect(draw(1, 90).texts).not.toContain('MP')
  })

  it('座標の目盛りを出す', () => {
    const { texts } = draw(0, 400)
    expect(texts).toEqual(expect.arrayContaining(['0', '1', '2', 'x →', 'z']))
  })

  it('選択中とマウスの下の枠は、今の段にあるときだけ描く', () => {
    const on = draw(1, 400, { selected: [1, 1, 1], hovered: [0, 1, 0] })
    expect(on.strokes.map((s) => s.style)).toEqual(expect.arrayContaining([LIGHT_THEME_2D.selection, LIGHT_THEME_2D.hover]))
    const off = draw(0, 400, { selected: [1, 1, 1], hovered: [0, 1, 0] })
    expect(off.strokes.map((s) => s.style)).not.toContain(LIGHT_THEME_2D.selection)
    expect(off.strokes.map((s) => s.style)).not.toContain(LIGHT_THEME_2D.hover)
  })

  it('計算結果の印（ネットワークと問題）を今の段のマスだけに描く', () => {
    const bp = sample()
    const fake = fakeContext()
    const layout = layoutGrid2D(300, 300, bp.size)
    drawLayer2D(fake.ctx, 300, 300, {
      blueprint: bp,
      layer: 0,
      layout,
      theme: LIGHT_THEME_2D,
      showGrid: false,
      showLabels: false,
      hovered: null,
      selected: null,
      fontFamily: 'sans-serif',
      calcMarks: {
        network: [
          [1, 0, 1],
          [1, 1, 1],
        ],
        issues: [[0, 0, 0]],
      },
    })
    const cs = layout.cellSize
    const network = fake.fills.filter((f) => f.style === NETWORK_MARK_CSS)
    expect(network).toEqual([{ x: layout.originX + cs, y: layout.originY + cs, style: NETWORK_MARK_CSS, alpha: 0.3 }])
    const issues = fake.fills.filter((f) => f.style === ISSUE_MARK_CSS)
    expect(issues).toHaveLength(1)
    expect(fake.strokes.filter((s) => s.style === ISSUE_MARK_CSS)).toHaveLength(1)
  })
})
