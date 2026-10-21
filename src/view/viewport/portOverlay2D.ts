// 2D表示の、仮の入出力の印（#70）。drawLayer2D のあとに呼ぶ。
// 今の段にある仮の入出力だけを描く。
// - 東西南北の面：マスの外側の辺に沿った帯
// - 上の面：マスの中央の塗った四角。下の面：マスの中央の枠だけの四角
// 選んでいるものは紫の枠で囲む。

import type { VirtualPort } from '../../calc/virtualPort'
import type { GridLayout2D } from '../tools/picker'
import type { Canvas2DLike } from './layerRenderer2D'
import { portColor } from './portOverlay3D'

/** 選んでいる印の枠の色 */
export const PORT_SELECTED_CSS = '#8a4fd8'

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** 印を描く四角（x, y, 幅, 高さ。CSS ピクセル） */
export function portMarkRect(port: VirtualPort, layout: GridLayout2D): [number, number, number, number] {
  const { originX: ox, originY: oy, cellSize: cs } = layout
  const x = ox + port.pos[0] * cs
  const y = oy + port.pos[2] * cs
  const t = Math.max(3, cs * 0.28)
  switch (port.face) {
    case 'north':
      return [x, y - t, cs, t]
    case 'south':
      return [x, y + cs, cs, t]
    case 'west':
      return [x - t, y, t, cs]
    case 'east':
      return [x + cs, y, t, cs]
    default: {
      const s = Math.max(4, cs * 0.4)
      return [x + (cs - s) / 2, y + (cs - s) / 2, s, s]
    }
  }
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
  for (const port of ports) {
    if (port.pos[1] !== layer) continue
    const [x, y, w, h] = portMarkRect(port, layout)
    const color = css(portColor(port.kind))
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    if (port.face === 'down') ctx.strokeRect(x, y, w, h)
    else ctx.fillRect(x, y, w, h)
    if (port.id === selectedId) {
      ctx.strokeStyle = PORT_SELECTED_CSS
      ctx.lineWidth = 2
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4)
    }
  }
  ctx.restore()
}
