import { directionVector, oppositeDirection } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'
import { placeBlock } from '../../edit/editCommand'
import { isInside, outOfRangeMessage, type EditToolContext } from './editToolContext'
import type { PickModifiers, PickTarget, Tool } from './tool'

export const NO_BRUSH_MESSAGE = '置くブロックがありません。左パネルで選ぶか、スポイト（I）で表示中のブロックから取ってください。'
export const OCCUPIED_MESSAGE = 'そこにはすでにブロックがあります。置き換えるときは Shift+クリックします。'

/** 置く先のマスと、置き換えるかどうか */
export interface PlaceCell {
  readonly pos: Vec3
  readonly replace: boolean
}

/**
 * マウスの下のもの（PickTarget）から、置く先を決める。docs/ui.md「編集」。
 * - 空きマス（3D の今の段の床、2D の空きマス）：そのマス
 * - 3D で当たったブロック：当たった面の隣。Shift なら当たったブロックを置き換え
 * - 面のないブロック（2D の埋まったマス）：そのマスを置き換え
 */
export function placeCell(target: PickTarget, mods: PickModifiers): PlaceCell {
  if (target.empty) return { pos: target.pos, replace: false }
  if (target.face === undefined || mods.shift) return { pos: target.pos, replace: true }
  const d = directionVector(target.face)
  const p = target.pos
  return { pos: [p[0] + d[0], p[1] + d[1], p[2] + d[2]], replace: false }
}

/** 置くツール（B）。クリックした所に置くブロックを置く。範囲の外には置かせず、理由を出す */
export class PlaceTool implements Tool {
  readonly id = 'place' as const

  constructor(private readonly ctx: EditToolContext) {}

  onHover(target: PickTarget | null): void {
    const bp = this.ctx.blueprint()
    const cell = target ? placeCell(target, { shift: false }) : null
    // 見本は、置けるマスにだけ出す
    const show = bp && cell && this.ctx.brush() && isInside(bp, cell.pos) && (cell.replace || bp.get(cell.pos) === null)
    this.ctx.setGhost(show ? cell.pos : null)
  }

  onClick(target: PickTarget, mods: PickModifiers): void {
    const bp = this.ctx.blueprint()
    if (!bp) return
    const state = this.ctx.brush()
    if (!state) {
      this.ctx.notify(NO_BRUSH_MESSAGE)
      return
    }
    const { pos, replace } = placeCell(target, mods)
    if (!isInside(bp, pos)) {
      this.ctx.notify(outOfRangeMessage(bp))
      return
    }
    if (!replace && bp.get(pos) !== null) {
      this.ctx.notify(OCCUPIED_MESSAGE)
      return
    }
    this.ctx.notify(null)
    // 隣とつながる向きに合わせる（#119）。3D で面をクリックしたときは、その面のブロックの側を優先する。Alt なら合わせない
    const from = !replace && target.face !== undefined ? oppositeDirection(target.face) : null
    const placed = mods.alt ? state : this.ctx.orient(bp, pos, state, from)
    // 同じブロックがすでにあるときは変化なし（null）なので、何もしない
    if (this.ctx.apply(placeBlock(bp, pos, placed, replace))) this.ctx.revealLayer(pos[1])
  }

  deactivate(): void {
    this.ctx.setGhost(null)
  }
}

