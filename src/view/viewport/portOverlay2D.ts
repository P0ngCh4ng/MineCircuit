// 2D表示の、仮の入出力の印（#70）。drawLayer2D のあとに呼ぶ。
// 今の段にある仮の入出力だけを描く。付けたブロックのマスの角に、塗った四角を出す（#195）。
// 同じブロックに2つ以上あれば、左上・右上・左下・右下の順に角を変える。選んでいるものは紫の枠で囲む。

import type { VirtualPort } from '../../calc/virtualPort'
import type { GridLayout2D } from '../tools/picker'
import type { Canvas2DLike } from './layerRenderer2D'
import { portColor } from './portOverlay3D'

/** 選んでいる印の枠の色 */
export const PORT_SELECTED_CSS = '#8a4fd8'

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * 印を描く四角（x, y, 幅, 高さ。CSS ピクセル）。
 * slot は同じブロックの中の何番目か（0 左上・1 右上・2 左下・3 右下。4 番目からはまた左上）
 */
export function portMarkRect(port: VirtualPort, layout: GridLayout2D, slot = 0): [number, number, number, number] {
  const { originX: ox, originY: oy, cellSize: cs } = layout
  const s = Math.max(4, cs * 0.34)
  const pad = Math.max(1, cs * 0.08)
  const right = slot % 2 === 1
  const bottom = slot % 4 >= 2
  const x = ox + port.pos[0] * cs + (right ? cs - pad - s : pad)
  const y = oy + port.pos[2] * cs + (bottom ? cs - pad - s : pad)
  return [x, y, s, s]
}

/** 今の段（layer）にある仮の入出力の印を描く */
export function drawPortOverlay2D(
  ctx: Canvas2DLike,
  layout: GridLayout2D,
  layer: number,
  ports: readonly VirtualPort[],
  selectedId: string | null,
): void {
  ctx.save()
  const slots = new Map<string, number>()
  for (const port of ports) {
    if (port.pos[1] !== layer) continue
    const key = `${port.pos[0]},${port.pos[2]}`
    const slot = slots.get(key) ?? 0
    slots.set(key, slot + 1)
    const [x, y, w, h] = portMarkRect(port, layout, slot)
    ctx.fillStyle = css(portColor(port.kind))
    ctx.fillRect(x, y, w, h)
    if (port.id === selectedId) {
      ctx.strokeStyle = PORT_SELECTED_CSS
      ctx.lineWidth = 2
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4)
    }
  }
  ctx.restore()
}
