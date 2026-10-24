// 2D表示の描画。今の段をマス目で canvas に描く。docs/ui.md「2D表示と計測」。
// 1つ下の段を薄く出し、マスが大きいときはブロックの略称を出す。上が北（−Z）。

import type { Blueprint } from '../../domain/blueprint'
import type { Vec3 } from '../../domain/vec3'
import type { GridLayout2D } from '../tools/picker'
import { blockColor, blockColorCss } from './blockColor'
import type { CellPainter2D, TextureCanvasLike } from './textureCellPainter2D'
import { axisLabelStep, blockAbbreviation, LABEL_MIN_CELL_SIZE, layerCells, type LayerCell2D } from './layerGrid2D'

/** 2D表示の色。画面のテーマ（明るい・暗い）に合わせる */
export interface LayerTheme2D {
  readonly name: 'light' | 'dark'
  /** マス目の線 */
  readonly grid: string
  /** マス目の外枠 */
  readonly frame: string
  /** 目盛りの数字 */
  readonly tick: string
  /** 1つ下の段の濃さ（0〜1） */
  readonly ghostAlpha: number
  /** マウスの下のマスの枠 */
  readonly hover: string
  /** 選択中のブロックの枠 */
  readonly selection: string
  /** 枠の内側に引く細い線。ブロックの色と枠の色が近くても枠が見えるようにする */
  readonly markInner: string
}

export const LIGHT_THEME_2D: LayerTheme2D = Object.freeze({
  name: 'light',
  grid: 'rgb(0 0 0 / 10%)',
  frame: 'rgb(0 0 0 / 35%)',
  tick: 'rgb(0 0 0 / 60%)',
  ghostAlpha: 0.2,
  hover: '#3a3936',
  selection: '#a8741c',
  markInner: '#ffffff',
})

export const DARK_THEME_2D: LayerTheme2D = Object.freeze({
  name: 'dark',
  grid: 'rgb(255 255 255 / 9%)',
  frame: 'rgb(255 255 255 / 35%)',
  tick: 'rgb(255 255 255 / 60%)',
  ghostAlpha: 0.22,
  hover: '#e6e4de',
  selection: '#ffc857',
  markInner: '#1b1b18',
})

/** 描くのに必要なもの */
export interface LayerScene2D {
  readonly blueprint: Blueprint
  /** 今の段（y） */
  readonly layer: number
  readonly layout: GridLayout2D
  readonly theme: LayerTheme2D
  /** マス目の線を描く */
  readonly showGrid: boolean
  /** マスが大きいとき、ブロックの略称を出す */
  readonly showLabels: boolean
  /** マウスの下のマス（今の段にあるときだけ枠を描く） */
  readonly hovered: Vec3 | null
  /** 選択中のブロック（今の段にあるときだけ枠を描く） */
  readonly selected: Vec3 | null
  /** 文字のフォント（font-family） */
  readonly fontFamily: string
  /**
   * 検索で強調するブロックの位置（#15）。今の段のうち、ここにないブロックを薄く描く。
   * null か省略で強調しない
   */
  readonly highlighted?: readonly Vec3[] | null
  /** 計算結果の印（#31）。今の段にあるものだけ描く。なければ省略 */
  readonly calcMarks?: CalcMarks2D
  /**
   * テクスチャで描く（#85）。描けないブロックと、null か省略のときは色で塗る
   */
  readonly cellPainter?: CellPainter2D | null
}

/** テクスチャで描くマスの下に敷く、ブロックの色の濃さ（0〜1）。シャフトのような細いブロックでも、マスにあることが分かるようにする */
export const TEXTURE_BACKDROP_ALPHA = 0.3

/** 強調しているときの、強調しないブロックの濃さ（0〜1） */
export const HIGHLIGHT_DIM_ALPHA = 0.18

/** 2D表示に重ねる計算結果の印 */
export interface CalcMarks2D {
  /** プローブでクリックしたブロックと、回転でつながったブロック */
  readonly network: readonly Vec3[] | null
  /** 問題の位置 */
  readonly issues: readonly Vec3[]
}

/** ネットワークの印の色（3D表示の calcOverlay3D と同じ） */
export const NETWORK_MARK_CSS = '#14a3c7'
/** 問題の印の色 */
export const ISSUE_MARK_CSS = '#e0402a'

/** canvas の 2D コンテキストのうち、ここで使う部分。テストでは偽物を渡せる */
export type Canvas2DLike = Pick<
  CanvasRenderingContext2D,
  | 'clearRect'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'fillText'
  | 'save'
  | 'restore'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'globalAlpha'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'strokeText'
  | keyof TextureCanvasLike
>

/** 色（0xRRGGBB）の明るさ（0〜1）。略称の文字色を決めるのに使う */
function luminance(color: number): number {
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** 強調する位置のうち、段 layer にあるものを x + z × 幅 の番号にする */
function highlightedOnLayer(positions: readonly Vec3[], layer: number, width: number): Set<number> {
  const keys = new Set<number>()
  for (const [x, y, z] of positions) {
    if (y === layer && x >= 0 && x < width && z >= 0) keys.add(x + z * width)
  }
  return keys
}

/**
 * 今の段を描く。width × height は CSS ピクセル（呼ぶ側で devicePixelRatio を掛けておく）。
 */
export function drawLayer2D(ctx: Canvas2DLike, width: number, height: number, scene: LayerScene2D): void {
  const { blueprint, layer, layout, theme } = scene
  const { originX: ox, originY: oy, cellSize: cs } = layout
  const [w, , d] = blueprint.size

  ctx.clearRect(0, 0, width, height)

  const painter = scene.cellPainter ?? null
  /**
   * マス1つを塗る。テクスチャで描けたら true。
   * テクスチャのときは、下にブロックの色を薄く敷いてから面を描く。今の globalAlpha を掛ける
   */
  const fillCell = (c: LayerCell2D, x: number, y: number, size: number): boolean => {
    const alpha = ctx.globalAlpha
    ctx.fillStyle = blockColorCss(c.id)
    if (painter) {
      ctx.globalAlpha = alpha * TEXTURE_BACKDROP_ALPHA
      ctx.fillRect(x, y, size, size)
      ctx.globalAlpha = alpha
      if (painter.paint(ctx, c.state, x, y, size, c.appearanceKey)) return true
      ctx.fillStyle = blockColorCss(c.id)
    }
    ctx.fillRect(x, y, size, size)
    return false
  }

  // 1つ下の段を薄く出す。今の段にブロックがあるマスは、上から塗るので気にしない
  if (layer > 0) {
    ctx.save()
    ctx.globalAlpha = theme.ghostAlpha
    for (const c of layerCells(blueprint, layer - 1)) {
      if (painter) ctx.clearRect(ox + c.x * cs, oy + c.z * cs, cs, cs)
      fillCell(c, ox + c.x * cs, oy + c.z * cs, cs)
    }
    ctx.restore()
  }

  // 今の段。強調しているときは、強調するマス（x + z × 幅）以外を薄くする
  const cells = layerCells(blueprint, layer)
  const highlight = scene.highlighted ? highlightedOnLayer(scene.highlighted, layer, w) : null
  const dimmed = (c: { x: number; z: number }): boolean => highlight !== null && !highlight.has(c.x + c.z * w)
  const gap = cs >= 8 ? 1 : 0
  /** テクスチャで描いたマス（x + z × 幅）。略称の文字の色を変える */
  const textured = new Set<number>()
  for (const c of cells) {
    // 下の段の薄い色を消してから塗る
    ctx.clearRect(ox + c.x * cs, oy + c.z * cs, cs, cs)
    if (dimmed(c)) ctx.globalAlpha = HIGHLIGHT_DIM_ALPHA
    if (fillCell(c, ox + c.x * cs + gap, oy + c.z * cs + gap, cs - gap * 2)) textured.add(c.x + c.z * w)
    ctx.globalAlpha = 1
  }

  // マス目
  if (scene.showGrid && cs >= 6) {
    ctx.strokeStyle = theme.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 1; x < w; x++) {
      ctx.moveTo(ox + x * cs + 0.5, oy)
      ctx.lineTo(ox + x * cs + 0.5, oy + d * cs)
    }
    for (let z = 1; z < d; z++) {
      ctx.moveTo(ox, oy + z * cs + 0.5)
      ctx.lineTo(ox + w * cs, oy + z * cs + 0.5)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = theme.frame
  ctx.lineWidth = 1
  ctx.strokeRect(ox + 0.5, oy + 0.5, w * cs, d * cs)

  // 略称
  if (scene.showLabels && cs >= LABEL_MIN_CELL_SIZE) {
    ctx.font = `600 ${Math.min(13, Math.round(cs * 0.34))}px ${scene.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const c of cells) {
      if (dimmed(c)) continue
      const text = blockAbbreviation(c.id)
      const tx = ox + c.x * cs + cs / 2
      const ty = oy + c.z * cs + cs / 2
      if (textured.has(c.x + c.z * w)) {
        // テクスチャの上では、明るい文字に暗い縁を付けて読めるようにする
        ctx.strokeStyle = 'rgb(0 0 0 / 70%)'
        ctx.lineWidth = 3
        ctx.strokeText(text, tx, ty)
        ctx.fillStyle = '#f4f2ec'
      } else {
        ctx.fillStyle = luminance(blockColor(c.id)) > 0.55 ? '#1b1b18' : '#f4f2ec'
      }
      ctx.fillText(text, tx, ty)
    }
  }

  // 目盛り：上に x、左に z
  const step = axisLabelStep(cs)
  ctx.fillStyle = theme.tick
  ctx.font = `11px ${scene.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  for (let x = 0; x < w; x += step) ctx.fillText(String(x), ox + x * cs + cs / 2, oy - 4)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let z = 0; z < d; z += step) ctx.fillText(String(z), ox - 6, oy + z * cs + cs / 2)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('x →', ox - 6, oy - 4)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('z', ox - 34, oy + 2)
  ctx.fillText('↓', ox - 34, oy + 16)

  // 計算結果の印：ネットワークは青緑、問題は赤。半透明で塗って枠を引く
  const calcMark = (positions: readonly Vec3[] | null | undefined, color: string, lineWidth: number): void => {
    if (!positions) return
    ctx.save()
    for (const pos of positions) {
      if (pos[1] !== layer) continue
      const px = ox + pos[0] * cs
      const py = oy + pos[2] * cs
      ctx.globalAlpha = 0.3
      ctx.fillStyle = color
      ctx.fillRect(px, py, cs, cs)
      ctx.globalAlpha = 1
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.strokeRect(px + lineWidth / 2, py + lineWidth / 2, cs - lineWidth, cs - lineWidth)
    }
    ctx.restore()
  }
  calcMark(scene.calcMarks?.network, NETWORK_MARK_CSS, 2)
  calcMark(scene.calcMarks?.issues, ISSUE_MARK_CSS, 2)

  // 枠：マウスの下と選択中
  const mark = (pos: Vec3 | null, color: string, lineWidth: number): void => {
    if (!pos || pos[1] !== layer) return
    const px = ox + pos[0] * cs
    const py = oy + pos[2] * cs
    // マスの境目に太い枠、その内側に細い線
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.strokeRect(px, py, cs, cs)
    ctx.strokeStyle = theme.markInner
    ctx.lineWidth = 1
    const inset = lineWidth / 2 + 0.5
    ctx.strokeRect(px + inset, py + inset, cs - inset * 2, cs - inset * 2)
  }
  mark(scene.hovered, theme.hover, 1.5)
  mark(scene.selected, theme.selection, 2.5)
}
