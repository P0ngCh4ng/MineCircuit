// 2D表示の、計測（#16）とつながり（#16）の重ね描き。drawLayer2D のあとに呼ぶ。
// - 計測：選んだ点の枠と、2点の中心を結ぶ点線。今の段にない点は点線の枠にする
// - つながり：今の段にあるまとまりのブロックを塗って枠を付ける

import type { Vec3 } from '../../domain/vec3'
import type { GridLayout2D } from '../tools/picker'
import type { Canvas2DLike } from './layerRenderer2D'

export interface AnalysisColors2D {
  readonly measure: string
  readonly connect: string
  readonly connectFill: string
}

export const ANALYSIS_COLORS_2D: Readonly<Record<'light' | 'dark', AnalysisColors2D>> = {
  light: { measure: '#1f6fb8', connect: '#b0369a', connectFill: 'rgb(176 54 154 / 28%)' },
  dark: { measure: '#6cb6ff', connect: '#f08ad8', connectFill: 'rgb(240 138 216 / 30%)' },
}

export interface AnalysisOverlay2D {
  /** 計測の点（0〜2個） */
  readonly measurePoints: readonly Vec3[]
  /** つながりのまとまり。なければ null */
  readonly connectGroup: readonly Vec3[] | null
}

export type AnalysisCanvas2D = Canvas2DLike & Pick<CanvasRenderingContext2D, 'setLineDash'>

/** 今の段（layer）に、計測とつながりを重ねて描く */
export function drawAnalysisOverlay2D(
  ctx: AnalysisCanvas2D,
  layout: GridLayout2D,
  layer: number,
  overlay: AnalysisOverlay2D,
  colors: AnalysisColors2D,
): void {
  const { originX: ox, originY: oy, cellSize: cs } = layout
  ctx.save()

  const group = overlay.connectGroup
  if (group && group.length > 0) {
    ctx.fillStyle = colors.connectFill
    ctx.strokeStyle = colors.connect
    ctx.lineWidth = cs >= 8 ? 2 : 1
    for (const p of group) {
      if (p[1] !== layer) continue
      ctx.fillRect(ox + p[0] * cs, oy + p[2] * cs, cs, cs)
      ctx.strokeRect(ox + p[0] * cs + 1, oy + p[2] * cs + 1, cs - 2, cs - 2)
    }
  }

  const points = overlay.measurePoints
  if (points.length > 0) {
    ctx.strokeStyle = colors.measure
    ctx.lineWidth = 2.5
    for (const p of points) {
      // 今の段にない点は、点線の枠で位置だけを示す
      ctx.setLineDash(p[1] === layer ? [] : [4, 3])
      ctx.strokeRect(ox + p[0] * cs, oy + p[2] * cs, cs, cs)
    }
    if (points.length >= 2) {
      const [a, b] = points
      ctx.setLineDash([6, 4])
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ox + (a[0] + 0.5) * cs, oy + (a[2] + 0.5) * cs)
      ctx.lineTo(ox + (b[0] + 0.5) * cs, oy + (b[2] + 0.5) * cs)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  ctx.restore()
}
