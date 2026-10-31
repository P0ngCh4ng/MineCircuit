import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { Vec3 } from '../../domain/vec3'
import { blockColorCss } from './blockColor'
import { layoutGrid2D } from './layerGrid2D'
import type { BlockState } from '../../domain/blockState'
import {
  drawGrowMargin2D,
  drawLayer2D,
  drawSelectionBox2D,
  ISSUE_MARK_CSS,
  LIGHT_THEME_2D,
  NETWORK_MARK_CSS,
  SELECTION_DASH_2D,
  TEXTURE_BACKDROP_ALPHA,
  type Canvas2DLike,
  drawFlow2D,
  FLOW_COLORS,
  type SelectionCanvas2D,
} from './layerRenderer2D'
import { boxFromCorners, singleCellBox } from '../../domain/box'
import type { CellPainter2D } from './textureCellPainter2D'

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
    strokeText() {},
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

  it('painter があれば、描けたブロックはテクスチャで描き、下にブロックの色を薄く敷く', () => {
    const bp = sample()
    const fake = fakeContext()
    const layout = layoutGrid2D(400, 400, bp.size)
    const painted: { id: string; alpha: number }[] = []
    // シャフトだけ描ける painter
    const painter: CellPainter2D = {
      paint(ctx, state: BlockState) {
        painted.push({ id: state.id.toString(), alpha: (ctx as unknown as { globalAlpha: number }).globalAlpha })
        return state.id.toString() === 'create:shaft'
      },
    }
    drawLayer2D(fake.ctx, 400, 400, {
      blueprint: bp,
      layer: 0,
      layout,
      theme: LIGHT_THEME_2D,
      showGrid: false,
      showLabels: true,
      hovered: null,
      selected: null,
      fontFamily: 'sans-serif',
      cellPainter: painter,
    })
    expect(painted.map((p) => p.id).sort()).toEqual(['create:shaft', 'minecraft:stone'])
    expect(painted.every((p) => p.alpha === 1)).toBe(true)
    const shaft = fake.fills.filter((f) => f.style === blockColorCss('create:shaft'))
    expect(shaft.map((f) => f.alpha)).toEqual([TEXTURE_BACKDROP_ALPHA])
    // 描けなかった石は、敷いた色の上に色で塗る
    const stone = fake.fills.filter((f) => f.style === blockColorCss('minecraft:stone'))
    expect(stone.map((f) => f.alpha)).toEqual([TEXTURE_BACKDROP_ALPHA, 1])
    expect(fake.texts).toEqual(expect.arrayContaining(['SH', 'ST']))
  })
})

describe('drawSelectionBox2D', () => {
  /** 引いた長方形と、そのときの点線の設定を記録する偽の canvas */
  function selectionContext() {
    const rects: { x: number; y: number; w: number; h: number; style: string; dash: number[] }[] = []
    let dash: number[] = []
    const ctx = {
      strokeStyle: '',
      lineWidth: 1,
      save() {},
      restore() {},
      setLineDash(d: number[]) {
        dash = [...d]
      },
      strokeRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, style: String(ctx.strokeStyle), dash })
      },
    }
    return { ctx: ctx as unknown as SelectionCanvas2D, rects, dash: () => dash }
  }
  const layout = { originX: 10, originY: 20, cellSize: 8 }
  const box = boxFromCorners([1, 1, 2], [3, 2, 4])

  it('範囲の段では、範囲の長方形を実線で描く', () => {
    const fake = selectionContext()
    expect(drawSelectionBox2D(fake.ctx, layout, 1, box, LIGHT_THEME_2D)).toBe('solid')
    const outer = fake.rects.find((r) => r.style === LIGHT_THEME_2D.selection)!
    expect(outer).toMatchObject({ x: 10 + 8, y: 20 + 16, w: 24, h: 24, dash: [] })
    expect(fake.rects.some((r) => r.style === LIGHT_THEME_2D.markInner)).toBe(true)
    expect(drawSelectionBox2D(selectionContext().ctx, layout, 2, box, LIGHT_THEME_2D)).toBe('solid')
  })

  it('範囲の外の段では点線で描き、描いたあと点線を戻す', () => {
    for (const layer of [0, 3]) {
      const fake = selectionContext()
      expect(drawSelectionBox2D(fake.ctx, layout, layer, box, LIGHT_THEME_2D)).toBe('dashed')
      expect(fake.rects.every((r) => r.dash.join() === SELECTION_DASH_2D.join())).toBe(true)
      expect(fake.dash()).toEqual([])
    }
  })

  it('1マスの範囲と、選んでいないときは描かない（1マスは今までの選択の枠のまま）', () => {
    const fake = selectionContext()
    expect(drawSelectionBox2D(fake.ctx, layout, 0, singleCellBox([0, 0, 0]), LIGHT_THEME_2D)).toBeNull()
    expect(drawSelectionBox2D(fake.ctx, layout, 0, null, LIGHT_THEME_2D)).toBeNull()
    expect(fake.rects).toHaveLength(0)
  })
})

describe('drawGrowMargin2D（#191）', () => {
  it('マス目の外側に、余白のマス数だけ広げた点線の枠を引く', () => {
    const rects: { x: number; y: number; w: number; h: number; dash: number[] }[] = []
    let dash: number[] = []
    const ctx = {
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      save() {},
      restore() {},
      setLineDash(d: number[]) {
        dash = [...d]
      },
      strokeRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, dash })
      },
    }
    drawGrowMargin2D(ctx as unknown as SelectionCanvas2D, { originX: 10, originY: 20, cellSize: 8 }, [3, 2, 4], 1, LIGHT_THEME_2D)
    expect(rects).toEqual([{ x: 2.5, y: 12.5, w: 40, h: 48, dash: [...SELECTION_DASH_2D] }])
  })
})

describe('drawFlow2D（#207）', () => {
  function recorder() {
    const lines: string[] = []
    const texts: { text: string; style: string }[] = []
    const ctx = {
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      beginPath() {},
      moveTo(x: number, y: number) {
        lines.push(`${ctx.strokeStyle} ${x},${y}`)
      },
      lineTo() {},
      stroke() {},
      strokeText() {},
      fillText(text: string) {
        texts.push({ text, style: String(ctx.fillStyle) })
      },
      save() {},
      restore() {},
    }
    return { ctx: ctx as unknown as Canvas2DLike, lines, texts }
  }
  const layout = { originX: 0, originY: 0, cellSize: 20 }

  it('今の段の矢印は、マスの中心から線を引く（縁取りと色の2回）', () => {
    const { ctx, lines, texts } = recorder()
    drawFlow2D(ctx, layout, 0, { arrows: [{ from: [0, 0, 0], to: [1, 0, 0], kind: 'item' }], blocks: [] }, 'sans-serif')
    expect(lines.filter((l) => l.endsWith(' 10,10'))).toEqual(['rgb(0 0 0 / 70%) 10,10', `${FLOW_COLORS.item} 10,10`])
    expect(texts).toEqual([])
  })

  it('段をまたぐ矢印は、今の段の側に ▲・▼ を書き、ほかの段の矢印は描かない', () => {
    const { ctx, lines, texts } = recorder()
    const flow = {
      arrows: [
        { from: [0, 0, 0] as const, to: [0, 1, 0] as const, kind: 'power' as const },
        { from: [1, 2, 0] as const, to: [1, 1, 0] as const, kind: 'power' as const },
        { from: [3, 2, 0] as const, to: [4, 2, 0] as const, kind: 'power' as const },
      ],
      blocks: [],
    }
    drawFlow2D(ctx, layout, 1, flow, 'sans-serif')
    expect(texts.map((t) => t.text)).toEqual(['▲', '▼'])
    expect(lines).toEqual([])
  })
})
