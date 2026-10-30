// 2D表示でブロックの向きを描く（#166）。docs/ui.md「2D表示と計測」。
// facing は矢印、axis は線。上から見るので、上下の向きと y の軸は丸で描く。

import type { BlockState } from '../../domain/blockState'
import { isDirection, type Direction } from '../../domain/direction'
import type { Canvas2DLike } from './layerRenderer2D'

/** 2D に描く向きの印 */
export type OrientationMark2D =
  /** 水平の向き（facing・horizontal_facing）。矢印 */
  | { readonly kind: 'arrow'; readonly dir: Direction }
  /** 上・下を向く（facing=up / down）。上は丸に点、下は丸に × */
  | { readonly kind: 'up' }
  | { readonly kind: 'down' }
  /** 水平の軸（axis=x / z）。軸に沿った線 */
  | { readonly kind: 'axis'; readonly axis: 'x' | 'z' }
  /** 上下の軸（axis=y）。丸 */
  | { readonly kind: 'axisY' }

/** 向きの印を描く最小のマスの大きさ（px） */
export const ORIENTATION_MIN_CELL_SIZE = 12

/**
 * ブロック状態から、2D に描く向きの印を決める。horizontal_facing、facing、axis の順に見る。
 * horizontal_facing を先にするのは、両方あるとき facing は補った値のことがあるため（#149）
 * 向きを持たない、値が読めないときは null
 */
export function orientationMark2D(state: BlockState): OrientationMark2D | null {
  for (const key of ['horizontal_facing', 'facing'] as const) {
    const v = state.properties[key]
    if (v === undefined || !isDirection(v)) continue
    if (v === 'up' || v === 'down') return { kind: v }
    return { kind: 'arrow', dir: v }
  }
  const axis = state.properties['axis']
  if (axis === 'x' || axis === 'z') return { kind: 'axis', axis }
  if (axis === 'y') return { kind: 'axisY' }
  return null
}

/** 画面の向き（右が +x、下が +z）の単位ベクトル */
function screenVector(dir: Direction): [number, number] {
  switch (dir) {
    case 'north':
      return [0, -1]
    case 'south':
      return [0, 1]
    case 'east':
      return [1, 0]
    default:
      return [-1, 0]
  }
}

/** 中心 (cx, cy)、半径 r の丸を線でなぞる（八角形）。偽の canvas でも描けるよう、arc は使わない */
function ring(ctx: Canvas2DLike, cx: number, cy: number, r: number): void {
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI / 4) * i + Math.PI / 8
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
}

/** 印の線を足す（beginPath と stroke は呼ぶ側） */
function tracePath(ctx: Canvas2DLike, mark: OrientationMark2D, cx: number, cy: number, half: number): void {
  switch (mark.kind) {
    case 'arrow': {
      const [vx, vy] = screenVector(mark.dir)
      // 中心の少し後ろから、マスの端の手前まで。先に山形の矢じり
      const tail = half * 0.45
      const tip = half * 0.82
      const head = half * 0.38
      const tx = cx + vx * tip
      const ty = cy + vy * tip
      ctx.moveTo(cx - vx * tail, cy - vy * tail)
      ctx.lineTo(tx, ty)
      // 矢じりは、向きに垂直な (−vy, vx) の両側へ
      ctx.moveTo(tx - vx * head - vy * head, ty - vy * head + vx * head)
      ctx.lineTo(tx, ty)
      ctx.lineTo(tx - vx * head + vy * head, ty - vy * head - vx * head)
      return
    }
    case 'axis': {
      const [vx, vy] = mark.axis === 'x' ? [1, 0] : [0, 1]
      const len = half * 0.8
      const cap = half * 0.25
      ctx.moveTo(cx - vx * len, cy - vy * len)
      ctx.lineTo(cx + vx * len, cy + vy * len)
      // 両端に短い横棒を付けて、軸だと分かるようにする
      for (const s of [-1, 1]) {
        const ex = cx + vx * len * s
        const ey = cy + vy * len * s
        ctx.moveTo(ex - vy * cap, ey - vx * cap)
        ctx.lineTo(ex + vy * cap, ey + vx * cap)
      }
      return
    }
    case 'axisY':
      ring(ctx, cx, cy, half * 0.45)
      return
    case 'up': {
      ring(ctx, cx, cy, half * 0.5)
      // 真ん中の点（小さな十字）
      const p = Math.max(1, half * 0.08)
      ctx.moveTo(cx - p, cy)
      ctx.lineTo(cx + p, cy)
      ctx.moveTo(cx, cy - p)
      ctx.lineTo(cx, cy + p)
      return
    }
    case 'down': {
      ring(ctx, cx, cy, half * 0.5)
      const c = half * 0.3
      ctx.moveTo(cx - c, cy - c)
      ctx.lineTo(cx + c, cy + c)
      ctx.moveTo(cx + c, cy - c)
      ctx.lineTo(cx - c, cy + c)
      return
    }
  }
}

/**
 * マス (px, py)〜(px + size, py + size) に向きの印を描く。
 * ブロックの色やテクスチャの上でも見えるよう、暗い縁を付けた明るい線で描く
 */
export function drawOrientation2D(ctx: Canvas2DLike, mark: OrientationMark2D, px: number, py: number, size: number): void {
  const half = size / 2
  const cx = px + half
  const cy = py + half
  const width = Math.max(1.5, Math.min(3, size / 14))
  ctx.save()
  ctx.beginPath()
  tracePath(ctx, mark, cx, cy, half)
  ctx.strokeStyle = 'rgb(0 0 0 / 65%)'
  ctx.lineWidth = width + 2
  ctx.stroke()
  ctx.strokeStyle = '#f4f2ec'
  ctx.lineWidth = width
  ctx.stroke()
  ctx.restore()
}
